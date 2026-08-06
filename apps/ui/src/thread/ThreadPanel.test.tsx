/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarginColumn } from "../anchors/AnchoredThreads.js";
import type { AnchoredThread } from "../anchors/anchorPlacement.js";
import { ContextMenuProvider } from "../menu/ContextMenuHost.js";
import { memoryStorage } from "../testing/memoryStorage.js";
import {
  readerTransport,
  threadFixture,
  threadRowFixture,
  type ReaderTransport,
} from "../testing/readerFixture.js";
import { summaryFromRow } from "./CollapsedThread.js";
import { clearCollapseState, columnSurface } from "./threadCollapse.js";
import { ThreadCollapseProvider } from "./ThreadCollapseContext.js";
import { ThreadPanel } from "./ThreadPanel.js";

/**
 * UI-077: one conversation, two states, the same rules in every placement.
 *
 * The rider's own charge is that today's collapse behaviour depends on how wide
 * the window happens to be — so the notches here are asserted in **both**
 * placements the document view has: the panel a chip-at-anchor or below-body
 * list renders, and the panel the margin renders. `MarginColumn` is included
 * literally rather than approximated, because "the margin never even receives
 * the expansion state" was the defect.
 */

/*
 * Node 25 ships a Web Storage global that shadows jsdom's and is inert without
 * `--localstorage-file`, so a sticky-fold test against the ambient one would
 * pass whatever the code did. Stubbed with a real in-memory `Storage` instead
 * (`memoryStorage.ts` documents the environment defect); the real browser path
 * is in `e2e/collapse.spec.ts`.
 */
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  resetSeenMarks();
  clearCollapseState();
  vi.unstubAllGlobals();
});

const TURNS = [
  { author: "user" as const, ts: "2026-07-01T09:00:00.000Z", body: "Which lenders?" },
  { author: "agent" as const, ts: "2026-07-01T09:05:00.000Z", body: "Three of them." },
  { author: "agent" as const, ts: "2026-07-01T09:09:00.000Z", body: "Filed under finance." },
];

function openRow(overrides: Partial<DocRow> = {}): DocRow {
  return threadRowFixture({
    id: "th_open",
    parent: "doc_m",
    anchorQuote: "lender spreads",
    turnCount: 3,
    lastAuthor: "agent",
    status: "open",
    ...overrides,
  });
}

function resolvedRow(overrides: Partial<DocRow> = {}): DocRow {
  return openRow({
    id: "th_done",
    anchorQuote: "yield curve",
    status: "resolved",
    turnCount: 2,
    ...overrides,
  });
}

function wire(): ReaderTransport {
  return readerTransport({
    threads: [
      threadFixture({ id: "th_open", parent: "doc_m", turns: TURNS }),
      threadFixture({
        id: "th_done",
        parent: "doc_m",
        status: "resolved",
        turns: TURNS.slice(0, 2),
      }),
      threadFixture({ id: "th_deep", parent: "th_open", turns: TURNS.slice(0, 1) }),
    ],
  });
}

/** The placement a chip-at-anchor and a below-body list both render. */
function Slots({
  transport,
  rows,
  surfaceKey = columnSurface("col_a"),
}: {
  readonly transport: ReaderTransport;
  readonly rows: readonly DocRow[];
  readonly surfaceKey?: string;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ContextMenuProvider>
        <ThreadCollapseProvider surfaceKey={surfaceKey}>
          {rows.map((row) => (
            <ThreadPanel
              key={row.id}
              summary={summaryFromRow(row)}
              host="slot"
              onOpenDoc={() => undefined}
              onNotify={() => undefined}
            />
          ))}
        </ThreadCollapseProvider>
      </ContextMenuProvider>
    </harness.Wrapper>
  );
}

