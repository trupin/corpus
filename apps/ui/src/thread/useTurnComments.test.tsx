/** @vitest-environment jsdom */
import type { RowNotice, ThreadTurn } from "@corpus/kit";
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import type { SelectionSource } from "../menu/nativeMenu";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { Turn } from "./Turn";
import { NARROWED_TO_ONE_TURN, useTurnComments } from "./useTurnComments";

/**
 * **A selection that spans more than one turn** (UI-061).
 *
 * A comment anchors to one turn by construction, and that is correct — a child
 * thread has one parent and one anchor. What was wrong was that the narrowing
 * happened in silence: select three turns, right-click the middle one, and the
 * comment quoted the middle turn with no signal anywhere. The only place it
 * showed was the citation above the composer, which the reader meets *after*
 * deciding what to write, if they notice it at all.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  vi.restoreAllMocks();
});

const TURNS: readonly ThreadTurn[] = [
  {
    author: "user",
    ts: "2026-08-03T10:00:00.000Z",
    body: "The first turn asks about the rate.",
    model: null,
  },
  {
    author: "agent",
    ts: "2026-08-03T10:01:00.000Z",
    body: "The second turn answers about the rate.",
    model: "claude-opus-5",
  },
];

/** The thread file the two turns live in — what a selector resolves against. */
const BODY = TURNS.map((turn) => `## ${turn.author} · ${turn.ts}\n\n${turn.body}\n`).join("\n");

interface Seen {
  readonly notices: RowNotice[];
}

function Host({ seen }: { readonly seen: Seen }): ReactElement {
  const [harness] = useState(() =>
    createCorpusTestHarness({ fetch: () => Promise.resolve(new Response("{}")) }),
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  return (
    <harness.Wrapper>
      <ContextMenuProvider>
        <Card cardRef={cardRef} seen={seen} />
      </ContextMenuProvider>
    </harness.Wrapper>
  );
}

function Card({
  cardRef,
  seen,
}: {
  readonly cardRef: React.RefObject<HTMLDivElement | null>;
  readonly seen: Seen;
}): ReactElement {
  const comments = useTurnComments({
    threadId: "th_a",
    turns: TURNS,
    body: BODY,
    anchors: [],
    cardRef,
    onNotify: (notice) => {
      seen.notices.push(notice);
    },
  });
  // `.doc-body thread-conversation` is not decoration: the real reader wraps a
  // whole conversation in one, and that is the ancestor `selectionMenuTarget`
  // finds for a range spanning two turns. A fixture without it declines the
  // right-click before any of this is reached — which is a fixture reproducing
  // itself rather than the app.
  return (
    <div className="doc-body thread-conversation">
      <div className="thread-card" ref={cardRef} onContextMenu={comments.onContextMenu}>
        {TURNS.map((turn) => (
          <Turn
            key={turn.ts}
            threadId="th_a"
            turn={turn}
            answeredForm={null}
            onOpenRef={() => undefined}
            onDelete={() => undefined}
            onNotify={() => undefined}
          />
        ))}
        {comments.popover}
      </div>
    </div>
  );
}

function mount(): Seen {
  const seen: Seen = { notices: [] };
  render(<Host seen={seen} />);
  return seen;
}

/** The rendered bodies, in render order — one per turn for these fixtures. */
function bodies(): readonly Element[] {
  return [...document.querySelectorAll(".turn-markdown")];
}

/**
 * Point `getSelection` at a real range, as a mouse drag would leave it.
 *
 * Built with the DOM's own API rather than with anything the hook uses, so the
 * assertion is about the hook and not about a shared helper.
 */
function selectAcross(from: Node, to: Node): void {
  const range = document.createRange();
  range.selectNodeContents(from);
  range.setEnd(to, to.childNodes.length);
  const source: SelectionSource = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => range.toString(),
    getRangeAt: () => range,
  };
  vi.spyOn(globalThis, "getSelection").mockReturnValue(source as unknown as Selection);
}

/** Right-click, then take the menu's first item — Comment on selection. */
function commentOnSelection(target: Element): void {
  fireEvent.contextMenu(target);
  fireEvent.click(screen.getByRole("menuitem", { name: /Comment on selection/ }));
}

describe("commenting on a selection that reaches past one turn", () => {
  it("says the comment will quote one turn, before the composer opens", () => {
    const seen = mount();
    const [first, second] = bodies();
    selectAcross(first as Node, second as Node);

    commentOnSelection(first as Element);

    // The sentence arrives with the composer, not in the citation afterwards.
    expect(seen.notices).toEqual([{ tone: "info", message: NARROWED_TO_ONE_TURN }]);
  });

  it("still opens a composer, on the turn the menu was opened in", () => {
    const seen = mount();
    const [first, second] = bodies();
    selectAcross(first as Node, second as Node);

    commentOnSelection(first as Element);

    expect(seen.notices).toHaveLength(1);
    // The citation shows what it will quote, and it is the clicked turn's words.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.body.textContent).toContain("The first turn asks about the rate.");
  });

  it("says nothing at all for a selection inside one turn", () => {
    const seen = mount();
    const [first] = bodies();
    const paragraph = (first as Element).querySelector("p");
    selectAcross(paragraph as Node, paragraph as Node);

    commentOnSelection(first as Element);

    // The common path gains no prompt: this is what people do all day.
    expect(seen.notices).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  /**
   * A selection may cross a turn boundary and still be right-clicked outside any
   * rendered body — on the card's own chrome. That path declined before UI-061
   * and declines now: there is no turn to narrow *to*, so there is nothing to
   * say about narrowing.
   */
  it("offers nothing, and says nothing, when the click is outside every turn", () => {
    const seen = mount();
    const [first, second] = bodies();
    selectAcross(first as Node, second as Node);

    fireEvent.contextMenu(document.querySelector(".thread-card") as Element);

    expect(screen.queryByRole("menuitem", { name: /Comment on selection/ })).toBeNull();
    expect(seen.notices).toEqual([]);
  });
});
