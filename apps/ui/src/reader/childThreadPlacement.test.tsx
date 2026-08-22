/** @vitest-environment jsdom */
import type { Doc, DocRow, ResolvedAnchor } from "@corpus/contract";
import { resetSeenMarks, type ThreadTurn } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRegistry, EMPTY_REGISTRY, setPluginRegistry } from "../plugins/registry.js";
import { resetSlotCache } from "../plugins/slots.js";
import { memoryStorage } from "../testing/memoryStorage.js";
import {
  backlinksSearch,
  docFixture,
  readerTransport,
  threadFixture,
  threadRowFixture,
  threadsSearch,
  type ReaderTransport,
} from "../testing/readerFixture.js";
import { clearCollapseState } from "../thread/threadCollapse.js";
import { FocusMode } from "./FocusMode.js";
import { Reader } from "./Reader.js";
import { resetEscapeLayers } from "./useEscapeStack.js";

/**
 * UI-087 — **a child thread is rendered once.**
 *
 * SPEC.md §10 places a thread's children per turn, and reserves the list below
 * the body for threads that have "no place in the body". `DocView` used to key
 * that list off `anchorsHost`, which is false for every thread, so a thread
 * reader rendered `reader.threads` in full underneath a conversation that had
 * already placed every one of them — `placeChildThreads` splitting them into the
 * ones under their turn and the ones after the last turn, two sets that are
 * exhaustive and mutually exclusive. The whole conversation set, twice.
 *
 * **Counted, never merely found.** The defect is a *second* render, so
 * `getByText`/`not.toBeNull` passes identically before and after the fix and
 * proves nothing; every assertion here is on `querySelectorAll(...).length`.
 *
 * The last suite is the guard against the other way to make the count right: a
 * plugin `View` and the static markdown fallback place no threads at all, so for
 * them the below-body list is the *only* render and deleting the branch would
 * silently drop every thread on those documents.
 */

const THREAD = "th_x";

const ASK: ThreadTurn = {
  author: "user",
  ts: "2026-07-01T09:00:00.000Z",
  body: "Which lenders quoted?",
  model: null,
};
const REPLY: ThreadTurn = {
  author: "agent",
  ts: "2026-07-01T09:05:00.000Z",
  body: "Three did, at 6.4%.",
  model: null,
};
const TURNS: ThreadTurn[] = [ASK, REPLY];

/** The thread as a file — what its own anchors' ranges index into (SPEC.md §6). */
const THREAD_BODY = `## user\n\n${ASK.body}\n\n## agent\n\n${REPLY.body}\n`;

function rangeOf(quote: string): { start: number; end: number } {
  const start = THREAD_BODY.indexOf(quote);
  return { start, end: start + quote.length };
}

function anchorFor(threadId: string, quote: string, orphaned = false): ResolvedAnchor {
  return {
    anchorId: `anc_${threadId}`,
    threadId,
    threadStatus: "open",
    selector: { exact: quote, prefix: "", suffix: "" },
    range: orphaned ? null : rangeOf(quote),
    orphaned,
  };
}

/** A child on the first turn, one on the second, one orphaned, one whole-thread. */
const CHILDREN: readonly DocRow[] = [
  threadRowFixture({
    id: "th_c1",
    parent: THREAD,
    title: "About the question",
    anchorQuote: ASK.body,
  }),
  threadRowFixture({
    id: "th_c2",
    parent: THREAD,
    title: "About the answer",
    anchorQuote: REPLY.body,
  }),
  threadRowFixture({
    id: "th_orphan",
    parent: THREAD,
    title: "About words that moved",
    anchorQuote: "a rate nobody quoted",
  }),
  threadRowFixture({ id: "th_whole", parent: THREAD, title: "About all of it", anchorQuote: null }),
];

const CHILD_IDS = CHILDREN.map((row) => row.id);

