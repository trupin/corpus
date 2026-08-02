import type { SearchHit } from "@corpus/contract";

/**
 * What the overlay renders, derived from the one response it already has
 * (SPEC.md §11 — "snippet-highlighted results grouped by type").
 *
 * Everything here is a pure function of the returned `hits`. Grouping is a
 * partition, the counts are the partition's sizes, and the create row's
 * visibility is decided by comparing the query against the titles that came
 * back. No branch in this file can issue a request, which is the structural
 * reason the overlay cannot grow a second one per group.
 */

/** The minimum a query must be before offering to create it (the prototype's). */
export const MIN_CREATE_QUERY_LENGTH = 2;

/**
 * The two kinds the overlay groups by, and the only kind information a ranked
 * hit carries.
 *
 * `GET /api/search` answers with an **address plus a line of context** — id,
 * title, heading path, snippet — and deliberately not with a document row, so
 * there is no `type` field to partition on the way `GET /api/docs` rows were
 * partitioned. What survives is the id, and that is not an accident of
 * formatting: ids are *prefixed by kind* by contract (SPEC.md §5, and
 * `DocumentIdSchema`'s `^(doc|th)_[A-Za-z0-9]+$`) — threads are `th_*`, every
 * other document `doc_*`. A route that takes "any document id" accepts either
 * prefix precisely because the prefix is what tells them apart.
 *
 * So the discriminant is named here, once, and tested — rather than spelled
 * inline at each use site, where it would read as a lucky guess about string
 * formatting.
 */
export type ResultKind = "thread" | "doc";

/** The prefix `DocumentIdSchema` reserves for threads (SPEC.md §5, §6). */
const THREAD_ID_PREFIX = "th_";

/**
 * Which kind a hit is.
 *
 * A plugin's document type is a `doc`: it is a document on disk and in the
 * projection, and inventing a third group for it would need the plugin manifest,
 * which is PLUGINS-001's.
 */
export function resultKind(hit: Pick<SearchHit, "id">): ResultKind {
  return hit.id.startsWith(THREAD_ID_PREFIX) ? "thread" : "doc";
}

export interface ResultGroup {
  /** `documents` / `threads` — the React key and the partition's identity. */
  readonly key: string;
  /** `Documents · 3`, as the prototype's `.sr-group` header reads. */
  readonly heading: string;
  readonly rows: readonly SearchHit[];
}

/**
 * Documents first, then Threads — the prototype's order.
 *
 * A partition of the ranking, never a re-ranking: inside each group the hits
 * keep the order the server returned them in. An empty partition is dropped
 * rather than rendered as `Threads · 0`.
 */
export function groupResults(hits: readonly SearchHit[]): readonly ResultGroup[] {
  const documents = hits.filter((hit) => resultKind(hit) === "doc");
  const threads = hits.filter((hit) => resultKind(hit) === "thread");
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
 * True when a returned hit's title is the query, case-insensitively.
 *
 * Decided from the **response** — the create row must not cost a second
 * request, and the collection the user is looking at is the same collection the
 * title would collide in.
 */
export function hasExactTitle(hits: readonly SearchHit[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return false;
  return hits.some((hit) => hit.title.trim().toLowerCase() === wanted);
}

/** `＋ Create "<query>"` is offered for a real query that names nothing yet. */
export function shouldOfferCreate(hits: readonly SearchHit[], text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CREATE_QUERY_LENGTH) return false;
  return !hasExactTitle(hits, trimmed);
}

/** What `↑`/`↓` walk: the create row, then every result, headers excluded. */
export function cursorTargets(
  groups: readonly ResultGroup[],
  offersCreate: boolean,
): readonly string[] {
  const rows = groups.flatMap((group) => group.rows.map((hit) => hit.id));
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
