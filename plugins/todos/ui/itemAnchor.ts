import type { ResolvedAnchor } from "@corpus/contract";
import { itemTextRange, type TextRange } from "../items.js";

/**
 * An item, described the way SPEC.md §6 describes an anchor — and the anchor it
 * already has, when it has one.
 *
 * The board's todo column shows items, not documents, so "comment on this item"
 * and "open this item's thread" both need to say **which words** in the parent
 * body they mean. In the reader that answer comes from the selection; here
 * there is none, so the plugin builds the same selector from the body itself.
 *
 * **The whole file exists to make one property true**: a thread created from a
 * column row is indistinguishable — on the wire and in the parent's anchors —
 * from one created by selecting the same words in the reader. Anything less
 * makes item comments a second thread shape, which SPEC.md §12 explicitly does
 * not have ("an ordinary text-quote anchor, §6, unchanged").
 *
 * It is emphatically **not** anchoring machinery. Nothing here resolves a quote
 * against a body, decides what is orphaned, or paints a highlight — the server
 * does the first two and the reader does the third. This is the caller's half:
 * a quote and its surrounding words, handed to the kit's own `useCreateThread`
 * exactly as the editor's selection path hands over its own.
 */

/**
 * How much surrounding text a selector carries, matching `apps/ui`'s
 * `SELECTOR_CONTEXT` (`apps/ui/src/editor/selection.ts`).
 *
 * Duplicated rather than shared because the kit publishes no selector builder:
 * a plugin holding a body and a range has to slice it itself.
 *
 * **The duplication is a live drift risk and nothing here can detect it.** The
 * tests below pin this module against *itself* — that a selector carries 32
 * characters of frame — which says nothing about the number core uses. If core
 * changes its constant, plugin-made anchors stop being byte-identical to
 * reader-made ones for the same words, silently, and the only symptom is a
 * thread whose selector reads differently from its neighbours'. UI-045 item 1
 * owns the real fix (promote the constant and `selectorAt` into the kit, and
 * pin core and kit against each other); this constant goes away with it.
 */
export const SELECTOR_CONTEXT = 32;

/** The wire shape of a text-quote selector, as `POST /api/threads` takes it. */
export interface ItemSelector {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

/**
 * **Where this row's item is in the body** — the span both questions are
 * answered from, or `null` when the body cannot answer either.
 *
 * `expectedText` is the label the **user saw** on the row, and it is checked
 * against the body rather than trusted: the aggregate and the document are two
 * reads, and between them an earlier item can be deleted, renamed or reordered.
 * Anchoring "call the bank" to whatever happens to sit at index 3 now is the
 * silent-mis-anchor failure sprint-023 OC4 is about, one index further along.
 */
function itemRange(body: string, index: number, expectedText: string): TextRange | null {
  const range = itemTextRange(body, index);
  if (range === null) return null;
  const exact = body.slice(range.start, range.end);
  if (exact === "" || exact !== expectedText) return null;
  return range;
}

/**
 * The §6 selector for one item of a body, or `null` when the body cannot
 * support one.
 *
 * The context strings are carried even when empty — a quote at the very start
 * of a body genuinely has no prefix, and the contract's request-side selector
 * takes an empty string for one.
 */
export function itemSelector(
  body: string,
  index: number,
  expectedText: string,
): ItemSelector | null {
  const range = itemRange(body, index, expectedText);
  if (range === null) return null;
  return {
    exact: expectedText,
    prefix: body.slice(Math.max(0, range.start - SELECTOR_CONTEXT), range.start),
    suffix: body.slice(range.end, range.end + SELECTOR_CONTEXT),
  };
}

/**
 * The thread already anchored to this item, or `null`.
 *
 * **Identity is the item's span in the body, not its words.** A list with two
 * "Call the plumber" lines has two candidate spans, and matching on the quote
 * alone hands the second row the first row's thread — "Open existing thread"
 * appears on an item that has none and navigates to a conversation about a
 * different line (PR #19 review, MAJOR 3). Both halves of SPEC.md §11's
 * "exactly that item's existing actions, nothing invented" fail at once. So the
 * question asked is the one `itemSelector` already asks: *which characters of
 * this body is this row?* — and an anchor belongs to the row when it resolves
 * onto exactly those characters.
 *
 * Comparing ranges subsumes comparing quotes for every anchor the server
 * resolved exactly (its range is the span of `exact`), while also being the
 * truthful answer where the two differ: an anchor reconciliation re-landed on
 * these words *is* the thread the reader highlights on this line. It keeps the
 * older refusals intact for the same reason — a thread quoting three words
 * inside the item spans a narrower range and is a comment on those words, and
 * an orphaned anchor has no range in this body at all.
 *
 * The first match wins when a document somehow carries two on one span, which
 * is the same answer the reader's anchor layer gives.
 */
export function threadForItem(
  anchors: readonly ResolvedAnchor[],
  body: string,
  index: number,
  expectedText: string,
): ResolvedAnchor | null {
  const range = itemRange(body, index, expectedText);
  if (range === null) return null;
  return (
    anchors.find(
      (anchor) =>
        !anchor.orphaned &&
        anchor.range !== null &&
        anchor.range.start === range.start &&
        anchor.range.end === range.end,
    ) ?? null
  );
}
