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
 * collapsed by default *wherever it is shown*". §10 enumerates the placements
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
    /*
     * `unread` on the conversation as well as on the row, and the same value on
     * both: the contract makes them the same comparison (CONTRACT-036), so a
     * fixture where they disagreed would be testing a wire that cannot happen.
     * The placement reads the conversation's — the row is here for the surfaces
     * that list it.
     */
    threads: [threadFixture({ id, parent, status, unread, turns: TURNS })],
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
    // §10's interlock, and it is the clause that keeps the fold from being a way
    // to lose messages — read off the thread's own row, not assumed.
    expect(isFolded("th_x")).toBe(false);
  });
});

/**
 * The half of §10 that is not open to interpretation: "a change to the thread's
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
   * **The reload case, and the bug UI-169 closes.**
   *
   * A standalone thread has no parent to list, so there was no row to read
   * `unread` off and the placement fell back to `hasSeenMark` — a module-level
   * `Map` with a page session's lifetime. A fresh page has an empty one, so the
   * answer was `unknown`, the rule stood down, and a resolved standalone thread
   * opened **expanded** on its first visit after every reload however long ago
   * it was read. `resetSeenMarks()` in `afterEach` is that empty map: this test
   * renders into one, which is exactly the state a reload leaves behind.
   *
   * Falsify by restoring the fallback — the placement goes back to `unknown` and
   * this expectation flips to `false`.
   */
  it("is placed collapsed on a fresh page, with nothing in this session's seen marks", async () => {
    const transport = wire("th_solo", { parent: null, status: "resolved" });
    render(open("th_solo", transport));
    await placed("th_solo");
    // Before any mark this page could have sent — the server's answer alone.
    expect(transport.of("POST", "/api/threads/th_solo/seen")).toHaveLength(0);
    expect(isFolded("th_solo")).toBe(true);
  });

  /**
   * The interlock still wins for a standalone thread: a resolved conversation
   * holding an unseen turn is not folded by the rule (§10). Same placement, same
   * source, opposite answer — which is what makes the test above a fact about
   * the wire rather than about a constant.
   */
  it("is left open when a standalone thread holds a turn nobody has seen", async () => {
    render(open("th_solo", wire("th_solo", { parent: null, status: "resolved", unread: true })));
    await placed("th_solo");
    expect(isFolded("th_solo")).toBe(false);
  });

  /**
   * And the status change still re-asserts the rule where the reader can watch
   * it happen — the standalone half of §10's "resolving a conversation collapses
   * it even while it is open on screen".
   */
  it("collapses a standalone thread when it is resolved on screen", async () => {
    const transport = wire("th_solo", { parent: null });
    render(open("th_solo", transport));
    await placed("th_solo");
    expect(isFolded("th_solo")).toBe(false);

    fireEvent.click(document.querySelector('[data-resolve="th_solo"]') as HTMLElement);
    await waitFor(() => {
      expect(isFolded("th_solo")).toBe(true);
    });
  });
});

/**
 * UI-169 — **the placement reads a field instead of guessing at one.**
 *
 * Read state is the server's (SPEC.md §7: `.corpus/seen.json`, and it "survives
 * browser changes"), and `Thread.unread` is where it reaches this placement
 * (CONTRACT-036). Two earlier sources are gone with it: the parent's thread list,
 * which a standalone thread never appears in, and `hasSeenMark`, a module-level
 * `Map` that could confirm a read and could never deny one.
 *
 * `unknown` stays in the type and keeps its meaning — a read still in flight —
 * and {@link DocView} declines to place the conversation until it lands, so the
 * rule is never applied to it.
 */
describe("what a thread opened as a document knows about its read state", () => {
  const thread = (unread: boolean) => threadFixture({ id: "th_x", unread, turns: TURNS });

  it("reads the conversation's own field, both ways", () => {
    expect(openThreadReadState(thread(true))).toBe("unread");
    expect(openThreadReadState(thread(false))).toBe("read");
  });

  /*
   * Not a placement the rule ever sees — `placementKnown` gates on the same
   * read — but the honest answer for a conversation that has not arrived is that
   * nothing is known about it, and it is what stops a fold being decided on a
   * `undefined` treated as false.
   */
  it("answers `unknown` while the conversation has not landed", () => {
    expect(openThreadReadState(undefined)).toBe("unknown");
  });
});
