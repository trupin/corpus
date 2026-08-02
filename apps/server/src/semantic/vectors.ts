/**
 * The vector half of retrieval: a brute-force cosine scan over
 * `chunk_embeddings`, aggregated to documents.
 *
 * **This is the implementation, not a fallback** (sprint-021 Open Conflict 2,
 * ruled by the orchestrator on 2026-07-31). The issue text called a sqlite
 * vector extension "the preferred shape"; the measurement says otherwise. On
 * this machine, a flat `Float32Array` scan over **10,000 × 384 dims is 3.27 ms
 * per query**, and reading all 10,000 vectors back out of SQLite as BLOBs is
 * **10.8 ms** — so a cold semantic query on the largest corpus this product is
 * built for costs ~14 ms end to end. A native KNN index earns its keep somewhere
 * past 10⁵ vectors, and buying one costs a native dependency, per-platform
 * staging, a CI matrix and a parity test. Everything here sits behind
 * {@link nearestDocuments}, so an extension can be added later without a caller
 * changing.
 *
 * Three rules the scan obeys, each of them load-bearing:
 *
 * - **One index, one model** (SPEC.md §9.1). Every statement filters on
 *   `identity`, so vectors produced by a different model are not merely ranked
 *   lower — they are never read. Mixing is unrepresentable rather than avoided.
 * - **The dimension comes from the row**, and a row whose blob length disagrees
 *   with it is skipped. `writeEmbedding` derives `dim` from the vector it is
 *   given (`embeddings.ts`), so a disagreement cannot be written through the
 *   server; it can arrive from a hand-edited projection, and a scan that trusted
 *   it would read a neighbouring row's bytes as floats.
 * - **The filters are the shared ones.** The scan joins `documents`, `threads`
 *   and `seen` under the aliases `docs/filters.ts` writes its fragments against,
 *   so §9.2's fourteen structured filters — the archived default first among
 *   them — apply to the semantic half by construction rather than by a second
 *   implementation.
 *
 * Everything here is **synchronous**, like every other projection read. That is
 * not incidental: `ProjectionDb.prepare` memoizes statements, and a memoized
 * statement cannot have two live `iterate()` cursors. A synchronous scan cannot
 * interleave with itself, so the cursor is always drained before the next
 * request can start one.
 */

import { endianness } from "node:os";
import { DOC_FILTER_JOINS } from "../docs/filters.js";
import type { ProjectionDb } from "../projection/db.js";
import { blobToVector } from "./embeddings.js";

/**
 * The predicate a scan is restricted to: SQL naming only the `d`, `t` and `s`
 * aliases {@link import("../docs/filters.js").FROM_SQL} binds, plus the values
 * it references.
 *
 * It is passed as text-plus-parameters rather than as a compiled filter object
 * because the two callers build it differently — ranked search hands over
 * `compileFilters`'s whole WHERE clause, `related` hands over one archived
 * fragment — while both must land on the same join shape.
 */
export interface SemanticScope {
  /** A boolean SQL expression over `d`, `t`, `s`; `1` for "everything". */
  readonly where: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Everything is filtered in; the scope a `related` call with `includeArchived` uses. */
export const UNFILTERED_SCOPE: SemanticScope = { where: "1", params: {} };

/**
 * How near a chunk has to be before the semantic half will name it at all.
 *
 * **A noise gate, not a relevance judgement**, and the distinction is the whole
 * of why the number is this low. Cosine is defined for *every* pair, so with no
 * gate a query for a term nobody wrote returns the nearest N documents anyway,
 * and — the part that actually matters — `GET /api/docs/{id}/related` publishes
 * `similar` about a document with nothing in common. `similar` is a **claim**,
 * not merely an ordering, and a claim at cosine 0.02 is false.
 *
 * **Measured, not guessed** (SERVER-045's E2E log, real `all-MiniLM-L6-v2`
 * embeddings over a real workspace):
 *
 * | pair | cosine |
 * | --- | --- |
 * | keyword-disjoint paraphrases, either direction | 0.236 – 0.264 |
 * | documents on loosely adjacent subjects | 0.148 – 0.212 |
 * | documents with nothing in common | 0.011 – 0.084 |
 *
 * The separation between "paraphrase" and "adjacent" is **narrow** — 0.236 to
 * 0.212 on one-sentence documents — and no constant splits it. That is the
 * finding, and it decides where this one goes: a floor placed in that gap drops
 * the paraphrase in one direction and keeps it in the other, which is worse than
 * useless. So the gate is set below the whole cluster of real relationships, at
 * the top of the "nothing in common" band, and it excludes only what the model
 * says is unrelated. Deciding *which* of the surviving candidates matters is the
 * ranking's job, and the ranking is what the caller's `limit` bounds.
 *
 * A model whose similarity scale differs shifts what it excludes. That is the
 * known cost of a single number here; it is paid because the alternative is
 * publishing `similar` about a document that shares nothing, and it is bounded
 * because the gate's failure mode in either direction is a candidate the ranking
 * would have placed near the bottom anyway.
 */
export const SEMANTIC_MIN_SIMILARITY = 0.15;

/** One document, ranked by its best-matching chunk. */
export interface DocumentVectorMatch {
  readonly id: string;
  /** The chunk that earned the document its place — the one whose address is reported. */
  readonly chunkId: string;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  readonly score: number;
}

export interface VectorScanOptions {
  readonly identity: string;
  /** The query vector. Normalised here, so a caller may hand over a raw one. */
  readonly query: Float32Array;
  readonly scope: SemanticScope;
  /** How many documents to return; the scan itself always reads every vector. */
  readonly limit: number;
  /** Never a neighbour of itself (SPEC.md §9.2) — `related`'s own document. */
  readonly excludeDocId?: string | undefined;
}

/**
 * Scales a vector to unit length so a dot product *is* a cosine similarity.
 *
 * Returns the input unchanged when it is already unit — the common case, since
 * the worker normalises at write time (paying once per chunk instead of once per
 * chunk per query) and the embedded engine normalises before that.
 */
export function normalizeVector(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0 || Math.abs(norm - 1) <= 1e-6) return vector;
  const scaled = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    scaled[index] = (vector[index] ?? 0) / norm;
  }
  return scaled;
}

