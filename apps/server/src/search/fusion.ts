/**
 * Reciprocal-rank fusion: two ranked lists of document ids, one ranked list out
 * (SPEC.md §9.1 — "the two relevances combine into one ranked list").
 *
 * **Ranks, never scores.** bm25 returns a negative log-odds-ish number whose
 * scale depends on the corpus; cosine returns [-1, 1]. There is no principled
 * constant that puts them on one axis, and inventing one would make the ranking
 * a tuning parameter nobody can reason about. RRF throws both scales away and
 * keeps the only thing the two lists agree on — position — which is why it is
 * the standard answer to precisely this problem and why it needs no per-corpus
 * calibration.
 *
 * **Determinism is structural** (TEST-881). Each list contributes
 * `1 / (RRF_K + position)` accumulated in list order and position order, so the
 * same inputs produce bit-identical sums; the sort breaks a tie on `id ASC`, the
 * rule `RELEVANCE_ORDER_BY` already ends with (`docs/filters.ts`). Nothing here
 * can depend on which row SQLite visited first, on `Map` iteration order, or on
 * which list an id was seen in.
 *
 * **A single list is passed through unchanged.** `1 / (K + i)` is strictly
 * decreasing in `i`, so fusing one list re-derives that list's own order — which
 * is what makes a workspace with no semantic index byte-identical to Phase A
 * (TEST-883) even on the code path that fuses.
 */

/**
 * RRF's smoothing constant, at its standard value.
 *
 * It sets how much a top position is worth relative to the ones below it: with
 * `k = 60`, rank 1 scores 1/61 and rank 2 scores 1/62 — a 1.6% gap — so a
 * document has to be well-placed on *both* lists to beat one that is first on
 * either. A much smaller `k` would make first place on a single list almost
 * unbeatable, turning fusion back into whichever list happened to rank the
 * document; a much larger one flattens the lists into their union. 60 is the
 * value the technique was published with and the value every subsequent
 * evaluation uses; it is not tuned per corpus, which is the point.
 */
export const RRF_K = 60;

/**
 * How much of each list is fetched before fusing, as a multiple of the caller's
 * `limit`.
 *
 * This constant exists because the lexical `LIMIT` is applied **inside the
 * ranking statement** (`search.ts`, sprint-021 premise correction C6): fusion
 * that saw only the top `limit` lexical rows could never learn that the
 * document ranked 11th lexically is first semantically, and a `limit=10` search
 * would silently be incapable of promoting it. Five is chosen against the
 * contract's own caps rather than by taste: at `RETRIEVAL_MAX_LIMIT = 50` it
 * reads 250 rows, which is a page of ids and snippets rather than a scan, and it
 * covers the whole default page five times over.
 */
export const RETRIEVAL_OVERFETCH_FACTOR = 5;

/** How many candidates one list may contribute, whatever `limit` was asked for. */
export const RETRIEVAL_OVERFETCH_CAP = 250;

/** The candidate depth each half is fetched to before fusion. */
export function overFetchLimit(limit: number): number {
  return Math.min(limit * RETRIEVAL_OVERFETCH_FACTOR, RETRIEVAL_OVERFETCH_CAP);
}

/**
 * Fuses ranked id lists into one, best first, capped at `limit`.
 *
 * Ids may repeat across lists and must not repeat within one; a list is read
 * positionally, so its own ordering is the whole of its contribution.
 */
export function fuseRankings(
  lists: readonly (readonly string[])[],
  limit: number,
): { readonly id: string; readonly score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let position = 0; position < list.length; position += 1) {
      const id = list[position];
      if (id === undefined) continue;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + position + 1));
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1))
    .slice(0, Math.max(0, limit));
}
