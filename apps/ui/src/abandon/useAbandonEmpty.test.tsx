/** @vitest-environment jsdom */
import type { CorpusClient } from "@corpus/kit";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavEntry } from "../board/useBoardLocalState";
import { Reader } from "../reader/Reader";
import { pushEntry } from "../reader/useNavStack";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import {
  docFixture,
  readerTransport,
  threadRowFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture";
import { onPageHide, resetPageHide } from "./pagehide";
import { isAbandoned, publishDoc, releaseDoc, resetAbandonRegistry, retainDoc } from "./registry";
import { setUnloadClient } from "./unloadClient";
import { useAbandonEmptyDoc } from "./useAbandonEmpty";

/**
 * The exit path, driven through the **real** reader.
 *
 * The predicate has its own suite; what this one proves is the seam — that
 * every way a document stops being displayed reaches it, that the result is a
 * real `DELETE` on the wire rather than a row vanishing from a list, and that
 * a document with any content survives all of it (SPEC.md §11).
 *
 * The disk, git and projection half of the evidence cannot come from here
 * — jsdom has no workspace — and comes from the issue's real-app drill
 * (sprint-016 Adjudication 19).
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  resetSeenMarks();
  resetAbandonRegistry();
  resetPageHide();
  setUnloadClient(null);
  vi.restoreAllMocks();
});

const BLANK = docFixture({
  frontmatter: { id: "doc_blank", title: "Untitled" },
  body: "",
  path: "data/docs/inbox/doc_blank.md",
});

const NAMED = docFixture({
  frontmatter: { id: "doc_named", title: "Quarterly planning" },
  body: "",
  path: "data/docs/inbox/doc_named.md",
});

const WRITTEN = docFixture({
  frontmatter: { id: "doc_written", title: "Untitled" },
  body: "a thought worth keeping",
  path: "data/docs/inbox/doc_written.md",
});

const RATES = docFixture({
  frontmatter: { id: "doc_rates", title: "Rates" },
  body: "6.4% this week.",
});

const BACK = "‹ Inbox";

interface HostProps {
  readonly wire: ReaderTransport;
  readonly initial: readonly NavEntry[];
}

/** A column, reduced to what it owns: a navigation stack and a list behind it. */
function Host({ wire, initial }: HostProps): ReactElement {
  const [nav, setNav] = useState<readonly NavEntry[]>(initial);
  const [harness] = useState(() => createCorpusTestHarness({ fetch: wire.fetch }));
  return (
    <harness.Wrapper>
      <div className="col">
        <button
          type="button"
          onClick={() => {
            // Exactly what the board does when a row, a search hit or a console
            // link opens a document into a column that is already reading.
            setNav(pushEntry(nav, "doc_rates", 0));
          }}
        >
          open rates
        </button>
        {nav.length === 0 ? (
          <p>the list</p>
        ) : (
          <Reader
            columnId="doc_col"
            columnTitle="Inbox"
            nav={nav}
            setNav={setNav}
            selectTitle={false}
            isActive
            onFocusMode={() => undefined}
            onNotify={() => undefined}
          />
        )}
      </div>
    </harness.Wrapper>
  );
}

function wireFor(docs: readonly ReturnType<typeof docFixture>[]): ReaderTransport {
  return readerTransport({
    docs: [...docs],
    rows: Object.fromEntries(docs.map((doc) => [threadsSearch(doc.frontmatter.id), []])),
  });
}

async function opened(title: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByDisplayValue(title)).toBeTruthy();
  });
}

function press(name: string): void {
  act(() => {
    screen.getByRole("button", { name }).click();
  });
}

