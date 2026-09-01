import type { ThreadTurn } from "@corpus/kit";
import {
  domRangeOfRendered,
  renderedOffsetsOfRange,
  renderedTextOf,
  trimToText,
} from "../anchors/renderedRange";
import { mdRangeOfProjection, projectionRangeOfMd, sourceTraceOf } from "../anchors/sourceTrace";
import {
  countOccurrences,
  nthIndexOf,
  selectorAt,
  type SelectionRange,
  type TextQuoteSelector,
} from "../editor/selection";
import { isCommentable } from "../anchors/selectorFromSelection";
import { splitTurnAttachments } from "./attachmentRefs";
import { splitFormFence } from "./parseFormBlock";
import { splitTrace } from "./Turn";

/**
 * Selections inside a **rendered turn**, in both directions (SPEC.md §10's
 * "Commenting on a selection", §6's recursion).
 *
 * A thread is a document, so commenting on part of a turn is the ordinary
 * comment: one `POST /api/threads` whose `parent` is the thread and whose
 * selector is a text-quote into the thread's own file. What is different is the
 * *coordinate system*. A document body is an editor and its selection arrives as
 * ProseMirror positions; a turn is `MarkdownView` and its selection arrives as a
 * DOM range over text a renderer produced. Two hops close the gap, and both are
 * indexed by **occurrence** rather than by first hit:
 *
 *     DOM range → rendered text offsets → markdown offsets in the turn
 *
 * **Occurrence, never `indexOf`.** A turn repeats phrases — a reply quoting the
 * question, an agent restating an assumption — and an anchor that took the first
 * match would highlight a sentence the user never pointed at (PR #19's MAJOR,
 * where a caller anchored on `exact` alone). The count of earlier occurrences in
 * the text *before* the selection is what picks the right one, and the selector
 * then carries `prefix`/`suffix` framing drawn from the whole turn, so the
 * server's rung 1 (`prefix + exact + suffix`) resolves it without ever needing
 * rung 2's uniqueness.
 */

/** One `MarkdownView` inside a turn, and where its markdown sits in the turn. */
export interface TurnSourcePart {
  readonly source: string;
  /** Offset of `source` inside the turn's own body. */
  readonly base: number;
}

/**
 * The markdown of each `MarkdownView` a turn renders, in render order.
 *
 * Mirrors `Turn`'s own splitting, and is index-aligned with the `.turn-markdown`
 * elements it produces — that alignment is what lets a DOM node be traced back
 * to the bytes it came from, and `turnAnchors.test.ts` renders a `Turn` and
 * checks it rather than trusting it.
 *
 * Every part is a **contiguous slice of the turn body**, because each split only
 * ever trims at an edge. That is the invariant the whole module rests on: an
 * offset inside a part is `base + offset` inside the turn, and a turn body is
 * itself a contiguous slice of the thread file — so a selector framed here is
 * literally present in the document the server resolves it against.
 */
export function turnSourceParts(turn: ThreadTurn): readonly TurnSourcePart[] {
  const { body: unstamped } = splitTrace(turn.body, turn.author);
  const { prose } = splitTurnAttachments(unstamped);
  const fence =
    turn.author === "agent"
      ? splitFormFence(prose)
      : { before: prose, after: "", source: undefined };
  // No form: one view, the whole prose — rendered even when the prose is empty
  // (an attachment-only turn), so the indexes still line up.
  if (fence.source === undefined) return [{ source: prose, base: 0 }];
  const parts: TurnSourcePart[] = [];
  if (fence.before !== "") parts.push({ source: fence.before, base: 0 });
  // `after` is a suffix of the prose, so its base is what the suffix leaves.
  if (fence.after !== "") {
    parts.push({ source: fence.after, base: prose.length - fence.after.length });
  }
  return parts;
}

