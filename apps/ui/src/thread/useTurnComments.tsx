import type { ResolvedAnchor } from "@corpus/contract";
import { isPendingTurn, useCreateThread, type RowNotice, type ThreadTurn } from "@corpus/kit";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { CommentPopover } from "../anchors/CommentPopover";
import { escapeSelectorValue } from "../anchors/cssEscape";
import { domRangeOfRendered, renderedTextOf } from "../anchors/renderedRange";
import { setAnchorHighlights } from "../anchors/textHighlight";
import type { SelectionRange, TextQuoteSelector } from "../editor/selection";
import { useSelectionContextMenu } from "../menu/useSelectionContextMenu";
import {
  captureTurnAnchor,
  domRangeOfTurnAnchor,
  partContaining,
  spanContaining,
  turnSourceParts,
  turnSpans,
} from "./turnAnchors";

/**
 * **Comment on a selection inside a turn** (SPEC.md §11's rider, signed
 * 2026-08-03; §6's recursion).
 *
 * The card owns this rather than the turn, for the same reason `ThreadCard` is
 * one component in four hosts: the thing being created is a child thread whose
 * `parent` is *this* thread, and the composer, the escape layer and the pending
 * highlight are one story per conversation, not one per turn.
 *
 * Three pieces, and they are deliberately the document view's own:
 *
 * - the **menu** is `useSelectionContextMenu`, so a selection in a turn offers
 *   the same "💬 Comment on selection" first and the same clipboard basics
 *   after — one menu, not a thread-shaped copy of one;
 * - the **composer** is `CommentPopover`, so the citation above the input, the
 *   ask-agent toggle, the escape layering and the keys are literally the ones a
 *   document comment uses (which is also how the UI-052 key contract reaches
 *   here without being restated);
 * - the **highlight** is the anchor the server resolved, painted over the turn.
 *
 * Whole-turn commenting (💬 on the turn head) is untouched and still anchors to
 * the turn — this is the finer grain, not a replacement.
 */

interface TurnDraft {
  readonly turnTs: string;
  readonly partIndex: number;
  /** Rendered-text offsets, for the highlight that outlives the DOM selection. */
  readonly rendered: SelectionRange;
  readonly selector: TextQuoteSelector;
  readonly top: number;
  readonly left: number;
}

/** The draft the composer is submitting, still painted while it is in flight. */
type PendingHighlight = Pick<TurnDraft, "turnTs" | "partIndex" | "rendered">;

export interface TurnCommentsOptions {
  readonly threadId: string;
  readonly turns: readonly ThreadTurn[];
  /** The thread's own markdown — what its anchors' ranges index into. */
  readonly body: string | undefined;
  /** The thread's own anchors: one per child thread (SPEC.md §6). */
  readonly anchors: readonly ResolvedAnchor[];
  /** The card's root element; a nested card's selection belongs to that card. */
  readonly cardRef: RefObject<HTMLDivElement | null>;
  readonly onNotify: (notice: RowNotice) => void;
}

export interface TurnComments {
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  readonly popover: ReactElement | null;
}

/** The `.turn-markdown` roots of one turn of **this** card, in render order. */
function markdownRoots(card: Element, turnTs: string): readonly Element[] {
  const turn = [...card.querySelectorAll(`[data-turn-ts="${escapeSelectorValue(turnTs)}"]`)].find(
    (element) => element.closest(".thread-card") === card,
  );
  if (turn === undefined) return [];
  // A nested child card renders its own turns inside this one; theirs answer
  // with their own `[data-turn-ts]` and are not this turn's bodies.
  return [...turn.querySelectorAll(".turn-markdown")].filter(
    (element) => element.closest("[data-turn-ts]") === turn,
  );
}