/**
 * Cosine similarity against a **unit-length** `query`.
 *
 * The stored vector's own norm is computed in the same pass rather than assumed:
 * one extra multiply per component buys correctness for any vector that reached
 * the table without passing the worker's normaliser — a hand-inserted fixture, a
 * future writer, a row restored from an older build. Both sums are accumulated
 * in a fixed index order, so the score is bit-reproducible for fixed inputs,
 * which is what makes fusion deterministic (TEST-881).
 */
export function cosineSimilarity(query: Float32Array, vector: Float32Array): number {
  let dot = 0;
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    dot += (query[index] ?? 0) * value;
    norm += value * value;
  }
  if (norm === 0) return 0;
  return dot / Math.sqrt(norm);
}

const LITTLE_ENDIAN = endianness() === "LE";

/**
 * The stored blob as floats, without copying when the platform allows it.
 *
 * `vectorToBlob` writes little-endian float32, and a `Float32Array` view over
 * the same bytes is platform-endian — identical on every platform Node ships
 * for, and wrong on a big-endian one, where {@link blobToVector}'s explicit
 * `readFloatLE` loop is used instead. The view additionally needs 4-byte
 * alignment, which better-sqlite3's pooled buffers do not guarantee; an
 * unaligned blob is copied into a fresh `ArrayBuffer`, which is aligned by
 * construction.
 *
 * `null` when the blob's length disagrees with the row's recorded dimension —
 * the corrupt-row case the caller drops rather than scores.
 */
export function vectorFromBlob(blob: Buffer, dim: number): Float32Array | null {
  if (dim <= 0 || blob.length !== dim * Float32Array.BYTES_PER_ELEMENT) return null;
  if (!LITTLE_ENDIAN) return blobToVector(blob);
  if (blob.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
    return new Float32Array(blob.buffer, blob.byteOffset, dim);
  }
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length));
}

/**
 * The joins every scan writes its scope against — `documents` reached through
 * the chunk that carries the vector, then the two optional rows the shared
 * filter fragments name.
 *
 * `DISTINCT` is deliberately absent: two positions in one document can hold
 * byte-identical text and therefore share a content-addressed chunk id, so the
 * same vector can arrive twice. Deduplicating in SQL would mean `DISTINCT` over
 * a BLOB; the fold below keeps the better score per document, for which a
 * repeated identical score is a no-op.
 */
const scanSql = (where: string): string => `SELECT c.chunk_id AS chunk_id, c.doc_id AS doc_id,
       e.dim AS dim, e.vec AS vec
  FROM chunk_embeddings e
  JOIN chunks c ON c.chunk_id = e.chunk_id
  JOIN documents d ON d.id = c.doc_id
  ${DOC_FILTER_JOINS}
 WHERE e.state = 'ready' AND e.vec IS NOT NULL AND e.identity = @identity
   AND (${where})`;

interface ScanRow {
  readonly chunk_id: string;
  readonly doc_id: string;
  readonly dim: number;
  readonly vec: Buffer;
}

interface Best {
  chunkId: string;
  score: number;
}

