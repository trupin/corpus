/** @vitest-environment jsdom */
import type { DocRow, Turn as WireTurn } from "@corpus/contract";
import { resetSeenMarks } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { turnModelLabel } from "./turnModel.js";

/**
 * UI-090: an agent turn says which model wrote it (SPEC.md §11, rider signed
 * 2026-08-07) — and every other turn says nothing at all.
 *
 * The suite is written around the one thread the rider's sentence needs to be
 * read against: a person's turn, an agent turn nobody recorded a model for, and
 * agent turns that name two different models. Asserting only that a model
 * appears would pass on a component that printed a placeholder for the other
 * two, which is exactly what §11 forbids ("shows **nothing** rather than a
 * guess").
 *
 * `ThreadPanel` is the entry point rather than `Turn`, because it is the seam
 * where §11's other closed set lives: the collapsed line's contents. Rendering
 * the conversation and then folding it is the only way to prove the model went
 * with the expansion instead of leaking into the fold.
 */

beforeEach(() => {
  // Node 25's inert Web Storage global shadows jsdom's — see `memoryStorage.ts`.
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  resetSeenMarks();
  clearCollapseState();
  vi.unstubAllGlobals();
});

const OPUS = "claude-opus-4-20250514";
const HAIKU = "claude-haiku-4-20250514";

/**
 * The mixed conversation, in the four states a reader can meet.
 *
 * The two agent turns that *do* name a model name **different** ones, so a
 * component that rendered the thread's first model against every agent turn
 * fails here rather than passing on a thread where every model is the same.
 */
const MIXED: readonly WireTurn[] = [
  {
    author: "user",
    ts: "2026-08-07T09:00:00.000Z",
    body: "Which lenders?",
    model: null,
  },
  {
    author: "agent",
    ts: "2026-08-07T09:05:00.000Z",
    body: "Three of them.",
    model: OPUS,
  },
  {
    // Written before the model was recorded: null is the honest answer.
    author: "agent",
    ts: "2026-08-07T09:07:00.000Z",
    body: "Filed under finance.",
    model: null,
  },
  {
    author: "agent",
    ts: "2026-08-07T09:09:00.000Z",
    body: "Retitled the note.",
    model: HAIKU,
  },
];

function row(overrides: Partial<DocRow> = {}): DocRow {
  return threadRowFixture({
    id: "th_models",
    parent: null,
    anchorQuote: null,
    turnCount: MIXED.length,
    lastAuthor: "agent",
    status: "open",
    ...overrides,
  });
}

function wire(turns: readonly WireTurn[] = MIXED): ReaderTransport {
  return readerTransport({
    threads: [threadFixture({ id: "th_models", parent: null, turns: [...turns] })],
  });
}

function Panel({
  transport,
  summary,
}: {
  readonly transport: ReaderTransport;
  readonly summary: DocRow;
}): ReactElement {
  const [harness] = useState(() => createCorpusTestHarness({ fetch: transport.fetch }));
  return (
    <harness.Wrapper>
      <ContextMenuProvider>
        <ThreadCollapseProvider surfaceKey={columnSurface("col_a")}>
          <ThreadPanel
            summary={summaryFromRow(summary)}
            host="slot"
            onOpenDoc={() => undefined}
            onNotify={() => undefined}
          />
        </ThreadCollapseProvider>
      </ContextMenuProvider>
    </harness.Wrapper>
  );
}

/** What each turn on screen says its model is — `null` where it says nothing. */
function modelsOnScreen(container: HTMLElement): readonly (string | null)[] {
  return [...container.querySelectorAll(".turn")].map(
    (turn) => turn.querySelector("[data-turn-model]")?.textContent ?? null,
  );
}

describe("turnModelLabel", () => {
  it("names the model an agent turn recorded", () => {
    expect(
      turnModelLabel({ author: "agent", ts: "2026-08-07T09:05:00.000Z", body: "", model: OPUS }),
    ).toBe(OPUS);
  });

  it("names nothing for an agent turn written before the model was recorded", () => {
    expect(
      turnModelLabel({ author: "agent", ts: "2026-08-07T09:05:00.000Z", body: "", model: null }),
    ).toBeNull();
  });

  it("names nothing for a person's turn", () => {
    expect(
      turnModelLabel({ author: "user", ts: "2026-08-07T09:00:00.000Z", body: "", model: null }),
    ).toBeNull();
  });

  /**
   * §11: "a turn a person wrote names no model". The write path already `400`s
   * on one, so the only source is a hand-edited frontmatter entry the server
   * would have refused — an attribution the UI declines to publish on its behalf.
   */
  it("names nothing for a person's turn even if the file records one", () => {
    expect(
      turnModelLabel({ author: "user", ts: "2026-08-07T09:00:00.000Z", body: "", model: OPUS }),
    ).toBeNull();
  });

  it("treats a blank record as no record rather than drawing an empty chip", () => {
    expect(
      turnModelLabel({ author: "agent", ts: "2026-08-07T09:05:00.000Z", body: "", model: "   " }),
    ).toBeNull();
  });

  it("trims a recorded name so the chip is not padded lopsided", () => {
    expect(
      turnModelLabel({
        author: "agent",
        ts: "2026-08-07T09:05:00.000Z",
        body: "",
        model: `  ${OPUS}\t`,
      }),
    ).toBe(OPUS);
  });

  /**
   * A cache entry written by an older build of this app carries no `model` key
   * at all — a runtime shape the required-and-nullable wire type cannot express.
   */
  it("names nothing when the field is missing outright", () => {
    const legacy = { author: "agent", ts: "2026-08-07T09:05:00.000Z", body: "" } as WireTurn;
    expect(turnModelLabel(legacy)).toBeNull();
  });
});

