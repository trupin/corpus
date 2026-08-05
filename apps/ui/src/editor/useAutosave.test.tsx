/** @vitest-environment jsdom */
import type { CorpusClient } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markAbandoned,
  publishDoc,
  resetAbandonRegistry,
  snapshotOf,
} from "../abandon/registry.js";
import { docFixture } from "../testing/readerFixture";
import {
  EDIT_SESSION_SETTLE_MS,
  resetEditSessionFlush,
  setEditSessionClient,
  useEditSurface,
} from "./editSessionFlush.js";
import { editingCount, isEditing, resetEditingRegistry } from "./editingRegistry.js";
import { saveChipClass, saveChipText } from "./SaveChip.js";
import {
  AUTOSAVE_DEBOUNCE_MS,
  EDIT_SETTLE_MS,
  RETRY_DELAY_MS,
  useAutosave,
  type AnchorReport,
} from "./useAutosave.js";

/**
 * Autosave, on fake timers.
 *
 * The assertions that matter are about *requests*, not about state: exactly one
 * `PUT` for a burst of typing, none at all for an edit that came back to where
 * it started, and one carrying the outgoing document's id when the surface goes
 * away mid-debounce.
 */

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Call[];
  readonly puts: () => Call[];
  fail: number;
  delayMs: number;
  remapped: string[];
  orphaned: string[];
}

function wire(): Wire {
  const calls: Call[] = [];
  const state = {
    fetch: null as unknown as typeof globalThis.fetch,
    calls,
    puts: () => calls.filter((call) => call.method === "PUT"),
    fail: 0,
    delayMs: 0,
    remapped: [] as string[],
    orphaned: [] as string[],
  };

  state.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: url.pathname,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });
    if (url.pathname === "/api/locks") return json({ locks: [] });
    if (request.method === "PUT") {
      if (state.fail > 0) {
        state.fail -= 1;
        return json({ code: "internal", message: "the server refused" }, 500);
      }
      if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      return json({
        doc: docFixture(),
        anchors: { remapped: state.remapped, orphaned: state.orphaned },
        warnings: [],
      });
    }
    return json({});
  };

  return state;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface HostProps {
  readonly transport: Wire;
  readonly docId?: string;
  readonly locked?: boolean;
  readonly savedBody?: string;
  readonly onAnchors?: (report: AnchorReport) => void;
}

/** A surface with one control: type this text. */
function Host({ transport, docId, locked, savedBody, onAnchors }: HostProps): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <Surface
        docId={docId ?? "doc_a1b2c3"}
        locked={locked ?? false}
        savedBody={savedBody ?? "start\n"}
        {...(onAnchors === undefined ? {} : { onAnchors })}
      />
    </harness.Wrapper>
  );
}

interface SurfaceProps {
  readonly docId: string;
  readonly locked: boolean;
  readonly savedBody: string;
  readonly onAnchors?: (report: AnchorReport) => void;
}

let type: (body: string) => void = () => undefined;
let retry: () => void = () => undefined;

function Surface({ docId, locked, savedBody, onAnchors }: SurfaceProps): ReactElement {
  const autosave = useAutosave({ docId, savedBody, locked, onAnchors });
  // In the order `DocEditor` declares them, which is the order the cleanups
  // run in: autosave sends its final `PUT`, *then* the surface count drops.
  useEditSurface(docId);
  type = autosave.change;
  retry = autosave.retry;
  return (
    <span data-testid="chip" className={saveChipClass(autosave.state)}>
      {saveChipText(autosave.state)}
    </span>
  );
}

