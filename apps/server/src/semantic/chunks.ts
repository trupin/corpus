/**
 * The chunk half of the projection: turning a document's parsed body — and, for
 * a thread, each of its turns — into `chunks` and `chunk_search` rows, and
 * answering which chunks the semantic index has not covered yet.
 *
 * Written from inside `projectDocument`'s transaction, so a chunk row and the
 * `search` row it addresses can never describe different bytes. Nothing here
 * touches `chunk_embeddings`: an embedding is keyed by content-addressed chunk
 * id, so an edit that leaves a section's bytes alone leaves its embedding
 * attached without anybody deciding to preserve it (SPEC.md §9.1).
 */

import { TURN_SEPARATOR } from "../core/turns.js";
import { toIndexableText } from "../docs/fts.js";
import type { ProjectionDb } from "../projection/db.js";
import { chunkBody, type Chunk } from "./chunker.js";

/** The `search.ref` shape a turn's rows carry: `<threadId>#<ts>`. */
export const turnRef = (docId: string, ts: string): string => `${docId}#${ts}`;

/**
 * A turn's own heading, `<author> · <ts>` — the H2 §6 pins, rendered exactly as
 * `search.ts` renders it for a turn hit's address. Every chunk cut from a turn
 * hangs under it.
 */
export const turnHeadingFor = (author: string, ts: string): string =>
  `${author} ${TURN_SEPARATOR} ${ts}`;

/** One indexable passage: the unit both `search` and `chunks` are keyed by. */
export interface ChunkablePassage {
  readonly ref: string;
  readonly kind: "doc" | "turn";
  readonly body: string;
  /** Prepended to every chunk's heading path; a turn's `author · ts`. */
  readonly rootHeading?: string;
}

/** Removes every chunk row derived from a document. */
export function deleteDocumentChunks(db: ProjectionDb, docId: string): void {
  db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(docId);
  db.prepare("DELETE FROM chunk_search WHERE doc_id = ?").run(docId);
}

/**
 * Writes the chunk rows for one document's passages, replacing whatever was
 * there. Returns the chunks it wrote, in order, so a caller can report or
 * assert on them without reading them back.
 */
export function insertChunkRows(
  db: ProjectionDb,
  docId: string,
  title: string,
  passages: readonly ChunkablePassage[],
): Chunk[] {
  // `OR IGNORE` for the same reason the `turns` insert has it: two turns of one
  // thread can share a timestamp in a hand-edited file (§14 reports it, the
  // projection survives it), and a timestamp is a turn's identity — so both
  // turns produce the same `ref`. First one wins, in both tables, exactly as it
  // does in `turns`.
  const insertChunk = db.prepare(
    `INSERT OR IGNORE INTO chunks
       (ref, ord, chunk_id, doc_id, kind, heading_path, start_offset, end_offset, char_length)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSearch = db.prepare(
    `INSERT INTO chunk_search (chunk_id, ref, doc_id, ord, heading_path, body)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const written: Chunk[] = [];
  for (const passage of passages) {
    const chunks = chunkBody(passage.body, {
      docId,
      title,
      ...(passage.rootHeading === undefined ? {} : { rootHeading: passage.rootHeading }),
    });
    for (const chunk of chunks) {
      const inserted = insertChunk.run(
        passage.ref,
        chunk.ord,
        chunk.id,
        docId,
        passage.kind,
        chunk.headingPath,
        chunk.start,
        chunk.end,
        chunk.text.length,
      );
      // `chunk_search` has no key to ignore against, so it follows the decision
      // `chunks` just made rather than making its own.
      if (inserted.changes === 0) continue;
      insertSearch.run(
        chunk.id,
        passage.ref,
        docId,
        chunk.ord,
        chunk.headingPath,
        toIndexableText(chunk.text),
      );
      written.push(chunk);
    }
  }
  return written;
}

/**
 * Chunks the semantic index has no embedding for — §9.1's "pending", derived
 * rather than recorded.
 *
 * `DISTINCT` because two positions can share a content-addressed id: they are
 * one unit of work, not two. Nothing here writes, which is the point — the
 * pending set is a fact about the corpus that a projector cannot get wrong by
 * forgetting to mark a row.
 */
export function pendingChunkIds(db: ProjectionDb): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT c.chunk_id AS chunk_id
         FROM chunks c LEFT JOIN chunk_embeddings e ON e.chunk_id = c.chunk_id
        WHERE e.chunk_id IS NULL
        ORDER BY c.chunk_id`,
    )
    .all() as { chunk_id: string }[];
  return rows.map((row) => row.chunk_id);
}

/** How many distinct chunks await an embedding. */
export function countPendingChunks(db: ProjectionDb): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT c.chunk_id) AS pending
         FROM chunks c LEFT JOIN chunk_embeddings e ON e.chunk_id = c.chunk_id
        WHERE e.chunk_id IS NULL`,
    )
    .get() as { pending: number };
  return row.pending;
}

/**
 * Embeddings whose chunk no longer exists anywhere in the corpus.
 *
 * They are not deleted here: `chunk_embeddings` is deliberately outside the
 * document projector's reach (sprint-021 C2), and an orphan is cheap to hold
 * and valuable to keep — a section restored from an undo, or a paragraph moved
 * between documents, re-attaches to it for free. Collection is the index
 * maintenance surface's business.
 */
export function orphanedEmbeddingIds(db: ProjectionDb): string[] {
  const rows = db
    .prepare(
      `SELECT e.chunk_id AS chunk_id
         FROM chunk_embeddings e LEFT JOIN chunks c ON c.chunk_id = e.chunk_id
        WHERE c.chunk_id IS NULL
        ORDER BY e.chunk_id`,
    )
    .all() as { chunk_id: string }[];
  return rows.map((row) => row.chunk_id);
}
