/** @vitest-environment jsdom */
import type { CorpusClient } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render } from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onPageHide, resetPageHide } from "../abandon/pagehide";
import {
  EDIT_SESSION_SETTLE_MS,
  beginEditWrite,
  endEditWrite,
  flushEditSessionsOnUnload,
  resetEditSessionFlush,
  retainEditSurface,
  setEditSessionClient,
  useEditSessionFlusher,
  useEditSurface,
} from "./editSessionFlush";

/**
 * SPEC.md §4's close path: which of a reader's exits end an editing sitting.
 *
 * The two failure modes this suite exists to pin are opposite and both real.
 * Flushing too eagerly fragments one sitting into an acknowledgment per
 * navigation — the defect that ruled out binding this to §7's edit lock, whose
 * idle release is 10 s against the session's 180 s. Flushing too rarely makes
 * the user wait out the full three-minute window for an acknowledgment they
 * expected on closing the document.
 */

const DOC = "doc_a1b2c3";
const OTHER = "doc_z9y8x7";

function fakeClient(): { client: CorpusClient; flushEditSession: ReturnType<typeof vi.fn> } {
  const flushEditSession = vi.fn(() => Promise.resolve());
  return { client: { flushEditSession } as unknown as CorpusClient, flushEditSession };
}

/** The window the sweep waits, plus a tick, as a settled close. */
function settle(): void {
  vi.advanceTimersByTime(EDIT_SESSION_SETTLE_MS + 1);
}

/**
 * The same window, with the request's own promise chain drained.
 *
 * `waitFor` is unusable here: it polls on real timers unless it can detect
 * Jest's fake clock, which Vitest's is not, so it hangs against a suite that
 * drives time by hand. Advancing asynchronously flushes the microtasks
 * `openapi-fetch` queues on the way to `fetch`.
 */
async function settleRequest(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(EDIT_SESSION_SETTLE_MS + 1);
  });
}

/** A document that has been typed into and saved once — the state a close acts on. */
function edited(docId: string): () => void {
  const release = retainEditSurface(docId);
  beginEditWrite(docId);
  endEditWrite(docId, true);
  return release;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  resetEditSessionFlush();
  resetPageHide();
  vi.useRealTimers();
});

describe("what counts as the reader closing", () => {
  it("never flushes a document that was only read", () => {
    // A session is opened by an editor save, so a reader opened and closed
    // without typing has none — and a request that can only be a no-op is not
    // free just because the route is idempotent.
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    retainEditSurface(DOC)();
    settle();

    expect(flushEditSession).not.toHaveBeenCalled();
  });

  it("flushes once when the last surface for an edited document goes", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    edited(DOC)();
    settle();

    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });

  it("does not flush while another surface still shows the document", () => {
    // Focus mode over a column already showing the document: two surfaces, one
    // sitting. Closing the overlay has ended nothing.
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    const column = edited(DOC);
    const focus = retainEditSurface(DOC);

    focus();
    settle();
    expect(flushEditSession).not.toHaveBeenCalled();

    column();
    settle();
    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });

  it("treats a surface handed over between two commits as one sitting", () => {
    // Entering focus mode can unmount the column's editor and mount the
    // overlay's in separate commits. The count reaches zero in between, and a
    // flush there would split the sitting in half.
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    const column = edited(DOC);
    column();
    const focus = retainEditSurface(DOC);
    settle();

    expect(flushEditSession).not.toHaveBeenCalled();

    focus();
    settle();
    expect(flushEditSession).toHaveBeenCalledTimes(1);
  });

  it("does not flush again when Back returns to the document and leaves it", () => {
    // The acceptance criterion: a nav stack must not produce an acknowledgment
    // per entry. Returning re-opens no session, so leaving again ends nothing.
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    edited(DOC)();
    settle();
    expect(flushEditSession).toHaveBeenCalledTimes(1);

    retainEditSurface(DOC)();
    settle();
    expect(flushEditSession).toHaveBeenCalledTimes(1);
  });

  it("flushes only the document a reader navigated away from", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    const leaving = edited(DOC);
    // The reader keys the editor by document id, so a navigation is a remount:
    // the arriving document's surface is retained as the outgoing one goes.
    const arriving = retainEditSurface(OTHER);
    leaving();
    settle();

    expect(flushEditSession.mock.calls).toEqual([[DOC]]);

    arriving();
    settle();
    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });

  it("ignores a surface with no document", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    retainEditSurface("")();
    beginEditWrite("");
    endEditWrite("", true);
    settle();

    expect(flushEditSession).not.toHaveBeenCalled();
  });

  it("survives a release called twice for one retain", () => {
    // React invokes a cleanup once, but StrictMode replays mount/cleanup/mount
    // and a caller may hold the closure past its effect. Two releases must not
    // net to minus one surface.
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    const first = edited(DOC);
    const second = retainEditSurface(DOC);
    first();
    first();
    settle();

    expect(flushEditSession).not.toHaveBeenCalled();

    second();
    settle();
    expect(flushEditSession).toHaveBeenCalledTimes(1);
  });
});

