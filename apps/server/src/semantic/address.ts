/**
 * Where a hit's heading path comes from (SPEC.md §9.2): the chunk that actually
 * matched, looked up in `chunk_search`.
 *
 * This replaces the on-read derivation Phase A shipped, which reconstructed the
 * address by locating `snippet()`'s window inside the indexed text with
 * `indexOf` and then scanning the headings above it. That works until a
 * document repeats itself: byte-identical boilerplate under `## Alpha` and
 * `## Omega` is found at the *first* occurrence and every hit on it is addressed
 * `Alpha`, whichever passage the ranking was actually about — the PR #15
 * finding. No offset arithmetic over a document-granular match can fix it,
 * because a document-granular match carries no offsets at all.
 *
 * So the address is asked of a chunk-granular index instead, and asked with the
 * **same** FTS expression the ranking used. Two properties make that safe:
 *
 * - **Ranking is untouched.** `search` still holds one row per document and per
 *   turn, and bm25 still scores those rows, so the hit list, its order and its
 *   snippets are byte-identical to Phase A. `chunk_search` is consulted only
 *   *after* a document has been chosen, and only to name a passage inside it
 *   (sprint-021, Open Conflict 3, option A).
 * - **The lookup is bounded by the page.** One statement for the whole page,
 *   restricted to the refs already on it — never a scan of the corpus.
 *
 * A ref with no matching chunk yields nothing and the caller falls back to the
 * document's title, exactly as it did when the passage text was missing.
 */

import type { ProjectionDb } from "../projection/db.js";

/**
 * Resolves each ref to the heading path of its best-matching chunk.
 *
 * Injectable so a test can count what a request actually read — the seam
 * `loadPassageTexts` held in Phase A, kept in the same position and for the same
 * reason (SERVER-022's `readHead` precedent).
 */
export type ChunkAddressLoader = (
  db: ProjectionDb,
  refs: readonly string[],
  match: string,
) => ReadonlyMap<string, string>;

/**
 * The best chunk per ref: lowest bm25 `rank` (more negative is better), ties
 * broken by `ord` so the earlier passage wins and the same query twice returns
 * the same address.
 *
 * Rows come back ordered and the first one seen per ref wins, rather than a
 * window function per ref: a document's chunk count is bounded by its own size
 * and the ref list is bounded by the page, so the whole result is small enough
 * that sorting it in SQL and folding it here is cheaper than teaching FTS5 to
 * partition.
 */
export const loadChunkAddresses: ChunkAddressLoader = (db, refs, match) => {
  const addresses = new Map<string, string>();
  if (refs.length === 0) return addresses;

  const placeholders = refs.map((_, index) => `@r${String(index)}`).join(", ");
  const params: Record<string, string> = { match };
  refs.forEach((ref, index) => {
    params[`r${String(index)}`] = ref;
  });

  const rows = db
    .prepare(
      `SELECT ref, heading_path FROM chunk_search
        WHERE chunk_search MATCH @match AND ref IN (${placeholders})
        ORDER BY rank, ord`,
    )
    .all(params) as { ref: string; heading_path: string }[];

  for (const row of rows) {
    if (!addresses.has(row.ref)) addresses.set(row.ref, row.heading_path);
  }
  return addresses;
};
