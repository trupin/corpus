/**
 * The one place this package touches an inference runtime, and the pooling that
 * turns its output into a sentence vector.
 *
 * **Why `onnxruntime-web` and not `onnxruntime-node`.** Measured on this
 * machine, into an empty scratch package:
 *
 * | option | `node_modules` | install hooks | native code |
 * | --- | --- | --- | --- |
 * | `@huggingface/transformers@4.2.0` | 393 MiB | yes (transitively) | yes (+ `sharp`) |
 * | `onnxruntime-node@1.27.0` | ~258 MiB | `postinstall: node ./script/install` | prebuilt `.node` |
 * | **`onnxruntime-web@1.27.0`** | **137 MiB** | **none** | **none — WebAssembly** |
 *
 * Size was the budget the issue set, and 137 MiB beats the 258 MiB ceiling; but
 * the install hook is what decides it. `onnxruntime-node`'s `postinstall`
 * fetches execution-provider binaries at install time, which is precisely the
 * shape of thing the 2026-07-31 ruling refuses. `onnxruntime-web` ships `.wasm`
 * data files inside the npm tarball, runs them in the V8 sandbox, and executes
 * nothing that was not already in the lockfile.
 *
 * The price is throughput, and it was measured rather than assumed: 100 chunks
 * of 2,000 characters (256 wordpieces each, the truncation limit, i.e. the
 * worst case) took **45.6 ms per chunk** on four wasm threads against 9.8 ms on
 * the native runtime. The issue's bar is "tens of ms per chunk is acceptable"
 * for background indexing, and 4.6× of a background cost that never blocks a
 * write is a good trade for not shipping a native postinstall.
 *
 * Threads are capped at half the machine's parallelism, and at four: indexing
 * is background work behind a server that must stay responsive, and the same
 * benchmark at eight threads on this eight-thread machine *regressed* to
 * 78 ms/chunk through oversubscription.
 */

import { availableParallelism } from "node:os";

/** One forward pass' worth of input: right-padded rows of token ids. */
export interface SessionInput {
  readonly ids: BigInt64Array;
  readonly mask: BigInt64Array;
  readonly rows: number;
  readonly cols: number;
}

export interface SessionOutput {
  /** `rows × cols × dim`, row-major — the model's last hidden state. */
  readonly hidden: Float32Array;
  readonly dim: number;
}

export interface ModelSession {
  run(input: SessionInput): Promise<SessionOutput>;
  release(): Promise<void>;
}

/** Injected so the engine is testable without loading 22 MiB of weights. */
export type SessionFactory = (weights: Uint8Array, threads: number) => Promise<ModelSession>;

/** Never more than four, never more than half the machine — see the file header. */
export function embeddingThreadCount(parallelism: number): number {
  return Math.max(1, Math.min(4, Math.floor(parallelism / 2)));
}

export const defaultThreadCount = (): number => embeddingThreadCount(availableParallelism());

/**
 * Whether this Node can run WebAssembly at all. False under `--jitless` and on
 * hardened runtimes that disable wasm — a real deployment shape in exactly the
 * environments this issue's ruling is about, and the honest answer there is
 * `unsupported-platform`, not a crash on first index.
 */
export const wasmAvailable = (): boolean => "WebAssembly" in globalThis;

/**
 * Loads the model **from bytes already verified against the manifest's hash**.
 * Taking a buffer rather than a path is deliberate: it closes the window in
 * which a file could change between the check and the parse, so what the
 * runtime sees is exactly what was hashed.
 */
export const createOnnxSession: SessionFactory = async (weights, threads) => {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = threads;
  // The runtime otherwise narrates every unimplemented graph optimisation to
  // stderr, which is not a server operator's business.
  ort.env.logLevel = "error";

  const session = await ort.InferenceSession.create(weights, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });

  return {
    async run({ ids, mask, rows, cols }) {
      const dims = [rows, cols];
      const output = await session.run({
        input_ids: new ort.Tensor("int64", ids, dims),
        attention_mask: new ort.Tensor("int64", mask, dims),
        // A single segment: this model is used for sentence embeddings, never
        // for sentence-pair classification.
        token_type_ids: new ort.Tensor("int64", new BigInt64Array(rows * cols), dims),
      });
      const hidden = output["last_hidden_state"];
      if (hidden === undefined || !(hidden.data instanceof Float32Array)) {
        throw new Error("the embedding model returned no float last_hidden_state");
      }
      const dim = hidden.dims[2];
      if (dim === undefined) {
        throw new Error("the embedding model returned a last_hidden_state without a hidden size");
      }
      return { hidden: hidden.data, dim };
    },
    release: () => session.release(),
  };
};

/**
 * Mean pooling over the real tokens of each row, then L2 normalisation — the
 * pooling `sentence-transformers/all-MiniLM-L6-v2` was trained with, and the
 * only one whose cosine similarities mean what the model card says they mean.
 *
 * Normalising here rather than at query time is what lets SERVER-045's scan
 * treat a dot product as a cosine (sprint-021 C7).
 */
export function meanPoolNormalize(
  output: SessionOutput,
  lengths: readonly number[],
  cols: number,
): Float32Array[] {
  const { hidden, dim } = output;
  const vectors: Float32Array[] = [];

  for (let row = 0; row < lengths.length; row++) {
    const length = lengths[row] ?? 0;
    const vector = new Float32Array(dim);
    for (let token = 0; token < length; token++) {
      const base = (row * cols + token) * dim;
      for (let k = 0; k < dim; k++) vector[k] = (vector[k] ?? 0) + (hidden[base + k] ?? 0);
    }
    let sumSquares = 0;
    for (let k = 0; k < dim; k++) {
      const mean = (vector[k] ?? 0) / Math.max(1, length);
      vector[k] = mean;
      sumSquares += mean * mean;
    }
    // A row of all-zero hidden states would otherwise divide by zero; the
    // provider seam rejects non-finite components, so this must not produce any.
    const norm = Math.sqrt(sumSquares) || 1;
    for (let k = 0; k < dim; k++) vector[k] = (vector[k] ?? 0) / norm;
    vectors.push(vector);
  }
  return vectors;
}