function chip(): HTMLElement {
  return screen.getByTestId("chip");
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  resetEditingRegistry();
  resetAbandonRegistry();
  resetEditSessionFlush();
  vi.useRealTimers();
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("debouncing", () => {
  it("coalesces a burst of edits into exactly one PUT", async () => {
    const transport = wire();
    render(<Host transport={transport} />);

    act(() => {
      for (let index = 1; index <= 15; index += 1) type(`start ${"x".repeat(index)}\n`);
    });
    expect(transport.puts()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(transport.puts()).toHaveLength(1);
    expect(transport.puts()[0]?.body).toEqual({ body: `start ${"x".repeat(15)}\n` });
    expect(transport.puts()[0]?.path).toBe("/api/docs/doc_a1b2c3");
  });

  it("issues nothing at all for an edit that came back to where it started", async () => {
    const transport = wire();
    render(<Host transport={transport} />);

    act(() => {
      type("start x\n");
      type("start\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 3);
      await Promise.resolve();
    });

    expect(transport.puts()).toHaveLength(0);
  });

  it("does not schedule a save while another party holds the lock", async () => {
    const transport = wire();
    render(<Host transport={transport} locked />);

    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 3);
      await Promise.resolve();
    });

    expect(transport.puts()).toHaveLength(0);
  });

  /**
   * UI-013 rider. A buffer parked behind a foreign lock cannot be sent — the
   * server refuses a write to a locked document — so the tab holding it is the
   * only copy of that text. Leaving the page destroys it, and the chip that was
   * saying so goes with it, so this is the one exit worth intercepting.
   */
  describe("leaving the page with a buffer parked behind a lock", () => {
    function leave(): Event {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event;
    }

    it("asks the browser to confirm", () => {
      const transport = wire();
      render(<Host transport={transport} locked />);
      act(() => {
        type("text that cannot be saved yet\n");
      });
      expect(leave().defaultPrevented).toBe(true);
    });

    it("says nothing when there is no parked buffer", () => {
      const transport = wire();
      render(<Host transport={transport} locked />);
      expect(leave().defaultPrevented).toBe(false);
    });

    it("says nothing for an ordinary pending save, which `pagehide` flushes", () => {
      const transport = wire();
      render(<Host transport={transport} />);
      act(() => {
        type("ordinary text\n");
      });
      expect(leave().defaultPrevented).toBe(false);
    });
  });
});

describe("edits typed while a save is on the wire", () => {
  /**
   * The interleaving this whole block exists for: the `PUT` takes longer than
   * the debounce window that scheduled it, so the debounce re-fires *during*
   * the flight and declines to start a second request. Before the completion
   * handler picked the buffer up, the tail edit stayed in memory with the chip
   * reading `committed · git ✓` over it, and nothing — no timer, no event —
   * would ever have sent it.
   */
  async function typeThenSaveLandsLate(transport: Wire): Promise<void> {
    // 2 s of latency against a 700 ms window: realistic for a large document.
    transport.delayMs = 2_000;
    act(() => {
      type("start one\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(transport.puts()).toHaveLength(1);
    expect(transport.puts()[0]?.body).toEqual({ body: "start one\n" });

    // The tail edit, typed while the first PUT is still out.
    act(() => {
      type("start one two\n");
    });
    // The debounce fires mid-flight and, correctly, starts nothing.
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(transport.puts()).toHaveLength(1);
  }

  it("sends the tail edit when the PUT lands, with no further input", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await typeThenSaveLandsLate(transport);

    // Nothing but the response arriving.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });
    expect(transport.puts()[1]?.body).toEqual({ body: "start one two\n" });
    expect(transport.puts()[1]?.path).toBe("/api/docs/doc_a1b2c3");
  });

  it("never says committed while newer text is still only in memory", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await typeThenSaveLandsLate(transport);

    // The crash window: from here to the second response the buffer is dirty,
    // and the chip must not claim otherwise at any point in it.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });
    // The first response has landed and the chip is still `saving…`: the second
    // request went out before the state could report a save.
    expect(chip().className).toBe("save-chip saving");
    expect(chip().textContent).toBe("saving…");

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    // And the chip only said so once the server had the tail edit.
    expect(transport.puts()).toHaveLength(2);
  });

  it("settles the editing session, so deferred SSE and queued comments unblock", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    await typeThenSaveLandsLate(transport);

    // `useAnchorLayer.submitComment` parks a comment on exactly this flag; a
    // session that never settles never posts it.
    expect(isEditing("doc_a1b2c3")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });
    expect(isEditing("doc_a1b2c3")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    // Still open until the settle window elapses — but now it *will* close.
    expect(isEditing("doc_a1b2c3")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(EDIT_SETTLE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(isEditing("doc_a1b2c3")).toBe(false);
    });
  });

  it("sends the tail edit even when the surface went away mid-flight", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);
    await typeThenSaveLandsLate(transport);

    view.unmount();
    await settle();
    // The unmount flush cannot send it — a request is in flight — so the
    // completion handler is the only thing standing between the tail edit and
    // a closed tab.
    expect(transport.puts()).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });
    expect(transport.puts()[1]?.body).toEqual({ body: "start one two\n" });
  });

  it("issues nothing extra when the buffer came back to what was just sent", async () => {
    const transport = wire();
    transport.delayMs = 2_000;
    render(<Host transport={transport} />);

    act(() => {
      type("start one\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    act(() => {
      type("start one two\n");
      type("start one\n");
    });

    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
    expect(transport.puts()).toHaveLength(1);
  });

  it("waits for a foreign lock to clear rather than reporting a save", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);
    await typeThenSaveLandsLate(transport);

    // The agent took the lock while the save was out.
    view.rerender(<Host transport={transport} locked />);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().className).toBe("save-chip failed");
    });
    expect(transport.puts()).toHaveLength(1);

    view.rerender(<Host transport={transport} locked={false} />);
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });
    expect(transport.puts()[1]?.body).toEqual({ body: "start one two\n" });
  });
});