describe("a conversation of mixed turns", () => {
  it("shows each agent turn's own model, and nothing on the others", async () => {
    const { container } = render(<Panel transport={wire()} summary={row()} />);
    await screen.findByText("Three of them.");

    expect(modelsOnScreen(container)).toEqual([null, OPUS, null, HAIKU]);
  });

  /**
   * "Quickly identifiable… beside the author and timestamp" — so the assertion
   * is about *where*, not merely whether. The chip is a child of the turn's own
   * metadata row, in front of the two hover-revealed controls that own the right
   * edge, and it is on screen without opening or hovering anything.
   */
  it("puts the model in the turn's header row, beside the author and timestamp", async () => {
    const { container } = render(<Panel transport={wire()} summary={row()} />);
    await screen.findByText("Three of them.");

    const head = container.querySelector(
      '.turn[data-turn-ts="2026-08-07T09:05:00.000Z"] .turn-who',
    );
    expect(head).not.toBeNull();
    const chip = head?.querySelector(".turn-model");
    expect(chip?.textContent).toBe(OPUS);
    // The author is the row's first item and the model qualifies it, so the chip
    // follows both the author and the stamp rather than leading the line.
    expect([...(head?.children ?? [])].indexOf(chip as Element)).toBe(2);
    expect(chip?.getAttribute("title")).toBe(`Written by ${OPUS}`);
  });

  /**
   * §11 is explicit that an unknown says so by absence. A dash, an "unknown", or
   * an empty chip all read as values — so the assertion is that the element does
   * not exist, not that it is blank.
   */
  it("renders no element at all for a turn with no recorded model", async () => {
    const { container } = render(<Panel transport={wire()} summary={row()} />);
    await screen.findByText("Filed under finance.");

    const unrecorded = container.querySelector(
      '.turn[data-turn-ts="2026-08-07T09:07:00.000Z"] .turn-model',
    );
    expect(unrecorded).toBeNull();
    expect(container.textContent).not.toContain("unknown");
  });

  /**
   * §11 fixes exactly what a collapsed line reports — that it exists, what it is
   * about, who spoke last, how many turns, and whether anything is unread — and
   * says the set is closed. The model is not in it, and this is what keeps it out.
   */
  it("keeps the model out of the line the conversation folds down to", async () => {
    const { container } = render(<Panel transport={wire()} summary={row()} />);
    await screen.findByText("Three of them.");
    expect(container.textContent).toContain(OPUS);

    fireEvent.click(screen.getByRole("button", { name: "Collapse thread" }));

    await waitFor(() => {
      expect(container.querySelector(".t-chip")).not.toBeNull();
    });
    expect(container.querySelector("[data-turn-model]")).toBeNull();
    expect(container.textContent).not.toContain(OPUS);
    expect(container.textContent).not.toContain(HAIKU);
    // The five things the collapsed line does report are untouched by all this.
    expect(container.textContent).toContain(`${String(MIXED.length)} turns`);
    expect(container.textContent).toContain("agent");
  });

  /**
   * A revision replaces a turn's body in place, keeping its identity (SPEC.md
   * §6) — same author, same timestamp, no new turn. The model is recorded
   * against that timestamp, so it survives; this is the same thread re-fetched
   * with one body rewritten, which is exactly what a reader sees after one.
   */
  it("still names the model after the turn is revised in place", async () => {
    const revised = MIXED.map((turn) =>
      turn.ts === "2026-08-07T09:05:00.000Z"
        ? { ...turn, body: "Three of them — corrected: four." }
        : turn,
    );
    const { container } = render(<Panel transport={wire(revised)} summary={row()} />);
    await screen.findByText("Three of them — corrected: four.");

    expect(modelsOnScreen(container)).toEqual([null, OPUS, null, HAIKU]);
  });
});
