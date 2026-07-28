import type { DocRow } from "@corpus/contract";

/**
 * What a *thread* row shows that a document row does not (SPEC.md §11 —
 * type-aware rows): the anchor quote it hangs off, the attributed last turn, and
 * an honest context line.
 *
 * Every value here is read off the row the collection query already returned.
 * Nothing in this module fetches: a per-row `useDoc(parent)` would be an N+1 on
 * the busiest surface in the product, and the board renders hundreds of rows.
 */

export const THREAD_DOC_TYPE = "thread";

/** Standalone: no parent. Anchored: a text selection. Whole-document: neither. */
export type ThreadKind = "standalone" | "anchored" | "whole-document";

export function isThreadRow(row: Pick<DocRow, "type">): boolean {
  return row.type === THREAD_DOC_TYPE;
}

export function threadKind(row: Pick<DocRow, "parent" | "anchorQuote">): ThreadKind {
  if (row.parent === null) return "standalone";
  return row.anchorQuote === null ? "whole-document" : "anchored";
}

/**
 * `<author>: <text>` from the thread's last turn — the row's second line.
 *
 * `null` for a thread with no turns and for a non-thread, so the caller renders
 * nothing at all rather than the string "null: undefined". Both fields are
 * nullable on the wire and they go null together, but they are checked
 * independently because a half-populated row must still degrade to silence.
 */
export function threadExcerpt(row: Pick<DocRow, "lastAuthor" | "lastTurn">): string | null {
  if (row.lastAuthor === null || row.lastTurn === null) return null;
  const text = row.lastTurn.trim();
  return text === "" ? null : `${row.lastAuthor}: ${text}`;
}

/** The excerpt a row of any type renders: a thread speaks through its last turn. */
export function rowExcerpt(row: DocRow): string | null {
  const excerpt = isThreadRow(row) ? (threadExcerpt(row) ?? row.excerpt) : row.excerpt;
  const text = excerpt.trim();
  return text === "" ? null : text;
}

/**
 * `data/docs/finance/2025-taxes.md` → `finance/`; a document at the docs root →
 * `""`. Presentation only — `id` is identity, and this never round-trips.
 */
export function folderOf(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  const docsAt = segments.indexOf("docs");
  // A path outside `data/docs/` has no folder to name — thread files live in
  // `data/threads/`, which is storage, not placement.
  if (docsAt === -1) return "";
  const folders = segments.slice(docsAt + 1, -1);
  return folders.length === 0 ? "" : `${folders.join("/")}/`;
}

/**
 * The first cell of the row's meta line.
 *
 * A standalone thread says so — "the conversation is the document" (SPEC.md §6).
 * A thread on a document names that document: `on <parent title>`, the
 * prototype's phrasing (`design/index.html`, "on Mortgage options"), read off
 * `DocRow.parentTitle`. The server resolves that title at query time next to the
 * row itself, so naming the parent costs no extra request — a per-row
 * `useDoc(parent)` would be the N+1 this module exists to avoid.
 *
 * `parentTitle` is null when the parent no longer resolves (a deleted parent
 * leaves an orphaned thread, SPEC.md §9.2), and then the row renders **nothing**
 * rather than a raw `doc_*` id — an id in the place a title was promised is
 * worse than a blank.
 */
export function rowContext(row: DocRow): string | null {
  if (!isThreadRow(row)) {
    const folder = folderOf(row.path);
    return folder === "" ? null : folder;
  }
  if (threadKind(row) === "standalone") return "standalone";
  const title = row.parentTitle?.trim() ?? "";
  return title === "" ? null : `on ${title}`;
}
