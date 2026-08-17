/** @vitest-environment jsdom */
import type { AgentLane, DocRow } from "@corpus/contract";
import { GENERAL_RESIDENT_LABEL, resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  { author: "user" as const, ts: "2026-07-01T09:00:00.000Z", body: "Which lenders?", model: null },
  { author: "agent" as const, ts: "2026-07-01T09:05:00.000Z", body: "Three of them.", model: null },
  {
    author: "agent" as const,
    ts: "2026-07-01T09:09:00.000Z",
    body: "Filed under finance.",
    model: null,
  },
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
    rowKnown: true,
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
          parentId="doc_m"
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
 * SPEC.md §7's designation, offered where a person acts on the conversation
 * (UI-109). The menu is the same declared list §11 binds to "exactly that
 * item's existing actions" — a designation *is* an action on this thread — and
 * these tests drive it through the real menu rather than through
 * `residentActions`, which is unit-tested next door.
 */
describe("designating a resident", () => {
  const standalone = (): DocRow =>
    threadRowFixture({
      id: "th_solo",
      parent: null,
      anchorQuote: null,
      turnCount: 1,
      lastAuthor: "user",
      status: "open",
    });

  function standaloneWire(lanes: readonly AgentLane[] = []): ReaderTransport {
    return readerTransport({
      lanes,
      threads: [threadFixture({ id: "th_solo", parent: null, turns: TURNS.slice(0, 1) })],
      rows: {
        // The `@` autocomplete's own directory read — same filter, same key.
        "?limit=50&type=agent-def": [
          { ...threadRowFixture({ id: "doc_agentdef" }), type: "agent-def", title: "researcher" },
        ],
      },
    });
  }

  const openMenu = (): void => {
    fireEvent.contextMenu(panel("th_solo")?.querySelector(".thread-card") as HTMLElement, {
      clientX: 20,
      clientY: 20,
    });
  };

  const acts = (): readonly (string | null)[] =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) =>
      item.getAttribute("data-act"),
    );

  /**
   * The defect UI-122 fixes, end to end through the real menu: a fresh
   * workspace, an empty agent-def directory, and one gesture from right-click to
   * a resident on the board.
   */
  it("designates a resident in a workspace that defines no agent-defs", async () => {
    const transport = readerTransport({
      lanes: [],
      threads: [threadFixture({ id: "th_solo", parent: null, turns: TURNS.slice(0, 1) })],
      // The directory answers, and answers empty — the reported case exactly.
      rows: { "?limit=50&type=agent-def": [] },
    });
    render(<Slots transport={transport} rows={[standalone()]} />);
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".thread-card")).not.toBeNull();
    });

    openMenu();
    // The absence of profiles is said, and said as news rather than as a fault
    // — waited on, because it may only be said once the directory has answered.
    await waitFor(() => {
      expect(
        document.querySelector<HTMLElement>('[data-act="resident-no-profiles"]')?.textContent,
      ).toContain("a resident does not need one");
    });
    const item = document.querySelector<HTMLButtonElement>(
      '[data-act="resident-designate-general"]',
    );
    expect(item?.textContent).toContain("Designate a resident");
    expect(item?.disabled).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('[data-act="resident-no-profiles"]')?.disabled,
    ).toBe(true);

    fireEvent.click(item as HTMLElement);
    await waitFor(() => {
      expect(
        transport.calls.some(
          (call) => call.method === "POST" && call.path === "/api/threads/th_solo/resident",
        ),
      ).toBe(true);
    });
    // No name at all — never a sentinel one (CONTRACT-061).
    const write = transport.calls.find((call) => call.path === "/api/threads/th_solo/resident");
    expect(write?.body).toEqual({});

    // …and the board shows the resident it now has, as a role and not a name.
    await waitFor(() => {
      expect(
        panel("th_solo")?.querySelector<HTMLElement>(".t-resident")?.dataset["residentKind"],
      ).toBe("general");
    });
    expect(panel("th_solo")?.querySelector(".t-resident-kind")?.textContent).toBe(
      GENERAL_RESIDENT_LABEL,
    );
  });

  /**
   * The keyboard has to reach the new item like any other: §11's menu contract
   * is unchanged, and a designation offered only to a pointer would be the same
   * unreachability in a different disguise.
   */
  it("designates a general resident from the keyboard", async () => {
    const transport = readerTransport({
      lanes: [],
      threads: [threadFixture({ id: "th_solo", parent: null, turns: TURNS.slice(0, 1) })],
      rows: { "?limit=50&type=agent-def": [] },
    });
    render(<Slots transport={transport} rows={[standalone()]} />);
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".thread-card")).not.toBeNull();
    });

    openMenu();
    await waitFor(() => {
      expect(acts()).toContain("resident-designate-general");
    });
    const item = document.querySelector<HTMLElement>('[data-act="resident-designate-general"]');
    item?.focus();
    expect(document.activeElement).toBe(item);
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        transport.calls.some(
          (call) => call.method === "POST" && call.path === "/api/threads/th_solo/resident",
        ),
      ).toBe(true);
    });
  });

  it("releases a general resident without naming a profile it does not have", async () => {
    const transport = standaloneWire([
      {
        lane: "th_solo",
        resident: { name: null, docId: null },
        live: false,
        since: null,
        summary: null,
        origin: { id: "th_solo", title: "Q3 planning" },
      },
    ]);
    render(<Slots transport={transport} rows={[standalone()]} />);
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".t-resident")).not.toBeNull();
    });

    openMenu();
    await waitFor(() => {
      expect(acts()).toContain("resident-release");
    });
    const label =
      document.querySelector<HTMLElement>('[data-act="resident-release"]')?.textContent ?? "";
    expect(label).toContain("Release the resident");
    expect(label).not.toContain("Q3 planning");
    // Already general, so it is not re-offered — a write that changes nothing.
    expect(acts()).not.toContain("resident-designate-general");

    fireEvent.click(document.querySelector('[data-act="resident-release"]') as HTMLElement);
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".t-resident")).toBeNull();
    });
  });

  it("offers the workspace's agents, and designates the one chosen", async () => {
    const transport = standaloneWire();
    render(<Slots transport={transport} rows={[standalone()]} />);
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".thread-card")).not.toBeNull();
    });

    openMenu();
    await waitFor(() => {
      expect(acts()).toContain("resident-designate-doc_agentdef");
    });
    const item = document.querySelector<HTMLElement>(
      '[data-act="resident-designate-doc_agentdef"]',
    );
    expect(item?.textContent).toContain("Designate researcher");

    fireEvent.click(item as HTMLElement);
    await waitFor(() => {
      expect(
        transport.calls.some(
          (call) => call.method === "POST" && call.path === "/api/threads/th_solo/resident",
        ),
      ).toBe(true);
    });
    // By the invocable name, never a document id (SPEC.md §7).
    const write = transport.calls.find((call) => call.path === "/api/threads/th_solo/resident");
    expect(write?.body).toEqual({ name: "researcher" });

    // …and the badge follows, because designating invalidates `["agents"]`.
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".t-resident")?.textContent).toContain("researcher");
    });
  });

  it("offers the release once there is one, and takes the badge away again", async () => {
    const transport = standaloneWire([
      {
        lane: "th_solo",
        resident: { name: "researcher", docId: "doc_agentdef" },
        live: false,
        since: null,
        summary: null,
        origin: { id: "th_solo", title: "Q3 planning" },
      },
    ]);
    render(<Slots transport={transport} rows={[standalone()]} />);
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".t-resident")).not.toBeNull();
    });

    openMenu();
    await waitFor(() => {
      expect(acts()).toContain("resident-release");
    });
    expect(
      document.querySelector<HTMLElement>('[data-act="resident-release"]')?.textContent,
    ).toContain("Release researcher");

    fireEvent.click(document.querySelector('[data-act="resident-release"]') as HTMLElement);
    await waitFor(() => {
      expect(panel("th_solo")?.querySelector(".t-resident")).toBeNull();
    });
    expect(
      transport.calls.some(
        (call) => call.method === "DELETE" && call.path === "/api/threads/th_solo/resident",
      ),
    ).toBe(true);
  });

  /**
   * SPEC.md §7: "a thread on a document is *about* that document, and a resident
   * owns a conversation rather than a passage". The menu on a comment offers
   * exactly what it always offered.
   */
  it("offers nothing of the kind on a thread that hangs off a document", async () => {
    render(<Slots transport={wire()} rows={[openRow()]} />);
    await waitFor(() => {
      expect(panel("th_open")?.querySelector(".thread-card")).not.toBeNull();
    });

    fireEvent.contextMenu(panel("th_open")?.querySelector(".thread-card") as HTMLElement, {
      clientX: 20,
      clientY: 20,
    });
    await waitFor(() => {
      expect(acts()).toEqual(["collapse", "resolve"]);
    });
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

  /**
   * The interlock governs **the rule**, not the clamp (PR #25 review, MINOR).
   * §11 binds it to "never collapsed *by the rule*", and depth is not a rule —
   * it is what the surface can draw. An unread conversation down there used to
   * defeat the clamp and render a full card at a depth the surface had already
   * said it could not usefully draw; now it is placed collapsed like the rest,
   * with its unseen turn announced on the line rather than buried.
   */
  it("clamps an unread conversation too, says it is unread, and still expands in place", async () => {
    const transport = wire();
    const row = openRow({
      id: "th_deep",
      parent: "th_open",
      turnCount: 1,
      lastAuthor: "user",
      unread: true,
    });
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
    expect(isFolded("th_deep")).toBe(true);
    // Collapsed is never hidden, and least of all here: the line says it holds
    // something unseen, which is what makes the fold safe.
    const line = panel("th_deep")?.querySelector("[data-thread-expand]") as HTMLElement;
    expect(line.textContent).toContain("new");

    fireEvent.click(line);
    await waitFor(() => {
      expect(panel("th_deep")?.querySelectorAll(".turn")).toHaveLength(1);
    });
    expect(panel("th_deep")?.querySelector(".thread-card")?.getAttribute("data-depth")).toBe("6");
  });
});

