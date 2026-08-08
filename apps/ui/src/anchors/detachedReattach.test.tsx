/** @vitest-environment jsdom */
import type { DocRow, ResolvedAnchor } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../testing/memoryStorage.js";
import { readerTransport, threadRowFixture } from "../testing/readerFixture.js";
import { clearCollapseState, columnSurface } from "../thread/threadCollapse.js";
import { ThreadCollapseProvider } from "../thread/ThreadCollapseContext.js";
import { DetachedThreads, type ReattachContext } from "./AnchoredThreads.js";

/**
 * Which detached threads are offered a way back (UI-086).
 *
 * The section lists three different kinds of thread and only one of them has
 * something to repair. A whole-document comment has no passage to search for and
 * the route refuses to give it one (`not-anchored`); a thread the *view* cannot
 * place is not detached at all — its quote is still in the document, and
 * offering to move it would report a data loss that has not happened (UI-062).
 */

const DOC = "doc_p";
const BODY = [
  "- Review the Q1 report by Friday",
  "- Review the Q3 report by Friday",
  "- Review the Q4 report by Friday",
].join("\n");

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  resetSeenMarks();
  clearCollapseState();
  vi.unstubAllGlobals();
});

function row(id: string, quote: string): DocRow {
  return threadRowFixture({
    id,
    parent: DOC,
    status: "open",
    anchorQuote: quote,
    turnCount: 1,
    lastAuthor: "user",
  });
}

const ORPHAN: ResolvedAnchor = {
  anchorId: "anc_orphan",
  threadId: "th_orphan",
  threadStatus: "open",
  selector: { exact: "Review the Q2 report by Friday", prefix: "", suffix: "" },
  range: null,
  orphaned: true,
};

interface HostProps {
  readonly orphaned?: readonly DocRow[];
  readonly wholeDocument?: readonly DocRow[];
  readonly unplaced?: readonly DocRow[];
  /** `null` stands for a surface that passes no context at all. */
  readonly reattach?: ReattachContext | null;
}

function Host({
  orphaned = [row("th_orphan", "Review the Q2 report by Friday")],
  wholeDocument = [],
  unplaced = [],
  reattach = { docId: DOC, body: BODY, anchors: [ORPHAN] },
}: HostProps): ReactElement {
  const transport = readerTransport({ threads: [] });
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ThreadCollapseProvider surfaceKey={columnSurface("col_detached")}>
        <DetachedThreads
          wholeDocument={wholeDocument}
          orphaned={orphaned}
          unplaced={unplaced}
          reattach={reattach ?? undefined}
          flashThread={null}
          onOpenDoc={() => undefined}
          onNotify={() => undefined}
        />
      </ThreadCollapseProvider>
    </harness.Wrapper>
  );
}

const offers = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-reattach]")];

describe("DetachedThreads — the re-attach offer", () => {
  it("offers a way back to a thread whose quote the document no longer holds", () => {
    render(<Host />);

    expect(offers()).toHaveLength(1);
    expect(offers()[0]?.getAttribute("data-reattach")).toBe("th_orphan");
    expect(document.querySelector("[data-thread-panel='th_orphan']")).not.toBeNull();
  });

  it("offers nothing to a whole-document thread, which has no passage to repair", () => {
    render(<Host orphaned={[]} wholeDocument={[row("th_whole", "")]} />);

    expect(document.querySelector("[data-thread-panel='th_whole']")).not.toBeNull();
    expect(offers()).toHaveLength(0);
  });

  it("offers nothing to a thread this view merely cannot place", () => {
    render(<Host orphaned={[]} unplaced={[row("th_unplaced", "lender spreads")]} />);

    expect(document.querySelector("[data-thread-panel='th_unplaced']")).not.toBeNull();
    expect(offers()).toHaveLength(0);
  });

  it("still lists an orphan on a surface with no body to point into", () => {
    render(<Host reattach={null} />);

    expect(document.querySelector("[data-thread-panel='th_orphan']")).not.toBeNull();
    expect(offers()).toHaveLength(0);
  });

  it("offers nothing for an anchor the server did resolve", () => {
    const resolved: ResolvedAnchor = { ...ORPHAN, orphaned: false, range: { start: 0, end: 5 } };
    render(<Host reattach={{ docId: DOC, body: BODY, anchors: [resolved] }} />);

    expect(offers()).toHaveLength(0);
  });
});
