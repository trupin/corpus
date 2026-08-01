/**
 * The other side of the thread boundary: the module a `worker_threads` Worker
 * runs, and the protocol it speaks.
 *
 * **Why this module is also the worker's entry point.** A Worker is spawned
 * with a URL, and the URL has to be loadable by whatever is running the server:
 * `node --import tsx …/main.ts` in a source checkout, and a single esbuild
 * bundle in an installed tool, where every first-party module — this one
 * included — has been inlined into one file. `import.meta.url` is the one
 * expression that names a loadable module in both worlds, so the worker's entry
 * *is* this module, and the guard at the bottom decides whether being loaded
 * means "somebody imported the host" or "we are the worker". In a bundle that
 * URL is the bundle itself, which is why `main.ts` starts a server only on the
 * main thread.
 *
 * The guard keys on `workerData`, not on `isMainThread`: Vitest runs test files
 * inside worker threads of its own, and a test that imports this module must
 * not find itself answering embed requests from the test runner.
 *
 * Everything below the protocol is in {@link startInferenceWorker}, which takes
 * its port and its loader as arguments — the worker body is then testable in
 * process, against a fake port, with the same stub session the rest of the
 * engine's tests use. Only the two-line dispatch is worker-only.
 */

import { isMainThread, parentPort, workerData } from "node:worker_threads";
import {
  loadInferenceRuntime,
  packVectors,
  type InferenceRuntime,
  type InferenceSpec,
} from "./inference.js";

/** The module URL a Worker is spawned with. See the file header. */
export const INFERENCE_WORKER_URL = import.meta.url;

/** Marks `workerData` as ours, so the dispatch never fires inside somebody else's worker. */
export const INFERENCE_WORKER_KIND = "corpus-inference-worker";

export interface InferenceWorkerData {
  readonly kind: typeof INFERENCE_WORKER_KIND;
  readonly spec: InferenceSpec;
}

export function isInferenceWorkerData(value: unknown): value is InferenceWorkerData {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === INFERENCE_WORKER_KIND
  );
}

/** Main thread → worker. One message per batch; `id` is what pairs up the answer. */
export interface InferenceRequest {
  readonly id: number;
  readonly texts: readonly string[];
}

/**
 * Worker → main thread.
 *
 * `vectors` carries the whole batch as one `Float32Array`, whose buffer is
 * *transferred*: 384 floats per chunk × a batch is a copy worth not making, and
 * a transfer costs a pointer move. `dim` is how the main thread cuts it back up.
 */
export type InferenceResponse =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly message: string }
  | {
      readonly kind: "vectors";
      readonly id: number;
      readonly data: Float32Array;
      readonly dim: number;
    }
  | { readonly kind: "error"; readonly id: number; readonly message: string };

/** The part of `MessagePort` this module uses — the seam a test's fake port fills. */
export interface InferencePort {
  postMessage(value: InferenceResponse, transferList?: readonly ArrayBuffer[]): void;
  on(event: "message", listener: (value: InferenceRequest) => void): void;
}

export type InferenceLoader = (spec: InferenceSpec) => Promise<InferenceRuntime>;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Loads the model and then answers embed requests until the thread is
 * terminated.
 *
 * **Requests are serialised.** Nothing here is thread-safe by construction —
 * one session, one wasm heap — and a batch and a query embedding arriving
 * together would otherwise interleave two forward passes on it. Chaining also
 * bounds peak memory to one batch's tensors, which is the whole reason
 * `EMBED_BATCH_ROWS` is 8.
 *
 * A load failure is reported once, as `failed`, and then answers every request
 * with the same message: the host terminates the worker on `failed`, but a
 * request already in flight when it did must still settle rather than hang.
 */
export function startInferenceWorker(
  port: InferencePort,
  data: InferenceWorkerData,
  load: InferenceLoader = (spec) => loadInferenceRuntime(spec),
): void {
  const ready = load(data.spec);
  ready.then(
    () => {
      port.postMessage({ kind: "ready" });
    },
    (error: unknown) => {
      port.postMessage({ kind: "failed", message: messageOf(error) });
    },
  );

  let queue: Promise<void> = ready.then(
    () => undefined,
    () => undefined,
  );

  port.on("message", (request) => {
    queue = queue.then(async () => {
      try {
        const runtime = await ready;
        const { data: packed, dim } = packVectors(await runtime.embed(request.texts));
        port.postMessage({ kind: "vectors", id: request.id, data: packed, dim }, [packed.buffer]);
      } catch (error) {
        port.postMessage({ kind: "error", id: request.id, message: messageOf(error) });
      }
    });
  });
}

// The dispatch. Loading this module inside our own worker is what starts it;
// loading it anywhere else — the host importing `INFERENCE_WORKER_URL`, a test
// importing `startInferenceWorker`, Vitest's own worker threads — does nothing.
if (!isMainThread && parentPort !== null && isInferenceWorkerData(workerData)) {
  startInferenceWorker(parentPort, workerData);
}
