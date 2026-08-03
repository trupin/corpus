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
 * The `(due: …)` an item's line ends with, or `""`.
 *
 * Its own function because it is the piece that has to be put **back** on the
 * frame side: `exact` deliberately stops before it (see
 * {@link itemOpenRequest}), so the rendered text that follows the target starts
 * with this marker rather than with the next item.
 */
export function dueMarker(item: TodoItem): string {
  return item.due === undefined ? "" : `(due: ${item.due})`;
}

/**
 * The text one item's line renders as: its text, plus the inline due marker
 * that `items.ts` writes at the end of the line.
 *
 * This is the *serializer's* spelling, deliberately — `- [ ] Pay the bill
 * (due: 2026-08-01)` renders as "Pay the bill (due: 2026-08-01)", one text run,
 * and a frame that stopped at "Pay the bill" would not be what immediately
 * precedes (or follows) the target item.
 */
export function lineText(item: TodoItem): string {
  const marker = dueMarker(item);
  return marker === "" ? item.text : `${item.text} ${marker}`;
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
 * **Both frames are rendered text, which is why `suffix` begins with the
 * target's own due marker.** `exact` stops before that marker, so the words
 * immediately after the quote are `"(due: 2026-08-09) Send the form"`, not
 * `"Send the form"` — and the reader tests the suffix with `startsWith` on
 * exactly those words. A suffix that named only the next item could therefore
 * never match, the reader would fall back to the first occurrence, and a
 * clicked duplicate with a deadline would flash the wrong line (PR #19 review,
 * MAJOR 1). The marker sits on the frame rather than in `exact` because that is
 * the side that can afford it: a deadline edited between the click and the open
 * costs the *frame*, and a lost frame degrades to the first occurrence, while a
 * lost `exact` finds nothing at all.
 *
 * Three limits, all deliberate:
 * - the first item of a document has no `prefix` (the text above it is prose
 *   this column has never read), and the last has no `suffix` beyond its own
 *   marker; a frame of one side is still a frame, and the reader treats a
 *   missing side as "anything";
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
  if (item === undefined) return { docId };
  const exact = item.text.trim();
  // Nothing quotable: this is still an open, just an ordinary one. A reveal
  // that cannot name its target must not be sent — the reader would search for
  // "" and the entry would carry a dead instruction.
  if (exact === "") return { docId };

  const previous = at === 0 ? undefined : items[at - 1];
  const next = items[at + 1];
  const prefix = previous === undefined ? "" : lineText(previous).trim();
  // The target's own marker first: it is the text between `exact` and the next
  // line, and the reader matches the suffix from the character after the quote.
  const suffix = [dueMarker(item), next === undefined ? "" : lineText(next).trim()]
    .filter((part) => part !== "")
    .join(" ");

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
