/**
 * Loading the pinned model and turning text into vectors — the half of the
 * embedded engine that costs CPU, extracted from `engine.ts` so it can run
 * unchanged on either side of a thread boundary.
 *
 * SERVER-049 moved it into a `worker_threads` Worker, and the reason it is one
 * module rather than two is the failure that motivated the move: wasm inference
 * is *synchronous*, its `await`s resolve as microtasks that never reach the I/O
 * phase, and a 660-chunk drain therefore held `GET /api/health` for 13,844 ms.
 * A second, thread-local implementation of tokenize → forward pass → pool would
 * be a second place for that to be true. So the worker calls exactly this
 * function, and so does the in-process host the tests and the reference-value
 * integration test use; the only difference between them is how the answer
 * travels back.
 *
 * Nothing here knows about workers, providers, or downloads. It is handed a
 * directory that is supposed to hold verified artifacts and gives back
 * something that embeds — which is what makes it the same code in both hosts.
 */

import { readVerifiedArtifact } from "./download.js";
import type { EmbeddedModelManifest } from "./manifest.js";
import {
  createOnnxSession,
  meanPoolNormalize,
  type ModelSession,
  type SessionFactory,
} from "./runtime.js";
import { createTokenizer, type Tokenizer } from "./tokenizer.js";

/**
 * Rows per forward pass. Throughput was flat across 1, 8 and 16 in the
 * benchmark, so this is chosen for bounded peak memory
 * (`rows × 256 × 384 × 4` bytes) rather than for speed.
 */
export const EMBED_BATCH_ROWS = 8;

/**
 * Everything the runtime needs to exist, and nothing that cannot cross a
 * `postMessage`: the worker receives this verbatim as `workerData`, so every
 * field has to be structured-cloneable. A `SessionFactory` is the reason the
 * factory is a separate argument rather than a field — a function cannot be
 * cloned, and the production worker has no use for one.
 */
export interface InferenceSpec {
  readonly cacheDir: string;
  readonly manifest: EmbeddedModelManifest;
  readonly threads: number;
}

export interface InferenceRuntime {
  /** One vector per input, in order. Rejects if the forward pass does. */
  embed(texts: readonly string[]): Promise<Float32Array[]>;
  release(): Promise<void>;
}

/**
 * Reads the two pinned artifacts, builds the tokenizer and the session, and
 * returns something that embeds.
 *
 * The artifacts are read through {@link readVerifiedArtifact}, so the bytes
 * handed to the runtime are the bytes whose sha256 was just checked — the rule
 * `engine.ts` states and this function is where it is kept.
 *
 * `signal` is checked at the two points where there is work worth abandoning:
 * after the reads and after the session is open. A session that came into
 * existence during shutdown is released here rather than leaked to a caller
 * that is about to throw.
 */
export async function loadInferenceRuntime(
  spec: InferenceSpec,
  sessionFactory: SessionFactory = createOnnxSession,
  signal?: AbortSignal,
): Promise<InferenceRuntime> {
  const { cacheDir, manifest, threads } = spec;
  // A call, not a comparison: `signal.aborted` flips during the `await`s below,
  // which narrowing the first read would rule out.
  const aborted = (): boolean => signal?.aborted === true;

  const tokenizerBytes = await readVerifiedArtifact(cacheDir, manifest.tokenizer);
  const weights = await readVerifiedArtifact(cacheDir, manifest.weights);
  if (aborted()) throw new Error("model load aborted");

  const tokenizer: Tokenizer = createTokenizer(new TextDecoder().decode(tokenizerBytes));
  const session: ModelSession = await sessionFactory(weights, threads);
  if (aborted()) {
    await session.release();
    throw new Error("model load aborted");
  }

  return {
    async embed(texts) {
      const vectors: Float32Array[] = [];
      for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_ROWS) {
        const slice = texts.slice(offset, offset + EMBED_BATCH_ROWS);
        const encoded = slice.map((text) => tokenizer.encode(text, manifest.maxTokens));
        const cols = Math.max(1, ...encoded.map((row) => row.length));
        const ids = new BigInt64Array(slice.length * cols);
        const mask = new BigInt64Array(slice.length * cols);
        encoded.forEach((row, index) => {
          row.forEach((id, column) => {
            ids[index * cols + column] = BigInt(id);
            mask[index * cols + column] = 1n;
          });
        });
        const output = await session.run({ ids, mask, rows: slice.length, cols });
        for (const vector of meanPoolNormalize(
          output,
          encoded.map((row) => row.length),
          cols,
        )) {
          vectors.push(vector);
        }
      }
      return vectors;
    },
    release: () => session.release(),
  };
}

/**
 * Packs a batch's vectors into one contiguous `Float32Array`.
 *
 * The worker sends this single buffer and transfers it, so a batch of eight
 * 384-dimensional vectors crosses the thread boundary as one zero-copy move
 * instead of eight structured clones. A ragged batch is a bug in the model
 * wrapper rather than something to paper over, so it is rejected here where the
 * shape is still visible.
 */
export function packVectors(vectors: readonly Float32Array[]): {
  /** Owned outright by the caller, which is what makes it safe to transfer. */
  readonly data: Float32Array<ArrayBuffer>;
  readonly dim: number;
} {
  const dim = vectors[0]?.length ?? 0;
  if (vectors.some((vector) => vector.length !== dim)) {
    throw new Error("the embedding model returned vectors of differing dimensions");
  }
  const data = new Float32Array(vectors.length * dim);
  vectors.forEach((vector, index) => data.set(vector, index * dim));
  return { data, dim };
}

/** The inverse of {@link packVectors}; the views share the transferred buffer. */
export function unpackVectors(data: Float32Array, dim: number): Float32Array[] {
  if (dim <= 0) return [];
  const vectors: Float32Array[] = [];
  for (let offset = 0; offset + dim <= data.length; offset += dim) {
    vectors.push(data.subarray(offset, offset + dim));
  }
  return vectors;
}
