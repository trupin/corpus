/**
 * The main thread's half of SERVER-049: a proxy that looks exactly like an
 * inference runtime and does none of the inference.
 *
 * The finding this exists for (SERVER-046, 2026-07-31): `onnxruntime-web`'s
 * WebAssembly backend runs its forward pass **synchronously**, and the `await`s
 * around it resolve as microtasks, which never yield to libuv's I/O phase. A
 * 660-chunk drain therefore held the event loop — and `GET /api/health`, and
 * every `PUT` — for 13,844 ms, while SPEC.md §9.1 promises that no save ever
 * waits on indexing. Nothing about batching, scheduling or `setImmediate`
 * repairs that; the work has to be on another thread.
 *
 * So it is. `createWorkerHost` spawns one Worker per loaded model, and the
 * seam above it never learns: `EmbeddedEngine.open()` still returns an
 * `EmbeddingProvider` whose `embed()` resolves with vectors, so SERVER-043's
 * resolution, SERVER-044's index worker, SERVER-045's retrieval and
 * SERVER-046's maintenance are unchanged.
 *
 * Three properties are worth stating because they are what a reviewer would
 * otherwise have to reconstruct:
 *
 * - **A batch is one message and one transfer.** The answer arrives as a single
 *   `Float32Array` whose buffer is transferred rather than cloned; the host cuts
 *   it into per-chunk views.
 * - **A dead worker is a provider outage, never a dead server.** `error` and
 *   `exit` both land on {@link InferenceHost} rejections plus one `onLost`
 *   notification, which is what lets the engine drop the loaded model so the
 *   next resolution builds a fresh worker — SERVER-044's backoff ladder then
 *   drives the recovery it already knows how to drive.
 * - **Shutdown is `terminate()`, and it reaps everything.** Measured with the
 *   real model mid-forward-pass: the process went from 11 threads to 7 in 7 ms,
 *   because `onnxruntime-web`'s wasm thread pool is made of *nested* workers
 *   owned by this one. There is no graceful-drain protocol because there is
 *   nothing left to drain.
 */

import { Worker } from "node:worker_threads";
import { EmbeddingError } from "../provider.js";
import {
  INFERENCE_WORKER_KIND,
  INFERENCE_WORKER_URL,
  type InferenceRequest,
  type InferenceResponse,
  type InferenceWorkerData,
} from "./inference-worker.js";
import { loadInferenceRuntime, unpackVectors, type InferenceSpec } from "./inference.js";
import type { SessionFactory } from "./runtime.js";

/**
 * What the engine holds instead of a model session. Deliberately the two
 * members a session boundary needs and nothing else — the in-process
 * implementation and the worker implementation are then interchangeable, which
 * is what keeps the tests honest about the shipped path.
 */
export interface InferenceHost {
  embed(texts: readonly string[]): Promise<readonly Float32Array[]>;
  close(): Promise<void>;
}

/** Where the Worker's code comes from. A `source` is `eval`'d — tests only. */
export type InferenceWorkerEntry = { readonly url: URL } | { readonly source: string };

export interface InferenceHostOptions {
  /** Aborted when the server shuts down mid-load; the worker is terminated. */
  readonly signal?: AbortSignal | undefined;
  /**
   * The worker died on its own — a crash, an OOM, an `exit`. Never called by
   * {@link InferenceHost.close}. The engine uses it to forget the loaded model.
   */
  readonly onLost?: ((detail: string) => void) | undefined;
  readonly entry?: InferenceWorkerEntry | undefined;
}

export type InferenceHostFactory = (
  spec: InferenceSpec,
  options: InferenceHostOptions,
) => Promise<InferenceHost>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection that nobody has attached to yet — the abort race below attaches
  // late — is not an unhandled rejection this process should die on.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/**
 * Spawns a worker, waits for it to report the model loaded, and returns the
 * proxy. Rejects — after terminating the thread — if the load fails, if the
 * worker dies, or if `signal` aborts first.
 */
