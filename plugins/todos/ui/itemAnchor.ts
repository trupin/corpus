import type { ResolvedAnchor } from "@corpus/contract";
import { itemTextRange } from "../items.js";

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
 * `SELECTOR_CONTEXT`.
 *
 * Duplicated rather than shared because the kit publishes no selector builder
 * (see this issue's report): a plugin holding a body and a range has to slice
 * it itself. The number is what keeps the two spellings byte-identical, so it
 * is stated as a constant and pinned by a test rather than inlined twice.
 */
export const SELECTOR_CONTEXT = 32;

/** The wire shape of a text-quote selector, as `POST /api/threads` takes it. */
export interface ItemSelector {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

/**
 * The §6 selector for one item of a body, or `null` when the body cannot
 * support one.
 *
 * `expectedText` is the label the **user saw** on the row, and it is checked
 * against the body rather than trusted: the aggregate and the document are two
 * reads, and between them an earlier item can be deleted, renamed or reordered.
 * Anchoring "call the bank" to whatever happens to sit at index 3 now is the
 * silent-mis-anchor failure sprint-023 OC4 is about, one index further along.
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
  const range = itemTextRange(body, index);
  if (range === null) return null;
  const exact = body.slice(range.start, range.end);
  if (exact === "" || exact !== expectedText) return null;
  return {
    exact,
    prefix: body.slice(Math.max(0, range.start - SELECTOR_CONTEXT), range.start),
    suffix: body.slice(range.end, range.end + SELECTOR_CONTEXT),
  };
}

/**
 * The thread already anchored to this item, or `null`.
 *
 * "Already anchored" means an anchor whose quote **is** the item's text and
 * which still resolves. Both halves matter: a thread quoting three words inside
 * the item is a comment on those words and not on the item, and an orphaned
 * anchor no longer points at anything in this document — offering "open the
 * item's thread" for either would be the menu inventing a relationship the
 * document does not have (SPEC.md §11: "exactly that item's existing actions,
 * nothing invented").
 *
 * The first match wins when a document somehow carries two, which is the same
 * answer the reader's anchor layer gives.
 */
export function threadForItem(
  anchors: readonly ResolvedAnchor[],
  text: string,
): ResolvedAnchor | null {
  return anchors.find((anchor) => !anchor.orphaned && anchor.selector.exact === text) ?? null;
}
