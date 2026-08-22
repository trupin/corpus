import type { DocRow, ResolvedAnchor } from "@corpus/contract";

/**
 * The comments list's model (SPEC.md §10, rider signed 2026-08-04): which of a
 * document's conversations are anchored, and what the two filter axes leave
 * standing.
 *
 * Pure, and separate from the surface that draws it, because the two axes are
 * the part with a wrong answer available: *"an open, unanchored comment is a
 * question the document has moved out from under"*, and a list that files an
 * orphan under **anchored** hides exactly the row the rider was written for.
 */

/**
 * Where a conversation sits relative to the document's text — three states,
 * because the rider's two labels are not enough to say *why* a row is unanchored
 * (§10: "an unanchored row opens its thread and **says why** it has no anchor").
 *
 * - `anchored` — an anchor entry that still resolves. It has a place in the body.
 * - `orphaned` — an anchor entry that no longer resolves: the document moved out
 *   from under it. §6 keeps the selector byte for byte, so the conversation still
 *   knows what it was about and can be offered a way back (UI-086).
 * - `unanchored` — no anchor entry at all: a remark about the whole document,
 *   which never had a place in the body and is not missing one.
 *
 * **It keys on whether the anchor RESOLVES, not on whether one exists.**
 * `DocRow.anchorQuote` is the stored selector's text and is present for an
 * orphan too, so a list built on it reports every orphan as anchored — which is
 * the one reading the live report ruled out. `Doc.anchors[].orphaned` is the
 * server's own verdict about the body as it now stands, and it is what this
 * reads.
 */
export type AnchorState = "anchored" | "orphaned" | "unanchored";

/** The status axis. `all` is the default: a filter that hides nothing. */
export type StatusFilter = "all" | "open" | "resolved";

/** The anchor axis. `unanchored` holds both {@link AnchorState}s that are not anchored. */
export type AnchorFilter = "all" | "anchored" | "unanchored";

export interface CommentFilters {
  readonly status: StatusFilter;
  readonly anchor: AnchorFilter;
}

/** Both axes open — every comment on the document, which is what the tab opens on. */
export const ALL_COMMENTS: CommentFilters = { status: "all", anchor: "all" };

/** One conversation on the document, with the anchor verdict the list needs. */
export interface CommentRow {
  readonly row: DocRow;
  readonly anchorState: AnchorState;
  /**
   * The document's anchor entry for this conversation, or `null` when it has
   * none. Carried rather than re-looked-up because the orphan half of the list
   * hands it to the re-attach offer, which needs the selector and the range.
   */
  readonly anchor: ResolvedAnchor | null;
}

/**
 * Every thread on the document, in the order the projection answered, each with
 * its anchor verdict.
 *
 * The order is deliberately not this module's: the rows come from
 * `GET /api/docs?parent=…&type=thread`, and a list that re-sorted them would
 * disagree with the board column showing the same rows.
 */
export function commentRows(
  threads: readonly DocRow[],
  anchors: readonly ResolvedAnchor[],
): readonly CommentRow[] {
  return threads.map((row) => {
    const anchor = anchors.find((entry) => entry.threadId === row.id) ?? null;
    return {
      row,
      anchor,
      anchorState: anchor === null ? "unanchored" : anchor.orphaned ? "orphaned" : "anchored",
    };
  });
}

/** Whether one row survives both axes. Independent, as the rider requires. */
export function matchesFilters(entry: CommentRow, filters: CommentFilters): boolean {
  const statusOk =
    filters.status === "all" ||
    (filters.status === "resolved"
      ? entry.row.status === "resolved"
      : entry.row.status !== "resolved");
  const anchorOk =
    filters.anchor === "all" ||
    (filters.anchor === "anchored"
      ? entry.anchorState === "anchored"
      : entry.anchorState !== "anchored");
  return statusOk && anchorOk;
}

export function filterComments(
  rows: readonly CommentRow[],
  filters: CommentFilters,
): readonly CommentRow[] {
  return rows.filter((entry) => matchesFilters(entry, filters));
}

/**
 * How many comments each filter position would leave standing.
 *
 * Every count is over the **whole** list rather than over what the other axis
 * currently allows, and that is what makes the two axes independent in the
 * control as well as in the predicate: a number that moved when the neighbouring
 * filter moved would be answering a question nobody asked of it.
 */
export interface CommentCounts {
  readonly all: number;
  readonly open: number;
  readonly resolved: number;
  readonly anchored: number;
  readonly unanchored: number;
}

