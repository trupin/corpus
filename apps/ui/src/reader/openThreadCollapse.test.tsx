/** @vitest-environment jsdom */
import type { Doc } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { openThreadReadState } from "./DocView.js";
import { Reader } from "./Reader.js";
import { resetEscapeLayers } from "./useEscapeStack.js";

/**
 * PR #25 review, MAJOR — **a thread that is the open document is placed by the
 * same rule as every other placement.**
 *
 * SPEC.md §6 states it as a property of `status`: "a resolved thread is
 * collapsed by default *wherever it is shown*". §11 enumerates the placements
 * and names this one — "a `type: thread` document open in a reader in a column
 * or in full screen" — and settles the direction outright: "a change to the
 * thread's status re-asserts the rule and clears that override, **so resolving a
 * conversation collapses it even while it is open on screen**". The reader's own
 * precedence over the rule is about "collapsing or expanding it *yourself*", an
 * explicit gesture; opening a reader is a placement, not a gesture.
 *
 * Driven through the real `Reader`, because the whole finding is about what one
 * prop at one call site does — a test of the rules module would have agreed with
 * the rules module, which was never wrong.
 */

const PARENT = "doc_m";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  resetSeenMarks();
  clearCollapseState();
  resetEscapeLayers();
  vi.unstubAllGlobals();
});

const TURNS = [
  { author: "user" as const, ts: "2026-07-01T09:00:00.000Z", body: "Settled?", model: null },
  { author: "agent" as const, ts: "2026-07-01T09:05:00.000Z", body: "Settled.", model: null },
];

function threadDoc(id: string): Doc {
  return docFixture({
    frontmatter: { id, type: "thread", title: "Which lenders?" },
    path: `data/docs/threads/${id}.md`,
  });
}

const PARENT_DOC = docFixture({
  frontmatter: {
    id: PARENT,
    title: "Rates memo",
    anchors: { anc_1: { exact: "yield curve", prefix: "shape of the ", suffix: " today." } },
  },
  body: "Short memo about the shape of the yield curve today.\n",
  anchors: [
    {
      anchorId: "anc_1",
      threadId: "th_x",
      threadStatus: "open",
      selector: { exact: "yield curve", prefix: "shape of the ", suffix: " today." },
      range: { start: 36, end: 47 },
      orphaned: false,
    },
  ],
});

interface Scenario {
  /** `null` is SPEC.md §6's standalone thread — the one with no row to find. */
  readonly parent: string | null;
  readonly status?: "open" | "resolved";
  readonly unread?: boolean;
}

function wire(id: string, { parent, status = "open", unread = false }: Scenario): ReaderTransport {
  const rows =
    parent === null
      ? {}
      : {
          [threadsSearch(parent)]: [
            threadRowFixture({ id, parent, status, unread, turnCount: TURNS.length }),
          ],
        };
  return readerTransport({
    docs: [threadDoc(id), PARENT_DOC],
    threads: [threadFixture({ id, parent, status, turns: TURNS })],
    rows: {
      ...rows,
      [threadsSearch(id)]: [],
      [backlinksSearch(id)]: [],
    },
  });
}