const THREAD_DOC: Doc = docFixture({
  frontmatter: { id: THREAD, type: "thread", title: "Which lenders?" },
  path: `data/docs/threads/${THREAD}.md`,
  body: THREAD_BODY,
  anchors: [
    anchorFor("th_c1", ASK.body),
    anchorFor("th_c2", REPLY.body),
    // The server's verdict: the words this one quoted are gone. It belongs to the
    // conversation rather than to one of its turns, and `placeChildThreads`
    // routes it after the last turn — the one place a fix that removed the
    // below-body list could have dropped it.
    anchorFor("th_orphan", "a rate nobody quoted", true),
  ],
});

function threadWire(): ReaderTransport {
  return readerTransport({
    docs: [THREAD_DOC],
    threads: [
      threadFixture({ id: THREAD, parent: null, turns: TURNS }),
      ...CHILD_IDS.map((id) => threadFixture({ id, parent: THREAD, turns: [] })),
    ],
    rows: {
      [threadsSearch(THREAD)]: CHILDREN,
      [backlinksSearch(THREAD)]: [],
    },
  });
}

function Column({
  docId,
  transport,
}: {
  readonly docId: string;
  readonly transport: ReaderTransport;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <div className="col reading">
        <Reader
          columnId="doc_col"
          columnTitle="Finance"
          nav={[{ docId, scrollY: 0 }]}
          setNav={() => undefined}
          selectTitle={false}
          isActive
          onFocusMode={() => undefined}
          onNotify={() => undefined}
        />
      </div>
    </harness.Wrapper>
  );
}

/** The other host §10 names: the same `DocView`, full screen (SPEC.md §10's ⤢). */
function Focus({
  docId,
  transport,
}: {
  readonly docId: string;
  readonly transport: ReaderTransport;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <FocusMode
        docId={docId}
        listTitle="Finance"
        onClose={() => undefined}
        onNotify={() => undefined}
      />
    </harness.Wrapper>
  );
}

/** Every rendering of one conversation, anywhere on screen. */
function panelsOf(threadId: string): readonly Element[] {
  return [...document.querySelectorAll(`[data-thread-panel="${threadId}"]`)];
}

function turnOf(ts: string): Element {
  const turn = document.querySelector(`[data-turn-ts="${ts}"]`);
  if (turn === null) throw new Error(`no turn ${ts} on screen`);
  return turn;
}