export function countComments(rows: readonly CommentRow[]): CommentCounts {
  return {
    all: rows.length,
    open: rows.filter((entry) => entry.row.status !== "resolved").length,
    resolved: rows.filter((entry) => entry.row.status === "resolved").length,
    anchored: rows.filter((entry) => entry.anchorState === "anchored").length,
    unanchored: rows.filter((entry) => entry.anchorState !== "anchored").length,
  };
}

/** The words for a filter position, used in the empty-list sentence. */
const STATUS_WORD: Record<StatusFilter, string> = {
  all: "",
  open: "open",
  resolved: "resolved",
};

const ANCHOR_WORD: Record<AnchorFilter, string> = {
  all: "",
  anchored: "anchored",
  unanchored: "unanchored",
};

/**
 * What an empty list says.
 *
 * **Two different emptinesses, and telling them apart is the acceptance
 * criterion.** A list emptied by a filter names the filter and says how many rows
 * it is hiding. A document with **no comments at all** gets its own sentence, and
 * that is not a nicety: since the head's toggle only appears once a document has
 * conversations (see `CommentsSwitch`), a person arrives at this state
 * deliberately, through the ⋯ menu, in order to write the first comment. The
 * sentence therefore names the act rather than the absence, and says the one
 * thing that is not obvious — that nothing has to be selected first.
 *
 * A blank panel says neither, and the second emptiness silently looks like the
 * first.
 */
export function emptyCommentsNotice(counts: CommentCounts, filters: CommentFilters): string {
  if (counts.all === 0) {
    return "No comments on this document yet. Write the first one below — no text selection needed.";
  }
  const words = [STATUS_WORD[filters.status], ANCHOR_WORD[filters.anchor]].filter(
    (word) => word !== "",
  );
  const described = words.length === 0 ? "" : `${words.join(", ")} `;
  const hidden = counts.all;
  return `No ${described}comments. ${String(hidden)} ${hidden === 1 ? "comment is" : "comments are"} hidden by these filters.`;
}

/**
 * Why this row has no anchor, or what it is anchored to — §10's *"an unanchored
 * row opens its thread and says why it has no anchor"*.
 *
 * Three sentences for three states, because the two unanchored ones mean
 * different things and a list that worded them the same would report a data loss
 * on a comment that never had an anchor to lose.
 */
export function anchorReason(entry: CommentRow): string {
  const quote = quoteOf(entry);
  switch (entry.anchorState) {
    case "anchored":
      return quote === "" ? "anchored in the document" : `anchored to “${quote}”`;
    case "orphaned":
      return quote === ""
        ? "detached — its anchor no longer resolves in this document"
        : `detached — the document no longer contains “${quote}”`;
    case "unanchored":
      return "about the whole document — it never had an anchor";
  }
}

/**
 * The anchored words, from the anchor entry where there is one and the row
 * otherwise.
 *
 * The entry is preferred because it is the copy the resolver just ruled on, and
 * the row's is read for the case the two reads race: a thread row that has
 * arrived before the document's anchor list still knows its own quote.
 */
function quoteOf(entry: CommentRow): string {
  const fromAnchor = entry.anchor?.selector.exact.trim() ?? "";
  if (fromAnchor !== "") return flatten(fromAnchor);
  return flatten(entry.row.anchorQuote?.trim() ?? "");
}

/** One line, whatever the quote's own line breaks were. */
const flatten = (text: string): string => text.replace(/\s+/g, " ");

/**
 * The prototype's meta line: `2 turns · last: agent · open`.
 *
 * Moved here from the 💬 popover this tab replaced (UI-063), unchanged. It is
 * why the tab's turn counts and statuses cannot disagree with a board column's:
 * both read the same `DocRow`, through the same function.
 */
export function threadMeta(row: DocRow): string {
  const count = row.turnCount ?? 0;
  const last = row.lastAuthor ?? "—";
  return `${String(count)} turn${count === 1 ? "" : "s"} · last: ${last} · ${row.status}`;
}

/** The prototype's quote line: the anchored text, or what kind of thread it is. */
export function threadQuote(row: DocRow): string {
  const quote = row.anchorQuote?.trim() ?? "";
  return quote === "" ? "whole-document thread" : `“${quote}”`;
}

/**
 * A row's accessible name — the popover's own line, kept verbatim (UI-063).
 *
 * `.cp-item` was a `menuitem` whose whole accessible name was the quote and the
 * meta, and deleting the popover must not delete that. The tab's rows are
 * regions rather than menu items, so the name lands on the region and the same
 * two functions decide it.
 */
export function commentRowLabel(row: DocRow): string {
  return `${threadQuote(row)} — ${threadMeta(row)}`;
}