function open(id: string, transport: ReaderTransport): ReactElement {
  return <Column docId={id} transport={transport} />;
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

function panel(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-thread-panel="${id}"]`);
}

/**
 * Deliberately strict about a missing panel: `panel(id)?.…` answers `undefined`
 * for a conversation that is not on screen at all, and `undefined !== null`
 * would have read as "folded" — a test passing on a reader that rendered
 * nothing.
 */
function isFolded(id: string): boolean {
  const found = panel(id);
  if (found === null) throw new Error(`no panel for ${id}`);
  return found.querySelector("[data-thread-expand]") !== null;
}

async function placed(id: string): Promise<void> {
  await waitFor(() => {
    expect(panel(id)).not.toBeNull();
  });
}

describe("a resolved thread opened as its own document", () => {
  it("is placed collapsed, and expands where it stands", async () => {
    render(open("th_x", wire("th_x", { parent: PARENT, status: "resolved" })));
    await placed("th_x");
    expect(isFolded("th_x")).toBe(true);
    // Collapsed is never hidden: the line still says what the conversation is.
    const line = panel("th_x")?.querySelector("[data-thread-expand]") as HTMLElement;
    expect(line.textContent).toContain("2 turns");
    expect(line.textContent).toContain("resolved");

    fireEvent.click(line);
    await waitFor(() => {
      expect(panel("th_x")?.querySelectorAll(".turn")).toHaveLength(TURNS.length);
    });
    // In place — the reader never left the document it was on.
    expect(document.querySelector('.reader[data-reader-doc="th_x"]')).not.toBeNull();
  });

  it("is left open when it holds a turn nobody has seen", async () => {
    render(open("th_x", wire("th_x", { parent: PARENT, status: "resolved", unread: true })));
    await placed("th_x");
    await waitFor(() => {
      expect(panel("th_x")?.querySelectorAll(".turn")).toHaveLength(TURNS.length);
    });
    // §11's interlock, and it is the clause that keeps the fold from being a way
    // to lose messages — read off the thread's own row, not assumed.
    expect(isFolded("th_x")).toBe(false);
  });
});

/**
 * The half of §11 that is not open to interpretation: "a change to the thread's
 * status re-asserts the rule… so resolving a conversation collapses it even
 * while it is open on screen".
 */
describe("resolving a thread while it is the open document", () => {
  it("collapses it, and reopening expands it again", async () => {
    render(open("th_x", wire("th_x", { parent: PARENT })));
    await placed("th_x");
    await waitFor(() => {
      expect(panel("th_x")?.querySelectorAll(".turn")).toHaveLength(TURNS.length);
    });
    expect(isFolded("th_x")).toBe(false);

    fireEvent.click(document.querySelector('[data-resolve="th_x"]') as HTMLElement);
    await waitFor(() => {
      expect(isFolded("th_x")).toBe(true);
    });

    // Reopening is the same rule, the other way round.
    fireEvent.click(panel("th_x")?.querySelector("[data-thread-expand]") as HTMLElement);
    await waitFor(() => {
      expect(document.querySelector('[data-resolve="th_x"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-resolve="th_x"]') as HTMLElement);
    await waitFor(() => {
      expect(panel("th_x")?.querySelector(".t-status")?.textContent).toBe("open");
    });
    expect(isFolded("th_x")).toBe(false);
  });

  /**
   * A standalone thread has no parent to list, so there is no row to read
   * `unread` off. The fallback is what this browser has displayed
   * (`hasSeenMark`): before that the answer is **unknown** and the rule stands
   * down, so it is placed open; once displayed, the answer is `read` and the
   * resolve folds it.
   */
  it("collapses a standalone thread too, once the reader has been shown it", async () => {
    const transport = wire("th_solo", { parent: null });
    render(open("th_solo", transport));
    await placed("th_solo");
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_solo/seen")).toHaveLength(1);
    });
    expect(isFolded("th_solo")).toBe(false);

    fireEvent.click(document.querySelector('[data-resolve="th_solo"]') as HTMLElement);
    await waitFor(() => {
      expect(isFolded("th_solo")).toBe(true);
    });
  });
});

/**
 * PR #25 re-review, MAJOR — **the fallback no longer claims to know.**
 *
 * Read state is the server's (SPEC.md §7: `.corpus/seen.json`, and it "survives
 * browser changes"). Where this placement has no row it used to answer the
 * interlock with `!hasSeenMark(…)` — a module-level `Map` with a page session's
 * lifetime, reporting a conversation the server knows was read as carrying
 * something unseen. It reached the same placement §11's interlock would have
 * chosen, by asserting a fact it did not have; the honest answer is that it does
 * not know, and the rule stands down on that rather than on a guess.
 *
 * The mark can confirm a read and can never deny one, which is the whole of the
 * asymmetry below. A field on the thread resource deletes this branch:
 * `issues/contract/036-thread-unread-field.md`.
 */
describe("what a thread opened as a document knows about its read state", () => {
  const thread = threadFixture({ id: "th_x", parent: PARENT, turns: TURNS });

  it("reads the row when there is one, including its null", () => {
    const row = (unread: boolean | null) =>
      threadRowFixture({ id: "th_x", parent: PARENT, unread, turnCount: TURNS.length });
    expect(openThreadReadState("th_x", thread, row(true))).toBe("unread");
    expect(openThreadReadState("th_x", thread, row(false))).toBe("read");
    expect(openThreadReadState("th_x", thread, row(null))).toBe("unknown");
  });

  it("answers `unknown` with no row and no mark, rather than guessing unread", () => {
    // The reviewer's case: a standalone thread, read long ago on the server, in
    // a browser that has not displayed it since the page loaded.
    expect(openThreadReadState("th_x", thread, undefined)).toBe("unknown");
  });

  it("answers `read` for a conversation with nothing in it to have read", () => {
    // Not a guess: `useMarkSeenOnce` never marks a turnless thread either,
    // because there is nothing to record.
    expect(openThreadReadState("th_x", threadFixture({ id: "th_x", turns: [] }), undefined)).toBe(
      "read",
    );
    expect(openThreadReadState("th_x", undefined, undefined)).toBe("read");
  });
});