export function useTurnComments({
  threadId,
  turns,
  body,
  anchors,
  cardRef,
  onNotify,
}: TurnCommentsOptions): TurnComments {
  const [draft, setDraft] = useState<TurnDraft | null>(null);
  const [pending, setPending] = useState<PendingHighlight | null>(null);
  const painter = useRef({});

  const create = useCreateThread({
    onSuccess: (result) => {
      for (const warning of result.warnings) {
        onNotify({ tone: "error", message: `${warning.code} — ${warning.detail}` });
      }
    },
    onError: (error) => {
      onNotify({ tone: "error", message: `Comment failed — ${error.message}` });
    },
  });

  /**
   * The selection, read **when the menu opens**.
   *
   * Opening a menu moves focus out of the body and collapses the selection, so
   * an action that re-read it on activation would anchor to nothing. The whole
   * selector is therefore computed here and the returned action only opens the
   * composer on it — the same shape `useAnchorLayer.captureComment` has.
   */
  const captureComment = useCallback(
    (target: EventTarget | null): (() => void) | null => {
      const card = cardRef.current;
      if (card === null || !(target instanceof Element)) return null;
      // A nested card's own handler answers for its own turns; this one declines
      // rather than anchoring a grandchild's selection onto the wrong parent.
      if (target.closest(".thread-card") !== card) return null;
      const root = target.closest(".turn-markdown");
      const turnElement = target.closest<HTMLElement>("[data-turn-ts]");
      if (root === null || turnElement === null) return null;
      const ts = turnElement.dataset["turnTs"];
      const turn = turns.find((candidate) => candidate.ts === ts);
      // A turn the server has not confirmed has no bytes on disk to anchor into.
      if (turn === undefined || isPendingTurn(turn)) return null;
      const parts = turnSourceParts(turn);
      const partIndex = markdownRoots(card, turn.ts).indexOf(root);
      const part = parts[partIndex];
      if (part === undefined) return null;

      const selection = globalThis.getSelection?.() ?? null;
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const captured = captureTurnAnchor({ root, part, turnBody: turn.body, range });
      if (captured === null) return null;
      // jsdom implements no layout; the popover still opens, at the top left of
      // the viewport, rather than not opening at all.
      const box =
        typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      const top = (box?.bottom ?? 74) + 6;
      const left = box?.left ?? 0;
      return () => {
        setDraft({
          turnTs: turn.ts,
          partIndex,
          rendered: captured.rendered,
          selector: captured.selector,
          top,
          left,
        });
      };
    },
    [cardRef, turns],
  );

  const onContextMenu = useSelectionContextMenu({ editor: null, captureComment, onNotify });

  const submit = useCallback(
    (text: string, requestsAgent: boolean): void => {
      if (draft === null) return;
      const held: PendingHighlight = {
        turnTs: draft.turnTs,
        partIndex: draft.partIndex,
        rendered: draft.rendered,
      };
      // Per-call on purpose: a highlight in a card that has closed is not
      // something anyone can see, and clearing it there would be a state update
      // on a dead layer. The notices ride on the hook, which is what makes
      // skipping this one safe (UI-015).
      const forget = (): void => {
        setPending((current) => (current === held ? null : current));
      };
      setPending(held);
      setDraft(null);
      create.mutate(
        { parent: threadId, selector: draft.selector, body: text, requestsAgent },
        { onSuccess: forget, onError: forget },
      );
    },
    [create, draft, threadId],
  );

  /**
   * The anchored words, painted over the turn they belong to.
   *
   * Driven off the **server's** resolved ranges, never off a local search: the
   * ladder in SPEC.md §6 is what decides where a selector lands, and a second
   * opinion here is how a highlight ends up one occurrence away from the
   * conversation hanging off it. The draft in flight is painted from the offsets
   * captured with it, so the words stay marked from the moment the composer
   * opens until the anchor arrives to replace them.
   */
  useEffect(() => {
    const card = cardRef.current;
    if (card === null) return undefined;
    const ranges: Range[] = [];
    const spans = body === undefined ? [] : turnSpans(body, turns);

    for (const anchor of anchors) {
      if (anchor.range === null) continue;
      const span = spanContaining(spans, anchor.range);
      if (span === undefined) continue;
      const turn = turns.find((candidate) => candidate.ts === span.ts);
      if (turn === undefined) continue;
      const inTurn = { start: anchor.range.start - span.start, end: anchor.range.end - span.start };
      const found = partContaining(turnSourceParts(turn), inTurn);
      if (found === undefined) continue;
      const root = markdownRoots(card, span.ts)[found.index];
      if (root === undefined) continue;
      const range = domRangeOfTurnAnchor({ root, part: found.part, range: inTurn });
      if (range !== null) ranges.push(range);
    }

    if (pending !== null) {
      const root = markdownRoots(card, pending.turnTs)[pending.partIndex];
      const range =
        root === undefined
          ? null
          : domRangeOfRendered(renderedTextOf(root), pending.rendered.start, pending.rendered.end);
      if (range !== null) ranges.push(range);
    }

    setAnchorHighlights(painter.current, ranges);
    const token = painter.current;
    return () => {
      setAnchorHighlights(token, []);
    };
  }, [anchors, body, cardRef, pending, turns]);

  return {
    onContextMenu,
    popover:
      draft === null ? null : (
        <CommentPopover
          quote={draft.selector.exact}
          top={draft.top}
          left={draft.left}
          pending={create.isPending}
          onSubmit={submit}
          onClose={() => {
            setDraft(null);
          }}
        />
      ),
  };
}