describe("the chip", () => {
  it("stays on `saving…` for as long as the request is in flight", async () => {
    const transport = wire();
    transport.delayMs = 5_000;
    render(<Host transport={transport} />);

    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(chip().textContent).toBe("saving…");
    expect(chip().className).toBe("save-chip saving");

    // Four seconds of a five-second request: a chip on a timer would have
    // advanced by now.
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
    });
    expect(chip().textContent).toBe("saving…");

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().className).toBe("save-chip saved");
    });
  });

  it("says committed once the response has arrived", async () => {
    const transport = wire();
    render(<Host transport={transport} />);
    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓");
    });
  });

  it("reports the response's anchor claim, and never `anchors ✓` over an orphan", async () => {
    const transport = wire();
    transport.remapped = ["an_1", "an_2"];
    render(<Host transport={transport} />);
    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓ · 2 anchors moved");
    });

    transport.remapped = [];
    transport.orphaned = ["an_3"];
    act(() => {
      type("start typed again\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().textContent).toBe("committed · git ✓ · 1 anchor orphaned");
    });
  });

  it("publishes the anchor report for UI-007", async () => {
    const transport = wire();
    transport.remapped = ["an_1"];
    transport.orphaned = ["an_2"];
    const reports: AnchorReport[] = [];
    render(
      <Host
        transport={transport}
        onAnchors={(report) => {
          reports.push(report);
        }}
      />,
    );
    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(reports).toHaveLength(1);
    });
    expect(reports[0]).toEqual({
      docId: "doc_a1b2c3",
      // The first save of this session; the stamp is what lets UI-007 drop a
      // report that describes a body two saves ago.
      revision: 1,
      remapped: ["an_1"],
      orphaned: ["an_2"],
      warnings: [],
    });
  });
});

describe("failure", () => {
  it("keeps the buffer, shows the signal state and retries once by itself", async () => {
    const transport = wire();
    transport.fail = 1;
    render(<Host transport={transport} />);

    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().className).toBe("save-chip failed");
    });
    expect(chip().textContent).toBe("save failed");
    expect(transport.puts()).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(RETRY_DELAY_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });
    // The same body, not a truncated one: the buffer was never discarded.
    expect(transport.puts()[1]?.body).toEqual({ body: "start typed\n" });
    await waitFor(() => {
      expect(chip().className).toBe("save-chip saved");
    });
  });

  it("re-sends the buffer when the retry affordance is used", async () => {
    const transport = wire();
    transport.fail = 3;
    render(<Host transport={transport} />);

    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(RETRY_DELAY_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });

    transport.fail = 0;
    await act(async () => {
      retry();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(3);
    });
    expect(transport.puts()[2]?.body).toEqual({ body: "start typed\n" });
  });
});

/**
 * The retry belongs to the surface, and dies with it (PR #22 review, MAJOR).
 *
 * A timer armed from the failure handler can only be cleared by this hook's
 * cleanup, so one armed *after* that cleanup can never be cleared — and it is
 * not a harmless stray. `editSessionFlush` has been told the write settled, so
 * its sweep ends the session over what committed; the retry landing three
 * seconds later opens a second session nobody is left to close, and one sitting
 * produces two `doc.edited` events and two acknowledgment threads.
 */