export async function createWorkerHost(
  spec: InferenceSpec,
  options: InferenceHostOptions = {},
): Promise<InferenceHost> {
  const data: InferenceWorkerData = { kind: INFERENCE_WORKER_KIND, spec };
  const entry = options.entry ?? { url: new URL(INFERENCE_WORKER_URL) };
  const worker =
    "source" in entry
      ? new Worker(entry.source, { workerData: data, eval: true })
      : new Worker(entry.url, { workerData: data });

  const pending = new Map<number, Deferred<readonly Float32Array[]>>();
  const ready = deferred<void>();
  let nextId = 0;
  let lost: EmbeddingError | undefined;
  let closing = false;

  /** Every route out of "this worker can still answer" goes through here. */
  function lose(detail: string, report: boolean): void {
    const error = new EmbeddingError(detail);
    lost ??= error;
    // `ready` is settled one turn late, and deliberately so. A worker's death
    // reaches this thread over the *internal* port (`error`, `exit`) while its
    // `ready` reaches it over the public one, and two ports have no ordering
    // between them: measured on Node 25 with the main thread starved, 1.8% of
    // deaths arrived before the `ready` the same worker had already posted —
    // which rejected the load of a model that had, in fact, loaded, and made
    // "a dead worker is a provider outage, never a dead server" a coin flip.
    // A `setImmediate` runs in the check phase, after every port callback libuv
    // had already queued, so an in-flight `ready` wins (11/11 measured); a
    // microtask drains too early to help (0/11). Everything else about the
    // outage stays in this turn — `lost`, the pending rejections and `onLost` —
    // which is what keeps `exit`'s "already lost" guard honest, and rejecting
    // an already-settled `ready` is a no-op, so a worker that really did die
    // during the load still fails the load, one turn later.
    setImmediate(() => ready.reject(error));
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    if (report) options.onLost?.(detail);
  }

  worker.on("message", (message: InferenceResponse) => {
    if (message.kind === "ready") {
      ready.resolve();
      return;
    }
    if (message.kind === "failed") {
      // Not routed through `lose`, and deliberately a plain `Error`: a model
      // that failed to load is not a worker that died, and the engine's
      // `open()` wraps and reports exactly this shape — so a worker-hosted load
      // failure reads identically to an in-process one.
      lost ??= new EmbeddingError(message.message);
      ready.reject(new Error(message.message));
      for (const waiting of pending.values()) waiting.reject(lost);
      pending.clear();
      return;
    }
    const waiting = pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    if (message.kind === "error") waiting.reject(new EmbeddingError(message.message));
    else waiting.resolve(unpackVectors(message.data, message.dim));
  });

  worker.on("error", (error: Error) => {
    if (closing) return;
    lose(`the embedding worker failed: ${error.message}`, lost === undefined);
  });

  worker.on("exit", (code: number) => {
    if (closing || lost !== undefined) return;
    lose(`the embedding worker exited unexpectedly (code ${String(code)})`, true);
  });

  const terminate = async (): Promise<void> => {
    closing = true;
    await worker.terminate();
  };

  const abort = options.signal;
  if (abort !== undefined) {
    const raced = deferred<void>();
    const onAbort = (): void => {
      raced.reject(new EmbeddingError("model load aborted"));
    };
    abort.addEventListener("abort", onAbort, { once: true });
    if (abort.aborted) onAbort();
    try {
      await Promise.race([ready.promise, raced.promise]);
    } catch (error) {
      await terminate();
      throw error;
    } finally {
      abort.removeEventListener("abort", onAbort);
    }
  } else {
    try {
      await ready.promise;
    } catch (error) {
      await terminate();
      throw error;
    }
  }

  return {
    embed(texts) {
      if (texts.length === 0) return Promise.resolve([]);
      if (lost !== undefined) return Promise.reject(lost);
      const id = (nextId += 1);
      const answer = deferred<readonly Float32Array[]>();
      pending.set(id, answer);
      const request: InferenceRequest = { id, texts };
      worker.postMessage(request);
      return answer.promise;
    },
    async close() {
      if (!closing) lose("the embedding worker has been shut down", false);
      await terminate();
    },
  };
}

/**
 * The same runtime, on this thread.
 *
 * It is what a `sessionFactory` selects: a session factory is a *function*, and
 * a function cannot be cloned across a thread boundary, so an engine given one
 * is by construction asking for in-process inference. That is the engine's unit
 * tests (which must not spawn threads to check a retry cooldown) and the
 * reference-value integration test (which compares this build's arithmetic
 * against transformers.js and wants no transport in the way). Production passes
 * no factory and gets {@link createWorkerHost}.
 */
export function inProcessHostFactory(sessionFactory: SessionFactory): InferenceHostFactory {
  return async (spec, options) => {
    const runtime = await loadInferenceRuntime(spec, sessionFactory, options.signal);
    return {
      embed: (texts) => runtime.embed(texts),
      close: () => runtime.release(),
    };
  };
}
