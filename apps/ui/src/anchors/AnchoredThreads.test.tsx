/** @vitest-environment jsdom */
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createRef, useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../testing/memoryStorage.js";
import {
  readerTransport,
  threadFixture,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture.js";
import { columnSurface, clearCollapseState } from "../thread/threadCollapse.js";
import { ThreadCollapseProvider } from "../thread/ThreadCollapseContext.js";
import { AnchorChips, MarginColumn } from "./AnchoredThreads.js";
import type { AnchoredThread } from "./anchorPlacement.js";

/**
 * PR #25 review, MINOR — **an anchored conversation never disappears**.
 *
 * A document's threads are one paginated list; its anchors are not. Past the
 * page limit the rows simply are not in the answer, and a placement that keyed
 * on the row dropped those conversations out of the margin while their
 * highlights stayed in the body — permanently on a document that busy, and for a
 * frame on every first paint. SPEC.md §11: "its anchored highlight stays in the
 * body, so the passage still says it has been discussed and *the conversation is
 * still reachable from it*".
 *
 * The rowed case is asserted beside it so the fix cannot be read as "the margin
 * stopped folding": a resolved conversation the list *does* describe is still
 * placed collapsed by the rule.
 */

const DOC = "doc_m";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  resetSeenMarks();
  clearCollapseState();
  vi.unstubAllGlobals();
});

function wire(): ReaderTransport {
  return readerTransport({
    threads: [
      threadFixture({
        id: "th_rowed",
        parent: DOC,
        status: "resolved",
        turns: [{ author: "user", ts: "2026-07-01T09:00:00.000Z", body: "Settled?" }],
      }),
      threadFixture({
        id: "th_overflow",
        parent: DOC,
        status: "resolved",
        turns: [
          { author: "user", ts: "2026-07-01T09:00:00.000Z", body: "Past the page limit." },
          { author: "agent", ts: "2026-07-01T09:05:00.000Z", body: "Still a conversation." },
        ],
      }),
    ],
  });
}

/**
 * Two anchored threads on one document: one the thread list described, one it
 * did not — which is exactly what a document with more threads than one page of
 * `useDocs` holds looks like to this component.
 */
function threads(): AnchoredThread[] {
  const placement = (threadId: string) => ({
    anchorId: `anc_${threadId}`,
    threadId,
    resolved: true,
    turnCount: 0,
    segments: [{ from: 1, to: 5, block: 0 }],
  });
  return [
    {
      anchorId: "anc_th_rowed",
      threadId: "th_rowed",
      row: threadRowFixture({
        id: "th_rowed",
        parent: DOC,
        status: "resolved",
        anchorQuote: "lender spreads",
        turnCount: 1,
        lastAuthor: "user",
      }),
      orphaned: false,
      quote: "lender spreads",
      placement: { ...placement("th_rowed"), turnCount: 1 },
    },
    {
      anchorId: "anc_th_overflow",
      threadId: "th_overflow",
      row: undefined,
      orphaned: false,
      quote: "yield curve",
      placement: placement("th_overflow"),
    },
  ];
}

function panel(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-thread-panel="${id}"]`);
}

/** Strict about a missing panel: `undefined !== null` would read as "folded". */
function isFolded(id: string): boolean {
  const found = panel(id);
  if (found === null) throw new Error(`no panel for ${id}`);
  return found.querySelector("[data-thread-expand]") !== null;
}

function Margin({ transport }: { readonly transport: ReaderTransport }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ThreadCollapseProvider surfaceKey={columnSurface("col_a")}>
        <MarginColumn
          threads={threads()}
          parentId={DOC}
          flashThread={null}
          onOpenDoc={() => undefined}
          onNotify={() => undefined}
          innerRef={createRef<HTMLDivElement>()}
        />
      </ThreadCollapseProvider>
    </harness.Wrapper>
  );
}

function Chips({ transport }: { readonly transport: ReaderTransport }): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  const [hosts] = useState(() => {
    const made = new Map<string, HTMLElement>();
    for (const id of ["th_rowed", "th_overflow"]) {
      const host = document.createElement("div");
      host.setAttribute("data-chip-host", id);
      document.body.append(host);
      made.set(id, host);
    }
    return made;
  });
  return (
    <harness.Wrapper>
      <ThreadCollapseProvider surfaceKey={columnSurface("col_a")}>
        <AnchorChips
          threads={threads()}
          parentId={DOC}
          flashThread={null}
          onOpenDoc={() => undefined}
          onNotify={() => undefined}
          hostFor={(id) => hosts.get(id) ?? null}
        />
      </ThreadCollapseProvider>
    </harness.Wrapper>
  );
}

describe.each([
  ["in the margin", Margin],
  ["as a chip at its anchor", Chips],
])("a document with more threads than one page of rows, %s", (_, Host) => {
  it("still shows every anchored conversation", async () => {
    render(<Host transport={wire()} />);
    await waitFor(() => {
      expect(panel("th_rowed")).not.toBeNull();
    });
    // The one the list never described is on screen too — not dropped.
    expect(panel("th_overflow")).not.toBeNull();
  });

  it("keeps the row-less one reachable: its conversation, not a line claiming no turns", async () => {
    render(<Host transport={wire()} />);
    await waitFor(() => {
      expect(panel("th_overflow")?.querySelectorAll(".turn")).toHaveLength(2);
    });
    // Placed expanded, because nothing here can vouch that it has been seen —
    // §11's interlock, which is what keeps the fold from hiding a new turn.
    expect(isFolded("th_overflow")).toBe(false);
  });

  it("still folds the resolved one the list did describe", async () => {
    render(<Host transport={wire()} />);
    await waitFor(() => {
      expect(panel("th_rowed")).not.toBeNull();
    });
    expect(isFolded("th_rowed")).toBe(true);
    expect(panel("th_rowed")?.querySelector(".thread-card")).toBeNull();
  });
});