describe("a save still on the wire when the reader closes", () => {
  it("waits for it, so the acknowledgment covers the last sentence typed", () => {
    // The teardown order on a close is: editor unmounts, autosave sends its
    // buffer, surface count reaches zero — with the `PUT` still in flight.
    // Flushing there ends the session one save short, and the `PUT` landing
    // afterwards opens a second session nobody is left to close.
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    const release = edited(DOC);
    beginEditWrite(DOC);
    release();
    settle();

    expect(flushEditSession).not.toHaveBeenCalled();

    endEditWrite(DOC, true);
    settle();
    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });

  it("opens no session for a save the server refused", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    const release = retainEditSurface(DOC);
    beginEditWrite(DOC);
    endEditWrite(DOC, false);
    release();
    settle();

    expect(flushEditSession).not.toHaveBeenCalled();
  });

  it("ignores a write settling for a document it knows nothing about", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    endEditWrite(OTHER, true);
    settle();

    expect(flushEditSession).not.toHaveBeenCalled();
  });
});

describe("the tab-close path", () => {
  it("flushes an open session even though the reader is still mounted", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    edited(DOC);
    flushEditSessionsOnUnload();

    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });

  it("flushes even while a save is in flight, because neither will exist next tick", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    edited(DOC);
    beginEditWrite(DOC);
    flushEditSessionsOnUnload();

    expect(flushEditSession).toHaveBeenCalledTimes(1);
  });

  it("leaves a document that was only read alone", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    retainEditSurface(DOC);
    flushEditSessionsOnUnload();

    expect(flushEditSession).not.toHaveBeenCalled();
  });

  it("flushes once when the unload path and the in-app close both fire", () => {
    // The case the route's idempotence is for, checked on this side too: a
    // duplicate is likelier than a miss on an unload path, and one sitting must
    // still produce one acknowledgment.
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    const release = edited(DOC);
    flushEditSessionsOnUnload();
    release();
    settle();

    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });

  it("is safe to run twice", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);

    edited(DOC);
    flushEditSessionsOnUnload();
    flushEditSessionsOnUnload();

    expect(flushEditSession).toHaveBeenCalledTimes(1);
  });
});

describe("a flush that fails", () => {
  it("is swallowed and never retried — the inactivity window is the backstop", async () => {
    const flushEditSession = vi.fn(() => Promise.reject(new Error("gone")));
    setEditSessionClient({ flushEditSession } as unknown as CorpusClient);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    edited(DOC)();
    settle();
    await vi.advanceTimersByTimeAsync(0);
    settle();

    expect(flushEditSession).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("issues nothing, and throws nothing, with no client installed", () => {
    edited(DOC)();
    expect(() => {
      settle();
    }).not.toThrow();
  });
});

function Surface({ docId }: { readonly docId: string }): ReactElement {
  useEditSurface(docId);
  return <div data-testid="surface">{docId}</div>;
}

describe("useEditSurface", () => {
  it("retains for as long as it is mounted and releases on unmount", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);
    beginEditWrite(DOC);
    endEditWrite(DOC, true);

    const view = render(<Surface docId={DOC} />);
    settle();
    expect(flushEditSession).not.toHaveBeenCalled();

    view.unmount();
    settle();
    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });

  it("releases the outgoing document when it rebinds to another", () => {
    const { client, flushEditSession } = fakeClient();
    setEditSessionClient(client);
    beginEditWrite(DOC);
    endEditWrite(DOC, true);

    const view = render(<Surface docId={DOC} />);
    view.rerender(<Surface docId={OTHER} />);
    settle();

    expect(flushEditSession.mock.calls).toEqual([[DOC]]);
  });
});

function Flusher({ children }: { readonly children?: ReactNode }): ReactElement {
  useEditSessionFlusher();
  return <>{children}</>;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly posts: string[];
}

function wire(): Wire {
  const posts: string[] = [];
  return {
    posts,
    fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname.endsWith("/edit-session/flush")) {
        posts.push(url.pathname);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  };
}

function Host({ transport, children }: { transport: Wire; children?: ReactNode }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <Flusher>{children}</Flusher>
    </harness.Wrapper>
  );
}

describe("useEditSessionFlusher", () => {
  it("issues the flush against the provider's client", async () => {
    const transport = wire();
    render(<Host transport={transport} />);

    edited(DOC)();
    await settleRequest();

    expect(transport.posts).toEqual([`/api/docs/${DOC}/edit-session/flush`]);
  });

  it("sends it with keepalive, the only spelling that survives an unload", async () => {
    // `navigator.sendBeacon` cannot call this route: it sets no request headers
    // at all, so it carries no bearer token and is answered `401`
    // (CONTRACT-031, measured against a real socket).
    const seen: Request[] = [];
    const transport: Wire = {
      posts: [],
      fetch: (input, init) => {
        seen.push(new Request(input, init));
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    };
    render(<Host transport={transport} />);

    edited(DOC)();
    await settleRequest();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.keepalive).toBe(true);
    expect(seen[0]?.method).toBe("POST");
  });

  it("flushes on the tab-close sequence, after the handlers that write", async () => {
    // Ordering, not decoration: the acknowledgment describes the commit range
    // as it stands, so it has to be issued after the buffered `PUT`s.
    const order: string[] = [];
    const transport: Wire = {
      posts: [],
      fetch: () => {
        order.push("flush-session");
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    };
    render(<Host transport={transport} />);
    onPageHide("flush", () => {
      order.push("save-buffer");
    });

    edited(DOC);
    window.dispatchEvent(new Event("pagehide"));
    await settleRequest();

    expect(order).toEqual(["save-buffer", "flush-session"]);
  });

  it("takes its client and its unload hook back down with it", () => {
    const transport = wire();
    const view = render(<Host transport={transport} />);
    view.unmount();

    edited(DOC);
    window.dispatchEvent(new Event("pagehide"));
    settle();

    expect(transport.posts).toEqual([]);
  });
});