/**
 * PR #25 re-review, MINOR — **the chip↔margin swap is an unmount, and the
 * placement has to survive it.**
 *
 * "Reading never collapses anything" (SPEC.md §11) is kept by recording what a
 * conversation was placed with and never letting that answer soften; the record
 * used to be a ref inside `ThreadPanel`, which made it a property of one mounted
 * component. Crossing `MARGIN_MIN_WIDTH` unmounts the chip's panel and mounts a
 * fresh one in the margin (`useAnchorLayer.slotHost` answers `null`, so
 * `AnchorChips` draws nothing), so widening a column while reading a resolved
 * conversation re-placed it against the row it had just marked read and folded
 * it mid-sentence. Same defect as the round trip the ref was added for, reached
 * by a resize.
 *
 * The other half is asserted beside it, because the fix is a *lifetime* and not
 * a memory: a placement is a fresh decision every time §11 says one is made, so
 * leaving the conversation and coming back has to fold it.
 */
describe("a conversation that changes placement while it is on screen", () => {
  function anchoredOf(row: DocRow): AnchoredThread {
    return {
      anchorId: `anc_${row.id}`,
      threadId: row.id,
      row,
      rowKnown: true,
      orphaned: false,
      quote: row.anchorQuote ?? "",
      placement: {
        anchorId: `anc_${row.id}`,
        threadId: row.id,
        resolved: row.status === "resolved",
        turnCount: row.turnCount ?? 0,
        segments: [],
      },
    };
  }

  /** One surface, one conversation, either placement — the width decides. */
  function Swap({
    harness,
    row,
    margin,
  }: {
    readonly harness: ReturnType<typeof createCorpusTestHarness>;
    readonly row: DocRow;
    readonly margin: boolean;
  }): ReactElement {
    return (
      <harness.Wrapper>
        <ContextMenuProvider>
          <ThreadCollapseProvider surfaceKey={columnSurface("col_a")}>
            {margin ? (
              <MarginColumn
                threads={[anchoredOf(row)]}
                parentId="doc_m"
                flashThread={null}
                onOpenDoc={() => undefined}
                onNotify={() => undefined}
                innerRef={createRef<HTMLDivElement>()}
              />
            ) : (
              <ThreadPanel
                summary={summaryFromRow(row)}
                host="slot"
                onOpenDoc={() => undefined}
                onNotify={() => undefined}
              />
            )}
          </ThreadCollapseProvider>
        </ContextMenuProvider>
      </harness.Wrapper>
    );
  }

  it("does not fold under the reader when the column widens into the margin", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const unseen = resolvedRow({ unread: true });
    const view = render(<Swap harness={harness} row={unseen} margin={false} />);

    // Placed expanded by the interlock, and read: the seen round trip lands and
    // the row comes back saying there is nothing unseen left.
    await waitFor(() => {
      expect(panel("th_done")?.querySelector(".thread-card")).not.toBeNull();
    });
    view.rerender(<Swap harness={harness} row={resolvedRow()} margin={false} />);
    await waitFor(() => {
      expect(isFolded("th_done")).toBe(false);
    });

    // Now the column crosses `MARGIN_MIN_WIDTH`: a fresh panel, same surface,
    // same conversation, still on screen — and still being read.
    view.rerender(<Swap harness={harness} row={resolvedRow()} margin={true} />);
    await waitFor(() => {
      expect(panel("th_done")?.closest(".focus-margin")).not.toBeNull();
    });
    expect(isFolded("th_done")).toBe(false);
  });

  it("does fold when the reader leaves it and comes back — a placement is a fresh decision", async () => {
    const transport = wire();
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const view = render(
      <Swap harness={harness} row={resolvedRow({ unread: true })} margin={false} />,
    );
    await waitFor(() => {
      expect(panel("th_done")?.querySelector(".thread-card")).not.toBeNull();
    });

    // Away: nothing on this surface is showing the conversation any more, so the
    // surface stops remembering how it was placed.
    view.unmount();
    await waitFor(() => {
      expect(panel("th_done")).toBeNull();
    });

    // Back, with the conversation read and resolved: the rule places it folded.
    render(<Swap harness={harness} row={resolvedRow()} margin={false} />);
    await waitFor(() => {
      expect(panel("th_done")).not.toBeNull();
    });
    expect(isFolded("th_done")).toBe(true);
  });
});