/** The margin placement — focus mode and any reader at least 1100px wide. */
function Margin({
  transport,
  rows,
}: {
  readonly transport: ReaderTransport;
  readonly rows: readonly DocRow[];
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  const threads: AnchoredThread[] = rows.map((row) => ({
    anchorId: `anc_${row.id}`,
    threadId: row.id,
    row,
    orphaned: false,
    quote: row.anchorQuote ?? "",
    placement: {
      anchorId: `anc_${row.id}`,
      threadId: row.id,
      resolved: row.status === "resolved",
      turnCount: row.turnCount ?? 0,
      segments: [],
    },
  }));
  return (
    <harness.Wrapper>
      <ThreadCollapseProvider surfaceKey={columnSurface("col_a")}>
        <MarginColumn
          threads={threads}
          flashThread={null}
          onOpenDoc={() => undefined}
          onNotify={() => undefined}
          innerRef={createRef<HTMLDivElement>()}
        />
      </ThreadCollapseProvider>
    </harness.Wrapper>
  );
}

const PLACEMENTS = [
  ["at the anchor / below the body", Slots],
  ["in the margin", Margin],
] as const;

function panel(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-thread-panel="${id}"]`);
}

function isFolded(id: string): boolean {
  return panel(id)?.querySelector("[data-thread-expand]") !== null;
}

describe.each(PLACEMENTS)("a document carrying one resolved and one open thread, %s", (_, Host) => {
  it("shows the open one full and the resolved one collapsed", async () => {
    render(<Host transport={wire()} rows={[openRow(), resolvedRow()]} />);

    // The open one is the whole conversation: its turns, and its composer.
    await waitFor(() => {
      expect(panel("th_open")?.querySelectorAll(".turn")).toHaveLength(TURNS.length);
    });
    expect(panel("th_open")?.querySelector("[data-composer]")).not.toBeNull();
    expect(isFolded("th_open")).toBe(false);

    // The resolved one is one line, and no card at all.
    expect(isFolded("th_done")).toBe(true);
    expect(panel("th_done")?.querySelector(".thread-card")).toBeNull();
    expect(panel("th_done")?.querySelector(".turn")).toBeNull();
  });

  it("says what the collapsed one is: its size, its last speaker, its subject, its status", async () => {
    render(<Host transport={wire()} rows={[resolvedRow()]} />);
    const line = await screen.findByRole("button", { name: /💬 2 turns · agent · resolved/u });
    // Its whole size, not a remainder — the fence clipping's rule, for a fold.
    expect(line.textContent).toContain("2 turns");
    expect(line.textContent).toContain("“yield curve”");
    expect(line.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not collapse a resolved thread holding a turn nobody has seen", async () => {
    render(<Host transport={wire()} rows={[resolvedRow({ unread: true })]} />);
    await waitFor(() => {
      expect(panel("th_done")?.querySelector(".thread-card")).not.toBeNull();
    });
    expect(isFolded("th_done")).toBe(false);
  });

  it("expands the collapsed one in place, leaving the other alone", async () => {
    render(<Host transport={wire()} rows={[openRow(), resolvedRow()]} />);
    await waitFor(() => {
      expect(isFolded("th_done")).toBe(true);
    });

    fireEvent.click(panel("th_done")?.querySelector("[data-thread-expand]") as HTMLElement);
    await waitFor(() => {
      expect(panel("th_done")?.querySelector(".thread-card")).not.toBeNull();
    });
    // Where it stood — still this panel, in this placement.
    expect(panel("th_done")?.querySelector(".thread-card")?.getAttribute("data-thread")).toBe(
      "th_done",
    );
    // And the open one never moved.
    expect(isFolded("th_open")).toBe(false);
  });

  it("folds the open one on demand, and reads nothing while it is folded", async () => {
    const transport = wire();
    render(<Host transport={transport} rows={[openRow()]} />);
    await waitFor(() => {
      expect(transport.of("POST", "/api/threads/th_open/seen")).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse thread" }));
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(true);
    });
    expect(panel("th_open")?.querySelector(".turn")).toBeNull();
    expect(transport.of("POST", "/api/threads/th_open/seen")).toHaveLength(1);
  });
});

describe("precedence — the last thing that happened wins", () => {
  it("collapses a thread resolved while it is open on screen, and expands it when reopened", async () => {
    const transport = wire();
    const { rerender } = render(<Slots transport={transport} rows={[openRow()]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(false);
    });

    // The status change is what re-asserts the rule.
    rerender(<Slots transport={transport} rows={[openRow({ status: "resolved" })]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(true);
    });

    rerender(<Slots transport={transport} rows={[openRow({ status: "open" })]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(false);
    });
  });

  it("clears a hand-made fold when the status changes under it", async () => {
    const transport = wire();
    const { rerender } = render(<Slots transport={transport} rows={[openRow()]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse thread" }));
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(true);
    });

    // Resolved, then reopened: the rule speaks again, not the old gesture.
    rerender(<Slots transport={transport} rows={[openRow({ status: "resolved" })]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(true);
    });
    rerender(<Slots transport={transport} rows={[openRow({ status: "open" })]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(false);
    });
  });

  it("lets a reader fold an unread conversation by hand — the rule is what is bound, not them", async () => {
    render(<Slots transport={wire()} rows={[resolvedRow({ unread: true })]} />);
    await waitFor(() => {
      expect(isFolded("th_done")).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse thread" }));
    await waitFor(() => {
      expect(isFolded("th_done")).toBe(true);
    });
  });
});

describe("a fold sticks, and belongs to one reader", () => {
  it("survives leaving the document and coming back, and a reload", async () => {
    const transport = wire();
    const { unmount } = render(<Slots transport={transport} rows={[openRow()]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse thread" }));
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(true);
    });

    // Navigating away and back is an unmount and a fresh mount of the panel…
    unmount();
    render(<Slots transport={transport} rows={[openRow()]} />);
    await waitFor(() => {
      expect(panel("th_open")).not.toBeNull();
    });
    expect(isFolded("th_open")).toBe(true);

    // …and a reload is a fresh provider reading `localStorage` from scratch,
    // which is the only thing that survives one.
    cleanup();
    render(<Slots transport={transport} rows={[openRow()]} />);
    await waitFor(() => {
      expect(panel("th_open")).not.toBeNull();
    });
    expect(isFolded("th_open")).toBe(true);
  });

  it("leaves a second column showing the same document alone", async () => {
    const transport = wire();
    render(<Slots transport={transport} rows={[openRow()]} />);
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse thread" }));
    await waitFor(() => {
      expect(isFolded("th_open")).toBe(true);
    });
    cleanup();

    render(<Slots transport={transport} rows={[openRow()]} surfaceKey={columnSurface("col_b")} />);
    await waitFor(() => {
      expect(panel("th_open")).not.toBeNull();
    });
    expect(isFolded("th_open")).toBe(false);
  });
});

/**
 * SPEC.md §11: the fold claims **no new key**, and joins each conversation's
 * existing right-click actions instead — the menu that already lists "exactly
 * that item's existing actions, nothing invented".
 */
describe("the fold claims no key of its own", () => {
  it("is an ordinary focusable control in both states", async () => {
    render(<Slots transport={wire()} rows={[openRow(), resolvedRow()]} />);
    await waitFor(() => {
      expect(isFolded("th_done")).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Collapse thread" }).tagName).toBe("BUTTON");
    expect((panel("th_done")?.querySelector("[data-thread-expand]") as HTMLElement).tagName).toBe(
      "BUTTON",
    );
  });

  it("sits in the conversation's own right-click menu, beside resolve", async () => {
    render(<Slots transport={wire()} rows={[resolvedRow()]} />);
    await waitFor(() => {
      expect(isFolded("th_done")).toBe(true);
    });

    fireEvent.contextMenu(panel("th_done")?.querySelector("[data-thread-expand]") as HTMLElement, {
      clientX: 20,
      clientY: 20,
    });
    const expand = document.querySelector<HTMLElement>('[role="menuitem"][data-act="collapse"]');
    expect(expand?.textContent).toContain("Expand");
    // Its existing actions, nothing invented.
    expect(
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) =>
        item.getAttribute("data-act"),
      ),
    ).toEqual(["collapse", "resolve"]);

    fireEvent.click(expand as HTMLElement);
    await waitFor(() => {
      expect(isFolded("th_done")).toBe(false);
    });

    // …and the expanded card's menu offers the other direction.
    fireEvent.contextMenu(panel("th_done")?.querySelector(".thread-card") as HTMLElement, {
      clientX: 20,
      clientY: 20,
    });
    expect(
      document.querySelector<HTMLElement>('[role="menuitem"][data-act="collapse"]')?.textContent,
    ).toContain("Collapse");
  });
});

/**
 * A conversation rendered outside any reading surface: there is no reader for a
 * fold to belong to, so the rule still decides and every gesture is forgotten.
 * Rendering, rather than throwing, is the point — a plugin or a test that mounts
 * a panel on its own gets a panel.
 */
describe("with no surface to belong to", () => {
  it("still obeys the rule, and keeps no folds", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    render(
      <harness.Wrapper>
        <ThreadPanel
          summary={summaryFromRow(resolvedRow())}
          host="slot"
          onOpenDoc={() => undefined}
          onNotify={() => undefined}
        />
      </harness.Wrapper>,
    );
    await waitFor(() => {
      expect(panel("th_done")).not.toBeNull();
    });
    expect(isFolded("th_done")).toBe(true);

    // Nothing to record the gesture on, so nothing changes and nothing throws.
    fireEvent.click(panel("th_done")?.querySelector("[data-thread-expand]") as HTMLElement);
    expect(isFolded("th_done")).toBe(true);
  });
});

describe("a conversation nested deeper than the surface can draw", () => {
  /**
   * The one collapse in the app that used to have no way back: past the drawn
   * depth a child thread became a chip that **navigated away**, so reading it
   * meant losing your place, and its turns lost their "comment on this" control
   * with it. §11's "every collapse expands again in place" is what forces this.
   */
  it("is collapsed rather than dropped, and expands where it stands", async () => {
    const transport = wire();
    const row = openRow({ id: "th_deep", parent: "th_open", turnCount: 1, lastAuthor: "user" });
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    render(
      <harness.Wrapper>
        <ThreadCollapseProvider surfaceKey={columnSurface("col_a")}>
          <ThreadPanel
            summary={summaryFromRow(row)}
            host="nested"
            depth={6}
            onOpenDoc={() => undefined}
            onNotify={() => undefined}
          />
        </ThreadCollapseProvider>
      </harness.Wrapper>,
    );

    await waitFor(() => {
      expect(panel("th_deep")).not.toBeNull();
    });
    // Collapsed rather than dropped — and it is a fold, not a link away.
    expect(isFolded("th_deep")).toBe(true);
    const line = panel("th_deep")?.querySelector("[data-thread-expand]") as HTMLElement;
    expect(line.tagName).toBe("BUTTON");

    fireEvent.click(line);
    await waitFor(() => {
      expect(panel("th_deep")?.querySelectorAll(".turn")).toHaveLength(1);
    });
    // Expanded in place: the card is inside the panel that was standing there.
    expect(panel("th_deep")?.querySelector(".thread-card")?.getAttribute("data-depth")).toBe("6");
    // And the turns that deep can be commented on again.
    expect(panel("th_deep")?.querySelector(".turn-comment")).not.toBeNull();
  });
});