/** Where a turn's body sits in the thread file — what its anchors index into. */
export interface TurnSpan {
  readonly ts: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Each turn's byte range in the thread's own markdown.
 *
 * Located sequentially rather than searched: turns appear in the file in the
 * order the thread lists them, so a cursor that only moves forward can never
 * match an earlier turn's identical text.
 */
export function turnSpans(body: string, turns: readonly ThreadTurn[]): readonly TurnSpan[] {
  const spans: TurnSpan[] = [];
  let cursor = 0;
  for (const turn of turns) {
    if (turn.body === "") continue;
    const at = body.indexOf(turn.body, cursor);
    if (at === -1) continue;
    spans.push({ ts: turn.ts, start: at, end: at + turn.body.length });
    cursor = at + turn.body.length;
  }
  return spans;
}

/** The turn a resolved anchor range falls inside, or `undefined`. */
export function spanContaining(
  spans: readonly TurnSpan[],
  range: SelectionRange,
): TurnSpan | undefined {
  return spans.find((span) => range.start >= span.start && range.end <= span.end);
}

/** The part a turn-body offset range falls inside, with its index. */
export function partContaining(
  parts: readonly TurnSourcePart[],
  range: SelectionRange,
): { readonly index: number; readonly part: TurnSourcePart } | undefined {
  const index = parts.findIndex(
    (part) => range.start >= part.base && range.end <= part.base + part.source.length,
  );
  const part = parts[index];
  return part === undefined ? undefined : { index, part };
}

/**
 * Whether an occurrence index counted in one projection means the same thing in
 * the other — the backstop both directions keep (UI-060).
 *
 * The two projections are meant to be the same string, and
 * `renderParity.test.tsx` asserts that against the real renderer for every
 * construct a turn is written in. Two known exceptions survive: raw HTML, which
 * the renderer draws as literal text and the trace leaves out, and a §5 styling
 * marker split across another inline node. Both make the trace's `plain` and the
 * DOM's text disagree about how many times a quote appears, and an index is not
 * transferable across that.
 *
 * So the rule is unchanged from PR #20 even though the reason it fires almost
 * never is: **disagreement is a refusal.** Refusing costs a whole-turn 💬 in a
 * rare case. Guessing costs a comment attached to words the reader did not
 * choose, which is the failure this module exists to prevent.
 */
function transferable(counted: string, lookedUpIn: string, quote: string): boolean {
  return countOccurrences(counted, quote) === countOccurrences(lookedUpIn, quote);
}

export interface TurnAnchorCapture {
  /** Offsets into the part's *rendered* text — what the pending highlight paints. */
  readonly rendered: SelectionRange;
  /** Offsets into the turn body — what the anchor quotes. */
  readonly range: SelectionRange;
  readonly selector: TextQuoteSelector;
}

export interface CaptureTurnAnchorInput {
  /** The `.turn-markdown` element the selection sits in. */
  readonly root: Element;
  readonly part: TurnSourcePart;
  /** The whole turn body — where the selector's framing comes from. */
  readonly turnBody: string;
  readonly range: Range;
}

/**
 * A DOM selection inside a turn, as a §6 selector — or `null` when it quotes
 * nothing the file contains.
 *
 * Declining is the honest answer and not a gap: a selection that spans a
 * `[[ref]]`'s resolved title, or runs from one block into the next, describes
 * text that is not a contiguous quote of the document. An anchor invented for it
 * would point at the wrong words, and 💬 on the whole turn is still there.
 */
export function captureTurnAnchor(input: CaptureTurnAnchorInput): TurnAnchorCapture | null {
  const rendered = renderedTextOf(input.root);
  const offsets = renderedOffsetsOfRange(rendered, input.range);
  if (offsets === null) return null;
  const trimmed = trimToText(rendered.text, offsets);
  if (trimmed === null) return null;

  const quote = rendered.text.slice(trimmed.start, trimmed.end);
  const trace = sourceTraceOf(input.part.source);

  if (!transferable(rendered.text, trace.plain, quote)) return null;

  const occurrence = countOccurrences(rendered.text.slice(0, trimmed.start), quote);
  const at = nthIndexOf(trace.plain, quote, occurrence);
  // Strict on purpose: falling back to the first occurrence is precisely the
  // confidently-wrong anchor this module exists to avoid.
  if (at === -1) return null;

  const md = mdRangeOfProjection(trace.runs, "plain", at, at + quote.length);
  if (md === null) return null;
  const range = { start: md.start + input.part.base, end: md.end + input.part.base };
  const selector = selectorAt(input.turnBody, range);
  if (!isCommentable(selector.exact)) return null;
  return { rendered: trimmed, range, selector };
}

export interface RenderedRangeInput {
  readonly root: Element;
  readonly part: TurnSourcePart;
  /** Offsets into the turn body. */
  readonly range: SelectionRange;
}

/** Where an anchored range lands in the rendered turn — the other direction. */
export function renderedRangeOfTurnAnchor(input: RenderedRangeInput): SelectionRange | null {
  const trace = sourceTraceOf(input.part.source);
  const plain = projectionRangeOfMd(
    trace.runs,
    "plain",
    input.range.start - input.part.base,
    input.range.end - input.part.base,
  );
  if (plain === null) return null;
  const quote = trace.plain.slice(plain.start, plain.end);
  if (quote === "") return null;
  const rendered = renderedTextOf(input.root);
  // The same guard as the capture side, on the direction that went without one
  // until UI-060. It is the *painting* half, so a disagreement here costs a
  // highlight rather than an anchor — but the failure it prevented was measured:
  // a turn reading `the⏎⏎next hen and hen`, anchored on the first real `hen`,
  // used to paint the second, because a manufactured occurrence inside `thenext`
  // took index 0. The data was never wrong and the thread still opened; the
  // reader was simply shown the wrong words. Anchors written before the capture
  // side was guarded exist in live workspaces, so this is not hypothetical.
  if (!transferable(trace.plain, rendered.text, quote)) return null;
  const occurrence = countOccurrences(trace.plain.slice(0, plain.start), quote);
  const at = nthIndexOf(rendered.text, quote, occurrence);
  if (at === -1) return null;
  return { start: at, end: at + quote.length };
}

/** A live DOM range over an anchored stretch of a rendered turn. */
export function domRangeOfTurnAnchor(input: RenderedRangeInput): Range | null {
  const offsets = renderedRangeOfTurnAnchor(input);
  if (offsets === null) return null;
  return domRangeOfRendered(renderedTextOf(input.root), offsets.start, offsets.end);
}