async function conversationOnScreen(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelectorAll(`[data-thread-panel="${THREAD}"] .turn`)).toHaveLength(
      TURNS.length,
    );
  });
  await waitFor(() => {
    expect(panelsOf("th_c1").length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetSlotCache();
});

afterEach(() => {
  cleanup();
  setPluginRegistry(EMPTY_REGISTRY);
  resetSlotCache();
  resetSeenMarks();
  clearCollapseState();
  resetEscapeLayers();
  vi.unstubAllGlobals();
});

describe("a thread open in a reader, with children", () => {
  it("renders each child exactly once in a column", async () => {
    render(<Column docId={THREAD} transport={threadWire()} />);
    await conversationOnScreen();

    for (const id of CHILD_IDS) {
      expect(panelsOf(id)).toHaveLength(1);
    }
    // And no second listing of the set below the conversation.
    expect(document.querySelectorAll(".thread-slots")).toHaveLength(0);
  });

  /**
   * The report named both hosts, and the duplicate sat *above* the placement
   * split — it was never a width behaviour, which is exactly why it has to be
   * pinned at the other measure too rather than assumed to follow.
   */
  it("renders each child exactly once in full screen", async () => {
    render(<Focus docId={THREAD} transport={threadWire()} />);
    await conversationOnScreen();

    for (const id of CHILD_IDS) {
      expect(panelsOf(id)).toHaveLength(1);
    }
    expect(document.querySelectorAll(".thread-slots")).toHaveLength(0);
  });

  it("puts each anchored child under its own turn, and only there", async () => {
    render(<Column docId={THREAD} transport={threadWire()} />);
    await conversationOnScreen();

    const first = turnOf(ASK.ts);
    const second = turnOf(REPLY.ts);
    expect(first.querySelectorAll('[data-thread-panel="th_c1"]')).toHaveLength(1);
    expect(second.querySelectorAll('[data-thread-panel="th_c1"]')).toHaveLength(0);
    expect(second.querySelectorAll('[data-thread-panel="th_c2"]')).toHaveLength(1);
    expect(first.querySelectorAll('[data-thread-panel="th_c2"]')).toHaveLength(0);
  });

  /**
   * A whole-thread child and one whose anchor the server declared orphaned
   * belong to the conversation rather than to a turn: `placeChildThreads` lists
   * them after the last one — still inside the card, still reachable, and still
   * once.
   */
  it("keeps the whole-thread and orphaned children after the last turn", async () => {
    render(<Column docId={THREAD} transport={threadWire()} />);
    await conversationOnScreen();

    const turns = document.querySelector(`[data-thread-panel="${THREAD}"] .turns`);
    if (turns === null) throw new Error("the conversation rendered no turns");
    for (const id of ["th_whole", "th_orphan"]) {
      const placed = panelsOf(id);
      expect(placed).toHaveLength(1);
      const [panel] = placed;
      if (panel === undefined) throw new Error(`no panel for ${id}`);
      // Not under any turn…
      expect(turns.contains(panel)).toBe(false);
      // …and after all of them, rather than before the conversation.
      expect(turns.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

/**
 * The other half of the fix, and the reason it is not a deletion: these bodies
 * place nothing, so the list below them is the only render their threads get.
 */
const PLUGIN_TYPE = "fixture-note";

const PLUGIN_DOC = docFixture({
  frontmatter: { id: "doc_fx", type: PLUGIN_TYPE, title: "A fixture note" },
  body: "The body a plugin owns.",
});

const VIEW_DOC = docFixture({
  frontmatter: { id: "doc_v", type: "view", title: "A saved query" },
  body: "The description of a view.",
});

function installPluginView(): void {
  setPluginRegistry(
    buildRegistry([
      {
        dir: "fx",
        loaded: {
          module: {
            default: {
              id: "fx",
              name: "FX",
              docTypes: [
                {
                  type: PLUGIN_TYPE,
                  View: ({ doc }: { readonly doc: Doc }) => (
                    <p data-fx-view="">plugin view of {doc.frontmatter.title}</p>
                  ),
                },
              ],
              columns: [],
            },
          },
        },
      },
    ]),
  );
}

function docWire(doc: Doc, threads: readonly DocRow[]): ReaderTransport {
  const docId = doc.frontmatter.id;
  return readerTransport({
    docs: [doc],
    threads: threads.map((row) => threadFixture({ id: row.id, parent: docId, turns: [] })),
    rows: { [threadsSearch(docId)]: threads, [backlinksSearch(docId)]: [] },
  });
}

const ON_DOC: readonly DocRow[] = [
  threadRowFixture({
    id: "th_p1",
    parent: "doc_fx",
    title: "On the plugin doc",
    anchorQuote: null,
  }),
];

const ON_VIEW: readonly DocRow[] = [
  threadRowFixture({ id: "th_v1", parent: "doc_v", title: "On the view doc", anchorQuote: null }),
];

describe("a document whose body places no threads", () => {
  it("still lists them below a plugin View — exactly once", async () => {
    installPluginView();
    render(<Column docId="doc_fx" transport={docWire(PLUGIN_DOC, ON_DOC)} />);
    await waitFor(() => {
      expect(document.querySelectorAll("[data-fx-view]")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(panelsOf("th_p1")).toHaveLength(1);
    });
    expect(document.querySelectorAll(".thread-slots")).toHaveLength(1);
  });

  it("still lists them below a statically rendered body — exactly once", async () => {
    render(<Column docId="doc_v" transport={docWire(VIEW_DOC, ON_VIEW)} />);
    await waitFor(() => {
      expect(panelsOf("th_v1")).toHaveLength(1);
    });
    expect(document.querySelectorAll(".thread-slots")).toHaveLength(1);
    // The editor does not own a `view` document, so this really is the fallback.
    expect(document.querySelector('[data-doc-editor="doc_v"]')).toBeNull();
  });
});
