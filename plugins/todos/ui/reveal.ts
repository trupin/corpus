import type { OpenRequest } from "@corpus/kit/plugin";
import type { TodoItem } from "../items.js";

/**
 * "Open the list **at this item**" — the payload a clicked todo row hands the
 * board's `onOpen` (PLUGINS-010, on UI-037's seam).
 *
 * The column is an aggregate: it shows five open items out of a document that
 * may hold twenty, and the user who clicks one is pointing at a line, not at a
 * document. Handing back a bare `docId` opens that document at the top and
 * leaves them to find the line themselves — which for the 17-item list that
 * reported this is a scroll and a search.
 *
 * A reveal quotes **rendered text**, never markdown (`@corpus/kit/plugin`'s
 * `RevealItem`: "quote the item, not `- [ ] the item`"), and this module is the
 * one place that translates a parsed {@link TodoItem} back into the words the
 * reader will actually find on screen.
 */

/**
 * The text one item's line renders as: its text, plus the inline due marker
 * that `items.ts` writes at the end of the line.
 *
 * This is the *serializer's* spelling, deliberately — `- [ ] Pay the bill
 * (due: 2026-08-01)` renders as "Pay the bill (due: 2026-08-01)", one text run,
 * and a frame that stopped at "Pay the bill" would not be what immediately
 * precedes the next item. It is only ever used as a **prefix** frame, where
 * only the tail of the text matters.
 */
export function lineText(item: TodoItem): string {
  return item.due === undefined ? item.text : `${item.text} (due: ${item.due})`;
}

/**
 * The open request for the item at `at` in `items` — the document's items in
 * **body order, done ones included**, because a reveal's frame is about what
 * the reader renders, not about what the column chose to show.
 *
 * `exact` is the item's own text, without the due marker: the marker is part of
 * the rendered line, so quoting it would still match, but leaving it out means
 * a document whose deadline was edited between the click and the open still
 * reveals the right line, and the flash lands on the words rather than on the
 * bookkeeping.
 *
 * `prefix`/`suffix` are the item's **real neighbours** (sprint-023 OC4). Two
 * "Call the plumber" items in one list is the ordinary case, not the exotic
 * one, and `exact` alone silently reveals the first of them — a failure that
 * looks like it worked. So the frame is never guessed: it is the line above and
 * the line below, exactly as they are rendered, and the reader's
 * `chooseOccurrence` picks the occurrence they enclose.
 *
 * Three limits, all deliberate:
 * - the first item of a document has no `prefix` (the text above it is prose
 *   this column has never read) and the last has no `suffix`; a frame of one
 *   side is still a frame, and the reader treats a missing side as "anything";
 * - *three* identical consecutive items are past what a one-line frame can
 *   distinguish — the reveal lands on an identical adjacent line, which is the
 *   honest answer rather than a wrong-looking one;
 * - an item whose text carries inline markdown (`**urgent**`) renders without
 *   the syntax, so the quote will not be found and the document opens at the
 *   top with no flash. The reader gives up rather than flashing something else.
 */
export function itemOpenRequest(
  docId: string,
  items: readonly TodoItem[],
  at: number,
): OpenRequest {
  const item = items[at];
  const exact = item?.text.trim() ?? "";
  // No such item, or nothing quotable: this is still an open, just an ordinary
  // one. A reveal that cannot name its target must not be sent — the reader
  // would search for "" and the entry would carry a dead instruction.
  if (exact === "") return { docId };

  const previous = at === 0 ? undefined : items[at - 1];
  const prefix = previous === undefined ? "" : lineText(previous).trim();
  const suffix = items[at + 1]?.text.trim() ?? "";

  return {
    docId,
    reveal: {
      kind: "item",
      exact,
      ...(prefix === "" ? {} : { prefix }),
      ...(suffix === "" ? {} : { suffix }),
    },
  };
}