describe("a save refused after the surface has gone", () => {
  function flushSpy(): ReturnType<typeof vi.fn> {
    const flushEditSession = vi.fn(() => Promise.resolve());
    setEditSessionClient({ flushEditSession } as unknown as CorpusClient);
    return flushEditSession;
  }

  /** Advance the fake clock with the promise chains drained between timers. */
  async function elapse(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("ends the sitting with exactly one acknowledgment", async () => {
    const flushEditSession = flushSpy();
    const transport = wire();
    const view = render(<Host transport={transport} />);

    // The save that lands: this is what opens the session on the server.
    act(() => {
      type("start one\n");
    });
    await elapse(AUTOSAVE_DEBOUNCE_MS);
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(1);
    });

    // The last sentence, typed inside the debounce window — and then the reader
    // closes and the teardown flush is refused (a 500, a network blip).
    transport.fail = 1;
    act(() => {
      type("start one two\n");
    });
    view.unmount();
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(2);
    });

    // The close path ends the session over the range that actually committed.
    await elapse(EDIT_SESSION_SETTLE_MS + 1);
    await waitFor(() => {
      expect(flushEditSession.mock.calls).toEqual([["doc_a1b2c3"]]);
    });

    // The window the orphaned retry used to fire in, plus the sweep behind it.
    await elapse(RETRY_DELAY_MS + EDIT_SESSION_SETTLE_MS + 1);
    // No third `PUT`, so no second session and no second acknowledgment.
    expect(flushEditSession.mock.calls).toEqual([["doc_a1b2c3"]]);
    expect(transport.puts()).toHaveLength(2);
  });

  it("arms no retry for the document a reader rebound away from", async () => {
    const flushEditSession = flushSpy();
    const transport = wire();
    transport.fail = 1;
    const view = render(<Host transport={transport} docId="doc_outgoing" />);

    act(() => {
      type("outgoing text\n");
    });
    view.rerender(<Host transport={transport} docId="doc_incoming" />);
    await waitFor(() => {
      expect(transport.puts()).toHaveLength(1);
    });
    expect(transport.puts()[0]?.path).toBe("/api/docs/doc_outgoing");

    // The hook is still mounted, so only the *document* the response is about
    // marks it as answering to nothing: a retry here would `PUT` the outgoing
    // body from a surface that is now editing something else.
    await elapse(RETRY_DELAY_MS + EDIT_SESSION_SETTLE_MS + 1);
    expect(transport.puts()).toHaveLength(1);
    // Refused, so nothing committed, so there is no session to acknowledge.
    expect(flushEditSession).not.toHaveBeenCalled();
  });
});

describe("flushing", () => {
  it("sends a pending save when the surface unmounts", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);

    act(() => {
      type("start typed\n");
    });
    expect(transport.puts()).toHaveLength(0);

    view.unmount();
    await settle();

    expect(transport.puts()).toHaveLength(1);
    expect(transport.puts()[0]?.body).toEqual({ body: "start typed\n" });
  });

  it("sends nothing for a document that is being abandoned", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);

    // The race the abandon rule has to survive (sprint-016 TEST-425): a
    // character typed, erased, and the reader left inside the debounce window.
    act(() => {
      type("start typed\n");
      type("\n");
    });
    markAbandoned("doc_a1b2c3");

    view.unmount();
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 3);
      await Promise.resolve();
    });

    expect(transport.puts()).toHaveLength(0);
  });

  it("publishes the live body so the abandon rule reads the buffer, not the corpus", () => {
    const transport = wire();
    render(<Host transport={transport} />);

    act(() => {
      type("start typed\n");
    });
    expect(snapshotOf("doc_a1b2c3")).toBeNull();

    publishDoc("doc_a1b2c3", {
      type: "note",
      title: "Untitled",
      body: "start\n",
      threadCount: 0,
      hasExtra: false,
    });
    expect(snapshotOf("doc_a1b2c3")?.body).toBe("start typed\n");
  });

  it("sends the OUTGOING document's buffer when the reader rebinds", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} docId="doc_outgoing" />);

    act(() => {
      type("outgoing text\n");
    });
    view.rerender(<Host transport={transport} docId="doc_incoming" />);
    await settle();

    expect(transport.puts()).toHaveLength(1);
    // The id in the URL is the one that was being edited, never the new one.
    expect(transport.puts()[0]?.path).toBe("/api/docs/doc_outgoing");
    expect(transport.puts()[0]?.body).toEqual({ body: "outgoing text\n" });
  });

  it("sends a pending save when the tab is hidden", async () => {
    const transport = wire();
    render(<Host transport={transport} />);

    act(() => {
      type("start typed\n");
    });
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(transport.puts()).toHaveLength(1);
  });
});

describe("the editing session", () => {
  it("opens on the first keystroke and closes once the save has settled", async () => {
    const transport = wire();
    render(<Host transport={transport} />);

    act(() => {
      type("start typed\n");
    });
    expect(isEditing("doc_a1b2c3")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().className).toBe("save-chip saved");
    });
    // Still open: the settle window has not elapsed.
    expect(isEditing("doc_a1b2c3")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(EDIT_SETTLE_MS);
      await Promise.resolve();
    });
    expect(isEditing("doc_a1b2c3")).toBe(false);
  });

  it("closes when the surface goes away", async () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);
    act(() => {
      type("start typed\n");
    });
    expect(editingCount()).toBe(1);
    view.unmount();
    await settle();
    expect(editingCount()).toBe(0);
  });
});