describe("leaving an empty document", () => {
  it("removes it when the reader returns to its list", async () => {
    const wire = wireFor([BLANK]);
    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");

    press(BACK);

    await waitFor(() => {
      expect(wire.of("DELETE", "/api/docs/doc_blank")).toHaveLength(1);
    });
    expect(screen.getByText("the list")).toBeTruthy();
  });

  it("keeps a document that has a title", async () => {
    const wire = wireFor([NAMED]);
    render(<Host wire={wire} initial={[{ docId: "doc_named", scrollY: 0 }]} />);
    await opened("Quarterly planning");

    press(BACK);

    await waitFor(() => {
      expect(screen.getByText("the list")).toBeTruthy();
    });
    expect(wire.of("DELETE")).toHaveLength(0);
  });

  /**
   * UI-017 eval FAIL-1, as a test.
   *
   * The title field commits on `Enter` — and `Enter` is a keystroke nothing in
   * the UI asks for. Before the fix, typing a title and leaving kept the
   * document (the abandon rule read the uncommitted draft) **and** threw the
   * title away, producing exactly the untitled empty document this issue
   * exists to delete.
   */
  it("persists the title a user typed and left without pressing Enter", async () => {
    const wire = wireFor([BLANK]);
    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");

    fireEvent.change(screen.getByLabelText("Document title"), {
      target: { value: "Budget review 2027" },
    });
    press(BACK);

    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_blank")).toHaveLength(1);
    });
    expect(wire.of("PUT", "/api/docs/doc_blank")[0]?.body).toEqual({
      title: "Budget review 2027",
    });
    expect(wire.of("DELETE")).toHaveLength(0);
  });

  it("still removes a document whose typed title was erased again", async () => {
    const wire = wireFor([BLANK]);
    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");

    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Budget review 2027" } });
    fireEvent.change(title, { target: { value: "" } });
    press(BACK);

    await waitFor(() => {
      expect(wire.of("DELETE", "/api/docs/doc_blank")).toHaveLength(1);
    });
    // Nothing was written on the way out: an erased title is not a change.
    expect(wire.of("PUT", "/api/docs/doc_blank")).toHaveLength(0);
  });

  it("does not write an uncommitted title onto the document that took the reader", async () => {
    const wire = wireFor([BLANK, RATES]);
    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");

    fireEvent.change(screen.getByLabelText("Document title"), {
      target: { value: "Budget review 2027" },
    });
    press("open rates");
    await opened("Rates");

    await waitFor(() => {
      expect(wire.of("PUT", "/api/docs/doc_blank")).toHaveLength(1);
    });
    expect(wire.of("PUT", "/api/docs/doc_rates")).toHaveLength(0);
    expect(screen.getByLabelText("Document title")).toHaveProperty("value", "Rates");
  });

  it("keeps a document that has a body", async () => {
    const wire = wireFor([WRITTEN]);
    render(<Host wire={wire} initial={[{ docId: "doc_written", scrollY: 0 }]} />);
    await opened("Untitled");

    press(BACK);

    await waitFor(() => {
      expect(screen.getByText("the list")).toBeTruthy();
    });
    expect(wire.of("DELETE")).toHaveLength(0);
  });

  it("keeps a document that acquired a thread", async () => {
    const wire = readerTransport({
      docs: [BLANK],
      rows: { [threadsSearch("doc_blank")]: [threadRowFixture({ parent: "doc_blank" })] },
    });
    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /threads on this document/i })).toBeTruthy();
    });

    press(BACK);

    await waitFor(() => {
      expect(screen.getByText("the list")).toBeTruthy();
    });
    expect(wire.of("DELETE")).toHaveLength(0);
  });

  it("removes it when another document takes over the reader, and drops its entry", async () => {
    const wire = wireFor([BLANK, RATES]);
    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");

    press("open rates");
    await opened("Rates");

    await waitFor(() => {
      expect(wire.of("DELETE", "/api/docs/doc_blank")).toHaveLength(1);
    });

    // Back never lands on the removed document: its entry went with it, so the
    // one press below reaches the list (sprint-016 TEST-428).
    press(BACK);
    await waitFor(() => {
      expect(screen.getByText("the list")).toBeTruthy();
    });
  });

  it("removes it when the tab goes away", async () => {
    const wire = wireFor([BLANK]);
    const deleteDoc = vi.fn(() =>
      Promise.resolve({ deletedId: "doc_blank", orphanedThreadIds: [], warnings: [] }),
    );
    setUnloadClient({ deleteDoc } as unknown as CorpusClient);

    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    await waitFor(() => {
      expect(deleteDoc).toHaveBeenCalledWith("doc_blank");
    });
  });

  /**
   * The tab-close ordering, as a test (PR #12 review, MINOR 14).
   *
   * On every other exit route the abandon decision is taken in a *layout*-effect
   * teardown, which React runs ahead of the passive teardowns carrying the
   * flushes (sprint-016 TEST-425). Nothing unmounts on `pagehide`, so the
   * ordering there is whatever the registration order was — and registration
   * order is effect order, which is child-before-parent: the editor's flush
   * registers **before** the reader's decision. The probe below stands in for
   * that flush and registers first, deliberately.
   */
  it("has decided the removal before any flush handler runs", async () => {
    const wire = wireFor([BLANK]);
    const deleteDoc = vi.fn(() =>
      Promise.resolve({ deletedId: "doc_blank", orphanedThreadIds: [], warnings: [] }),
    );
    setUnloadClient({ deleteDoc } as unknown as CorpusClient);

    const seen: boolean[] = [];
    const off = onPageHide("flush", () => {
      // What `useAutosave.flush` and `FrontmatterForm`'s exit flush consult
      // before writing. False here is a `PUT` chasing the `DELETE` below.
      seen.push(isAbandoned("doc_blank"));
    });

    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    off();

    expect(seen).toEqual([true]);
    await waitFor(() => {
      expect(deleteDoc).toHaveBeenCalledWith("doc_blank");
    });
  });

  /**
   * The typed title, on the one exit an ordinary `PUT` does not survive
   * (PR #12 review, MINOR 13).
   *
   * The document is kept — a typed title is a document — so what has to reach
   * the server is the title itself, through the keepalive client rather than
   * through a request the browser cancels as it tears the page down.
   */
  it("sends a typed title through the keepalive client when the tab goes away", async () => {
    const wire = wireFor([BLANK]);
    const updateDoc = vi.fn(() =>
      Promise.resolve({ id: "doc_blank", path: BLANK.path, anchors: {}, warnings: [] }),
    );
    const deleteDoc = vi.fn(() =>
      Promise.resolve({ deletedId: "doc_blank", orphanedThreadIds: [], warnings: [] }),
    );
    setUnloadClient({ updateDoc, deleteDoc } as unknown as CorpusClient);

    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");
    fireEvent.change(screen.getByLabelText("Document title"), {
      target: { value: "Budget review 2027" },
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(updateDoc).toHaveBeenCalledWith("doc_blank", { title: "Budget review 2027" });
    // The title is what keeps the document, so nothing may delete it — and the
    // ordinary client, whose request the unload would cancel, is not used.
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(wire.of("PUT", "/api/docs/doc_blank")).toHaveLength(0);
  });

  it("writes nothing on the way out when the document is being removed", async () => {
    const wire = wireFor([BLANK]);
    const updateDoc = vi.fn();
    const deleteDoc = vi.fn(() =>
      Promise.resolve({ deletedId: "doc_blank", orphanedThreadIds: [], warnings: [] }),
    );
    setUnloadClient({ updateDoc, deleteDoc } as unknown as CorpusClient);

    render(<Host wire={wire} initial={[{ docId: "doc_blank", scrollY: 0 }]} />);
    await opened("Untitled");
    const title = screen.getByLabelText("Document title");
    fireEvent.change(title, { target: { value: "Budget review 2027" } });
    fireEvent.change(title, { target: { value: "" } });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    await waitFor(() => {
      expect(deleteDoc).toHaveBeenCalledWith("doc_blank");
    });
    // The draft the flush would have carried is the emptiness that decided the
    // removal: the `decide` phase has already said so by the time it asks.
    expect(updateDoc).not.toHaveBeenCalled();
    expect(wire.of("PUT", "/api/docs/doc_blank")).toHaveLength(0);
  });
});

/** A host that does nothing but display a document — focus mode's shape. */
function Displays({ docId }: { readonly docId: string }): ReactElement {
  useAbandonEmptyDoc({ docId, doc: undefined, threadCount: 0, onAbandoned: () => undefined });
  return <p>{docId}</p>;
}

describe("two hosts on one document", () => {
  it("does not remove a document a second reader still has open", async () => {
    const wire = wireFor([BLANK]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    // The column reader's own retain, standing in for the column behind the
    // overlay: closing focus mode over a document its column still shows is not
    // an exit.
    publishDoc("doc_blank", {
      type: "note",
      title: "Untitled",
      body: "",
      threadCount: 0,
      hasExtra: false,
    });
    retainDoc("doc_blank");

    const view = render(
      <harness.Wrapper>
        <Displays docId="doc_blank" />
      </harness.Wrapper>,
    );
    view.unmount();

    await waitFor(() => {
      expect(wire.of("DELETE")).toHaveLength(0);
    });
    expect(releaseDoc("doc_blank")).toBe(true);
  });
});
