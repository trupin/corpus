// Hand-set vectors for retrieval's semantic half.
//
// The point of hand-setting them is that a *ranking* test must not also be a
// test of a model's opinion: an embedding provider is a black box whose answers
// change with its weights, so a fixture that asked a real one to decide which
// document is nearer would be re-asserting the model every run. Here the
// distances are chosen, the fusion arithmetic is therefore predictable, and the
// real provider gets exercised where it belongs — the E2E leg, against a real
// engine.
//
// Everything below writes through the shipped writers (`writeEmbedding`) and
// reads the shipped rows (`chunks`), so a fixture cannot drift into describing a
// projection the projector does not produce.

import type { ProjectionDb } from "../projection/db.js";
import { writeEmbedding } from "./embeddings.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./provider.js";
import type { ProviderResolution } from "./resolve.js";

/** One projected chunk, as the fixture's callbacks see it. */
export interface FixtureChunk {
  readonly chunkId: string;
  readonly docId: string;
  readonly ref: string;
  readonly ord: number;
  readonly headingPath: string;
}

export function listChunkRows(db: ProjectionDb): FixtureChunk[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT chunk_id, doc_id, ref, ord, heading_path
         FROM chunks ORDER BY doc_id, ref, ord`,
    )
    .all() as {
    chunk_id: string;
    doc_id: string;
    ref: string;
    ord: number;
    heading_path: string;
  }[];
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    docId: row.doc_id,
    ref: row.ref,
    ord: row.ord,
    headingPath: row.heading_path,
  }));
}

/**
 * Records a vector for every chunk the callback answers for, and leaves the rest
 * pending — which is how a fixture produces the `stale` state honestly, rather
 * than by writing a counter somebody has to remember to update.
 */
export function embedChunks(
  db: ProjectionDb,
  identity: string,
  vectorFor: (chunk: FixtureChunk) => readonly number[] | null,
  updatedMs = 1,
): number {
  let written = 0;
  for (const chunk of listChunkRows(db)) {
    const values = vectorFor(chunk);
    if (values === null) continue;
    writeEmbedding(db, {
      state: "ready",
      chunkId: chunk.chunkId,
      identity,
      vector: Float32Array.from(values),
      updatedMs,
    });
    written += 1;
  }
  return written;
}

/** Every chunk of each named document gets that document's vector. */
export function embedDocuments(
  db: ProjectionDb,
  identity: string,
  byDoc: Readonly<Record<string, readonly number[]>>,
): number {
  return embedChunks(db, identity, (chunk) => byDoc[chunk.docId] ?? null);
}

export interface StubProviderOptions {
  readonly model?: string;
  /** The vector for a query string; a thrown error is the provider failing. */
  readonly embed: (text: string) => readonly number[];
  /** Counted so a test can prove resolution is cached rather than per request. */
  readonly onEmbed?: (text: string) => void;
}

export function stubProvider(options: StubProviderOptions): EmbeddingProvider {
  return createEmbeddingProvider({ provider: "stub", model: options.model ?? "fixture" }, (texts) =>
    Promise.resolve(
      texts.map((text) => {
        options.onEmbed?.(text);
        return [...options.embed(text)];
      }),
    ),
  );
}

/**
 * A resolution a test hands to `createSemanticRetrieval`'s `resolve` seam.
 *
 * `identity` is stated rather than probed: the real resolution learns the
 * dimension from a probe response, and a fixture that re-derived it would be
 * testing `createEmbeddingProvider` a second time.
 */
export function stubResolution(identity: string, options: StubProviderOptions): ProviderResolution {
  return {
    kind: "provider",
    source: "config",
    provider: stubProvider(options),
    identity,
    sticky: false,
  };
}
