/**
 * The `chunk_embeddings` half of the semantic index: writing a vector, and
 * reading back which model produced the ones already there.
 *
 * **Identity is not stored beside the index; it *is* the index's rows.** The
 * `identity` column is `NOT NULL` (`projection/schema.ts`), and every write goes
 * through one statement that carries it, so "a vector with no recorded identity"
 * is unrepresentable rather than merely unlikely — there is no window between
 * writing a vector and recording what made it, because they are one row. That
 * also makes stickiness free across a `corpus db rebuild`: the rebuild carries
 * `chunk_embeddings` over wholesale (sprint-021 Open Conflict 5), so the
 * recorded identity survives with it, and a separate metadata key would have had
 * to be carried over too, or silently lose the index's provenance.
 *
 * Vectors are stored as little-endian float32 blobs — the layout SERVER-045's
 * brute-force cosine scan reads back — because SQLite has no vector type and the
 * measured cost of decoding 10,000 of them is 10.8 ms.
 */

import type { ProjectionDb } from "../projection/db.js";

/**
 * `ready` — a usable vector. `failed` — the worker gave up on this chunk and is
 * counting it rather than dropping it (CONTRACT-023's `failed`). "Pending" is
 * deliberately absent: it is `chunks` left-joined against this table
 * (`chunks.ts`), a fact about content rather than a flag anyone must remember to
 * write.
 */
export const EMBEDDING_STATES = ["ready", "failed"] as const;

export type EmbeddingState = (typeof EMBEDDING_STATES)[number];

export type EmbeddingRecord =
  | {
      readonly state: "ready";
      readonly chunkId: string;
      readonly identity: string;
      readonly vector: Float32Array;
      readonly failures?: number | undefined;
      readonly updatedMs: number;
    }
  | {
      readonly state: "failed";
      readonly chunkId: string;
      readonly identity: string;
      /** The provider's dimension when it is known; `0` when nothing ever came back. */
      readonly dim?: number | undefined;
      readonly failures: number;
      readonly updatedMs: number;
    };

/** Float32 little-endian, contiguous. The inverse of {@link blobToVector}. */
export function vectorToBlob(vector: Float32Array): Buffer {
  const blob = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < vector.length; index += 1) {
    blob.writeFloatLE(vector[index] ?? 0, index * Float32Array.BYTES_PER_ELEMENT);
  }
  return blob;
}

export function blobToVector(blob: Buffer): Float32Array {
  const vector = new Float32Array(blob.length / Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = blob.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
  }
  return vector;
}

/**
 * Writes one embedding row, replacing whatever was there for that chunk.
 *
 * A single statement on purpose: the vector, the dimension and the identity that
 * produced them are written together or not at all, which is what makes a
 * half-indexed chunk impossible to observe after a kill (SERVER-044's crash
 * test) without anybody opening a transaction for it.
 */
export function writeEmbedding(db: ProjectionDb, record: EmbeddingRecord): void {
  const isReady = record.state === "ready";
  if (record.identity === "") {
    throw new RangeError(`refusing to record an embedding for ${record.chunkId} with no identity`);
  }
  const dim = isReady ? record.vector.length : (record.dim ?? 0);
  if (isReady && dim === 0) {
    throw new RangeError(`refusing to record an empty vector for ${record.chunkId}`);
  }

  db.prepare(
    `INSERT OR REPLACE INTO chunk_embeddings
       (chunk_id, identity, dim, vec, state, failures, updated_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.chunkId,
    record.identity,
    dim,
    isReady ? vectorToBlob(record.vector) : null,
    record.state,
    record.failures ?? 0,
    record.updatedMs,
  );
}

/**
 * Every distinct identity the index holds, sorted. Empty on a fresh workspace;
 * more than one is drift — §9.1 forbids mixing results from different models —
 * which `db doctor` fails on (SERVER-046) and `checkIndexIdentity` reports.
 */
export function recordedIdentities(db: ProjectionDb): string[] {
  const rows = db
    .prepare("SELECT DISTINCT identity FROM chunk_embeddings ORDER BY identity")
    .all() as { identity: string }[];
  return rows.map((row) => row.identity);
}

/** The index's one identity, or `null` when there is none *or* more than one. */
export function recordedIdentity(db: ProjectionDb): string | null {
  const identities = recordedIdentities(db);
  return identities.length === 1 ? (identities[0] ?? null) : null;
}
