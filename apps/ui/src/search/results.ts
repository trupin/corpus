import type { DocRow } from "@corpus/contract";
import { ageAnchor, folderOf, humanizeAge, isThreadRow, rowContext } from "@corpus/kit";

/**
 * What the overlay renders, derived from the one response it already has
 * (SPEC.md §11 — "snippet-highlighted results grouped by type").
 *
 * Everything here is a pure function of the returned `items`. Grouping is a
 * partition, the counts are the partition's sizes, and the create row's
 * visibility is decided by comparing the query against the titles that came
 * back. No branch in this file can issue a request, which is the structural
 * reason the overlay cannot grow a second one per group.
 */

/** The minimum a query must be before offering to create it (the prototype's). */
export const MIN_CREATE_QUERY_LENGTH = 2;

export interface ResultGroup {
  /** `documents` / `threads` — the React key and the partition's identity. */
  readonly key: string;
  /** `Documents · 3`, as the prototype's `.sr-group` header reads. */
  readonly heading: string;
  readonly rows: readonly DocRow[];
}

/**
 * Documents first, then Threads — the prototype's order.
 *
 * A type the client has never heard of (a plugin's) is a document: it is a
 * document on disk and in the projection, and inventing a third group for it
 * would need the plugin manifest, which is PLUGINS-001's. An empty partition is
 * dropped rather than rendered as `Threads · 0`.
 */
export function groupResults(items: readonly DocRow[]): readonly ResultGroup[] {
  const documents = items.filter((row) => !isThreadRow(row));
  const threads = items.filter((row) => isThreadRow(row));
  return [
    { key: "documents", label: "Documents", rows: documents },
    { key: "threads", label: "Threads", rows: threads },
  ]
    .filter((group) => group.rows.length > 0)
    .map(({ key, label, rows }) => ({
      key,
      heading: `${label} · ${String(rows.length)}`,
      rows,
    }));
}

/**
 * The mono `.sr-path` line under a result.
 *
 * A document says where it lives and how old it is; a thread says what it hangs
 * off and where it stands — the prototype's `finance/housing · updated 2d ago`
 * and `on Mortgage options · open`. The parent is named through the kit's
 * `rowContext`, which reads `parentTitle` off the row and renders nothing rather
 * than a raw `doc_*` id when the parent is gone.
 */
export function resultPath(row: DocRow, now: Date = new Date()): string {
  const context = rowContext(row) ?? (isThreadRow(row) ? "" : folderOf(row.path));
  const tail = isThreadRow(row)
    ? row.parent === null && row.turnCount !== null
      ? `${String(row.turnCount)} turn${row.turnCount === 1 ? "" : "s"}`
      : row.status
    : updatedLabel(row, now);
  return [context, tail].filter((part) => part !== "").join(" · ");
}

/**
 * `updated 2d ago` — the prototype's phrasing, with the one age the kit already
 * spells as a phrase left alone: `humanizeAge` returns "just now" under an hour,
 * and "updated just now ago" is not English.
 */
function updatedLabel(row: DocRow, now: Date): string {
  const anchor = ageAnchor(row);
  if (anchor === undefined) return "";
  const humanized = humanizeAge(now.getTime() - anchor);
  return humanized === JUST_NOW ? `updated ${JUST_NOW}` : `updated ${humanized} ago`;
}

/** The kit's own sub-hour label, which reads as a phrase rather than a duration. */
const JUST_NOW = "just now";

/**
 * True when a returned row's title is the query, case-insensitively.
 *
 * Decided from the **response** — the create row must not cost a second
 * request, and the collection the user is looking at is the same collection the
 * title would collide in.
 */
export function hasExactTitle(items: readonly DocRow[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return false;
  return items.some((row) => row.title.trim().toLowerCase() === wanted);
}

/** `＋ Create "<query>"` is offered for a real query that names nothing yet. */
export function shouldOfferCreate(items: readonly DocRow[], text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CREATE_QUERY_LENGTH) return false;
  return !hasExactTitle(items, trimmed);
}

/** What `↑`/`↓` walk: the create row, then every result, headers excluded. */
export function cursorTargets(
  groups: readonly ResultGroup[],
  offersCreate: boolean,
): readonly string[] {
  const rows = groups.flatMap((group) => group.rows.map((row) => row.id));
  return offersCreate ? ["create", ...rows] : rows;
}

/**
 * The cursor after a `↑`/`↓`, clamped at both ends.
 *
 * Clamped rather than wrapped: the prototype's list is short, and a cursor that
 * jumps from the last result back to "create a new document" is one keystroke
 * away from creating something by accident.
 */
export function moveCursor(index: number, delta: number, count: number): number {
  if (count === 0) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, index + delta));
}
