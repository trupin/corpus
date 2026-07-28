import { selectorAt, type SelectionRange, type TextQuoteSelector } from "../editor/selection";
import { pmRangeToMd, type PmRange } from "./offsetMap";
import type { DocumentTrace } from "./traceCache";

/**
 * A selection, described the way SPEC.md §6 describes an anchor.
 *
 * The quote comes from the **markdown source**, never from the DOM's text: a
 * selection reading `30-year fixed quote` on screen is `**30-year fixed**
 * quote` in the file, and the server's resolution ladder matches literally
 * before it matches anything else. Nothing here trims or normalises whitespace
 * for the same reason — a tidied quote is a quote of a document that does not
 * exist.
 *
 * This replaces the interim locator in `editor/selection.ts` for the one caller
 * that has a trace. That module finds the selected text in the body and answers
 * `null` when the two spellings differ; this one maps positions through the
 * serializer's emission trace and is exact wherever the trace is — including
 * across markup, across blocks, and inside a `[[ref]]`.
 */

export interface AnchorSelection {
  readonly range: SelectionRange;
  readonly selector: TextQuoteSelector;
}

/**
 * Whether a selection can carry a comment at all.
 *
 * An empty or whitespace-only quote is not an anchor: `exact` is `min(1)` on
 * the wire, and a selector of spaces would resolve against every indent in the
 * document (sprint-011 TEST-103).
 */
export function isCommentable(quote: string): boolean {
  return quote.trim() !== "";
}

/** The selector for a ProseMirror range, or `null` when it quotes no content. */
export function selectorFromSelection(
  source: DocumentTrace,
  range: PmRange,
): AnchorSelection | null {
  const md = pmRangeToMd(source.trace, range);
  if (md === null) return null;
  const exact = source.markdown.slice(md.start, md.end);
  if (!isCommentable(exact)) return null;
  return { range: md, selector: selectorAt(source.markdown, md) };
}