/**
 * The nearest documents to `query`, best first.
 *
 * **Aggregation is max, never sum** (TEST-892): a document's score is its single
 * best chunk's, so a long document cannot out-rank a precise one merely by
 * having more passages to accumulate. It mirrors the lexical half's own rule —
 * `MIN(rank)` per document, one hit per document, addressed by the row that
 * earned it (`search/search.ts`).
 *
 * Every ordering here is total and independent of row-visit order, because SQL
 * guarantees none: the winning chunk within a document breaks a score tie by
 * chunk id, and the document order breaks a score tie by document id — the
 * convention `RELEVANCE_ORDER_BY` already follows.
 *
 * Chunks below {@link SEMANTIC_MIN_SIMILARITY} are dropped before any of that,
 * so a document nobody would call related is absent rather than last.
 */
export function nearestDocuments(
  db: ProjectionDb,
  options: VectorScanOptions,
): DocumentVectorMatch[] {
  const query = normalizeVector(options.query);
  const dim = query.length;
  if (dim === 0 || options.limit <= 0) return [];

  const sql = scanSql(options.scope.where);
  const best = new Map<string, Best>();

  for (const row of db
    .prepare(sql)
    .iterate({ ...options.scope.params, identity: options.identity }) as Iterable<ScanRow>) {
    if (row.dim !== dim) continue;
    if (row.doc_id === options.excludeDocId) continue;
    const vector = vectorFromBlob(row.vec, row.dim);
    if (vector === null) continue;

    const score = cosineSimilarity(query, vector);
    if (score < SEMANTIC_MIN_SIMILARITY) continue;
    const current = best.get(row.doc_id);
    if (
      current === undefined ||
      score > current.score ||
      (score === current.score && row.chunk_id < current.chunkId)
    ) {
      best.set(row.doc_id, { chunkId: row.chunk_id, score });
    }
  }

  return [...best.entries()]
    .map(([id, entry]): DocumentVectorMatch => ({ id, chunkId: entry.chunkId, score: entry.score }))
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1))
    .slice(0, options.limit);
}

/** How many ready vectors the index holds in total, and how many at one identity. */
export interface VectorCensus {
  readonly total: number;
  readonly atIdentity: number;
}

/**
 * One statement, two numbers: whether the index holds anything usable at all,
 * and whether any of it was made by the model resolved now.
 *
 * The pair is what tells "nothing has been embedded yet" apart from "the index
 * belongs to a different model" — the first is an empty workspace catching up,
 * the second is the identity mismatch §9.1 forbids mixing across, and only the
 * second is a reason to give up on a cached provider.
 */
export function vectorCensus(db: ProjectionDb, identity: string): VectorCensus {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN identity = @identity THEN 1 END) AS at_identity
         FROM chunk_embeddings WHERE state = 'ready' AND vec IS NOT NULL`,
    )
    .get({ identity }) as { total: number; at_identity: number };
  return { total: row.total, atIdentity: row.at_identity };
}

/**
 * The document as one vector: the mean of its chunks' vectors, normalised.
 *
 * `related` asks "what else bears on this document", and the alternative —
 * scoring every corpus chunk against every one of the document's own chunks —
 * multiplies the scan by the source document's chunk count, so a 200-chunk
 * document would make one `related` call two orders of magnitude more expensive
 * than a search. The centroid keeps the cost identical to a query embedding's,
 * which is the budget §9.2's frugality argument was written against. A document
 * spanning several unrelated subjects is the case it serves least well, and that
 * is the trade recorded rather than hidden.
 *
 * `null` when the document has no usable vector at this identity — nothing to
 * average, and no basis for a semantic neighbour.
 */
export function documentCentroid(
  db: ProjectionDb,
  docId: string,
  identity: string,
): Float32Array | null {
  const rows = db
    .prepare(
      `SELECT DISTINCT e.chunk_id AS chunk_id, e.dim AS dim, e.vec AS vec
         FROM chunk_embeddings e JOIN chunks c ON c.chunk_id = e.chunk_id
        WHERE c.doc_id = @docId AND e.identity = @identity
          AND e.state = 'ready' AND e.vec IS NOT NULL
        ORDER BY e.chunk_id`,
    )
    .all({ docId, identity }) as ScanRow[];

  let sum: Float32Array | undefined;
  let counted = 0;
  for (const row of rows) {
    const vector = vectorFromBlob(row.vec, row.dim);
    if (vector === null) continue;
    // A document whose chunks somehow carry two dimensions is drift; the first
    // dimension seen wins and the rest are skipped, so the centroid is at least
    // a vector of one width rather than a sum of two.
    sum ??= new Float32Array(vector.length);
    if (vector.length !== sum.length) continue;
    for (let index = 0; index < sum.length; index += 1) {
      sum[index] = (sum[index] ?? 0) + (vector[index] ?? 0);
    }
    counted += 1;
  }

  if (sum === undefined || counted === 0) return null;
  return normalizeVector(sum);
}
