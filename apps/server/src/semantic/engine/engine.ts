/**
 * The embedded engine: SERVER-043's `EmbeddedEngine`, implemented over a
 * hash-pinned model in a per-user cache and a WebAssembly runtime this process
 * hosts — on a worker thread, since SERVER-049.
 *
 * What is left here is policy: what may be downloaded and when, what may be
 * loaded, what the seam is told. The model itself lives behind an
 * {@link InferenceHost} (`worker-host.ts`), and the arithmetic behind
 * `inference.ts`; this file no longer touches a tensor. That split is
 * SERVER-049's: wasm inference is synchronous and blocked the event loop for
 * 13.8 s on a 660-chunk drain, and the fix is a thread boundary that the seam
 * above cannot see.
 *
 * Three rules from the 2026-07-31 ruling shape every branch below.
 *
 * **Nothing downloads by itself.** `availability()` only looks: it stats the
 * cache and reports. `open()` only loads what is already there. The download
 * happens when — and only when — someone calls `requestModel()`, which is the
 * index worker's move to make (SERVER-044), because "lazily on first index
 * need" and "none at server boot" are the same sentence read from both ends. A
 * server that boots, resolves `disabled`, and is never asked to index anything
 * makes no network request in its lifetime.
 *
 * **A failed download waits.** `requestModel()` is single-flight, and after a
 * failure it refuses to try again until `retryCooldownMs` has passed. The
 * worker ticks on a timer; without the cooldown, an unreachable host would turn
 * into a request loop, which is the one shape "retries on later attempts, never
 * a hot loop" forbids.
 *
 * **Nothing unverified is ever parsed.** The bytes handed to the runtime are
 * the bytes whose sha256 was just checked against the manifest, in memory, with
 * no re-read in between (`readVerifiedArtifact`). A mismatch deletes the file
 * and reports it; there is no code path from a damaged cache to a loaded model.
 *
 * Progress lives in `availability().detail` because the seam's reason vocabulary
 * is closed and deliberately narrow: "the model has not been downloaded yet" is
 * still the honest reason while it is at 40%, and the sentence a person reads in
 * `corpus index status` is the detail beside it. Since the 2026-08-01 rider that
 * sentence actually reaches them — `IndexStatus.detail` is the wire field, and
 * `retrieval.ts` re-reads `availability()` while it is waiting on this model, so
 * the percentage a person sees is the current one rather than the one cached
 * when they first asked.
 */

import { mkdir } from "node:fs/promises";
import { EMBEDDED_PROVIDER } from "../embedded-engine.js";
import type {
  EmbeddedEngine,
  EmbeddedEngineAvailability,
  EmbeddedEngineOpenOptions,
} from "../embedded-engine.js";
import type { FetchLike } from "../http-provider.js";
import type { EmbeddingModelRef } from "../identity.js";
import { createEmbeddingProvider, EmbeddingError, type EmbeddingProvider } from "../provider.js";
import { MODEL_CACHE_DIR_ENV, modelCacheDir, modelCacheRoot, type CacheLocation } from "./cache.js";
import { downloadArtifact, inspectArtifact, type CachedArtifactState } from "./download.js";
import type { InferenceSpec } from "./inference.js";
import {
  EMBEDDED_MODEL,
  manifestBytes,
  modelArtifacts,
  type EmbeddedModelManifest,
} from "./manifest.js";
import { defaultThreadCount, wasmAvailable, type SessionFactory } from "./runtime.js";
import {
  createWorkerHost,
  inProcessHostFactory,
  type InferenceHost,
  type InferenceHostFactory,
} from "./worker-host.js";

export { EMBED_BATCH_ROWS } from "./inference.js";

/** Long enough that a flapping network cannot become a request loop, short enough to self-heal. */
export const MODEL_RETRY_COOLDOWN_MS = 5 * 60_000;

export interface EngineReport {
  readonly level: "info" | "error";
  readonly message: string;
}

export interface EmbeddedEngineOptions {
  readonly manifest?: EmbeddedModelManifest | undefined;
  /** Where the cache lives; a `cacheDir` overrides it outright (tests, E2E). */
  readonly location?: CacheLocation | undefined;
  readonly cacheDir?: string | undefined;
  readonly fetchFn?: FetchLike | undefined;
  /**
   * Runs inference **on this thread**, with this factory. A function cannot
   * cross a `postMessage`, so supplying one is by construction a request for
   * in-process inference; production supplies none and gets a worker thread
   * (SERVER-049). See `inProcessHostFactory`.
   */
  readonly sessionFactory?: SessionFactory | undefined;
  /** Overrides both of the above outright — the seam `worker-host.test.ts` reaches through. */
  readonly hostFactory?: InferenceHostFactory | undefined;
  readonly threads?: number | undefined;
  readonly wasmSupported?: boolean | undefined;
  readonly retryCooldownMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  /** One line for the server log: the download's start, finish, and failures. */
  readonly report?: ((report: EngineReport) => void) | undefined;
}

/**
 * The engine as the server holds it: SERVER-043's interface, plus the lazy
 * trigger and the disposer that interface has no room for.
 */
export interface CorpusEmbeddedEngine extends EmbeddedEngine {
  /** Idempotent, single-flight, cooldown-guarded. Returns immediately; never throws. */
  requestModel(): void;
  /**
   * Registers a listener for the one moment `availability()` flips from absent
   * to present: a download this engine performed has just completed.
   *
   * It exists because everything downstream caches the *old* answer. Resolution
   * is cooled down for 30 s after reporting `disabled` (`retrieval.ts`), which
   * is right for an endpoint that is down and wrong for a wait that just ended —
   * so a first run reported `disabled` for the whole download and then for
   * another half minute after it finished (the SERVER-048 evaluation, LEDGER-1).
   * A push from the side that *knows* beats shortening the cooldown for
   * everyone, which is `wake()`'s reasoning in SERVER-046.
   *
   * Listeners are called once per completed download, synchronously, and a
   * throwing listener is contained: it must not turn a successful download into
   * a failed one.
   */
  onModelReady(listener: () => void): void;
  /**
   * Settles when no download attempt is in flight, and never rejects.
   *
   * Deliberately separate from `requestModel`, which returns nothing: a worker
   * that ticks on a timer must not be able to `await` a 22 MiB download by
   * accident. Shutdown and tests are the callers that legitimately wait.
   */
  whenSettled(): Promise<void>;
  close(): Promise<void>;
}

type DownloadState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly artifact: string; readonly received: number }
  | { readonly kind: "failed"; readonly detail: string; readonly at: number };

const mib = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MiB`;

/** What `availability()` says when the environment names nowhere to cache a model. */
const NO_CACHE_LOCATION_DETAIL =
  "no per-user cache directory could be derived from the environment " +
  `(HOME, XDG_CACHE_HOME or LOCALAPPDATA); set ${MODEL_CACHE_DIR_ENV} to choose one`;

export function createEmbeddedEngine(options: EmbeddedEngineOptions = {}): CorpusEmbeddedEngine {
  const manifest = options.manifest ?? EMBEDDED_MODEL;
  const ref: EmbeddingModelRef = { provider: EMBEDDED_PROVIDER, model: manifest.model };
  const artifacts = modelArtifacts(manifest);
  const total = manifestBytes(manifest);

  /**
   * The cache directory, or the sentence explaining why there is none — one
   * decision, made once, so `availability()` can report a refused
   * `CORPUS_MODEL_CACHE_DIR` in the operator's own words rather than as the
   * generic "no cache could be derived".
   */
  const cache = ((): { readonly dir: string } | { readonly detail: string } => {
    if (options.cacheDir !== undefined) return { dir: options.cacheDir };
    if (options.location === undefined) return { detail: NO_CACHE_LOCATION_DETAIL };
    const located = modelCacheRoot(options.location);
    if (located.kind === "root") return { dir: modelCacheDir(located.path, manifest) };
    if (located.kind === "unusable") return { detail: located.detail };
    return { detail: NO_CACHE_LOCATION_DETAIL };
  })();
  const dir = "dir" in cache ? cache.dir : undefined;

  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  const hostFactory: InferenceHostFactory =
    options.hostFactory ??
    (options.sessionFactory === undefined
      ? createWorkerHost
      : inProcessHostFactory(options.sessionFactory));
  const supported = options.wasmSupported ?? wasmAvailable();
  const cooldownMs = options.retryCooldownMs ?? MODEL_RETRY_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  const report = options.report ?? (() => undefined);

  const controller = new AbortController();
  const readyListeners: (() => void)[] = [];
  let state: DownloadState = { kind: "idle" };
  let inFlight: Promise<void> | undefined;
  let loading: Promise<EmbeddingProvider> | undefined;
  let host: InferenceHost | undefined;
  let closed = false;

  async function missingArtifacts(
    cacheDir: string,
  ): Promise<{ name: string; state: CachedArtifactState }[]> {
    const missing: { name: string; state: CachedArtifactState }[] = [];
    for (const artifact of artifacts) {
      const cached = await inspectArtifact(cacheDir, artifact);
      if (cached !== "present") missing.push({ name: artifact.name, state: cached });
    }
    return missing;
  }

  function describeMissing(
    missing: readonly { name: string; state: CachedArtifactState }[],
  ): string {
    if (state.kind === "running") {
      const percent = Math.min(99, Math.floor((state.received / total) * 100));
      return (
        `downloading the ${manifest.model} embedding model (${mib(state.received)} of ` +
        `${mib(total)}, ${String(percent)}%) — semantic ranking starts once it is cached`
      );
    }
    if (state.kind === "failed") {
      return `the ${manifest.model} embedding model could not be downloaded: ${state.detail}`;
    }
    const damaged = missing.some((entry) => entry.state === "damaged");
    return damaged
      ? `the cached ${manifest.model} embedding model is damaged and will be downloaded again ` +
          `on the next index run; search is lexical until then`
      : `the ${manifest.model} embedding model (${mib(total)}) has not been downloaded yet; ` +
          `it downloads on the first index run and search is lexical until then`;
  }

  async function availability(): Promise<EmbeddedEngineAvailability> {
    if (closed) {
      return {
        available: false,
        reason: "engine-not-installed",
        detail: "the embedded engine has been shut down",
      };
    }
    if (!supported) {
      return {
        available: false,
        reason: "unsupported-platform",
        detail:
          "this runtime cannot execute WebAssembly, which the in-process embedding engine needs",
      };
    }
    if (!("dir" in cache)) {
      return { available: false, reason: "unsupported-platform", detail: cache.detail };
    }
    const missing = await missingArtifacts(cache.dir);
    if (missing.length === 0) return { available: true };
    return { available: false, reason: "model-not-downloaded", detail: describeMissing(missing) };
  }

  async function download(cacheDir: string): Promise<void> {
    await mkdir(cacheDir, { recursive: true });
    report({
      level: "info",
      message:
        `downloading the ${manifest.model} embedding model (${mib(total)}) into ${cacheDir} — ` +
        "this happens once per machine",
    });

    let done = 0;
    for (const artifact of artifacts) {
      if ((await inspectArtifact(cacheDir, artifact)) === "present") {
        done += artifact.bytes;
        continue;
      }
      const base = done;
      await downloadArtifact({
        artifact,
        dir: cacheDir,
        fetchFn,
        signal: controller.signal,
        onProgress: (progress) => {
          state = { kind: "running", artifact: artifact.name, received: base + progress.received };
        },
      });
      done += artifact.bytes;
      state = { kind: "running", artifact: artifact.name, received: done };
    }

    state = { kind: "idle" };
    report({
      level: "info",
      message: `the ${manifest.model} embedding model is cached in ${cacheDir}; semantic indexing can start`,
    });
  }

  /**
   * Tells whoever cached "the model is not here" that it now is.
   *
   * Each listener is isolated: one that throws must not reach the `catch` below,
   * where it would be recorded as a download failure and start a retry cooldown
   * over a download that succeeded.
   */
  function announceReady(): void {
    for (const listener of readyListeners) {
      try {
        listener();
      } catch (error) {
        report({
          level: "error",
          message: `a model-ready listener threw: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  function requestModel(): void {
    const cacheDir = dir;
    if (closed || !supported || cacheDir === undefined || inFlight !== undefined) return;
    if (state.kind === "failed" && now() - state.at < cooldownMs) return;

    const attempt = (async () => {
      const missing = await missingArtifacts(cacheDir);
      // Nothing was missing, so nothing flipped: the listeners are for the
      // transition, and firing on a cache that was already warm would invalidate
      // a resolution that is already correct.
      if (missing.length === 0) return;
      await download(cacheDir);
      announceReady();
    })()
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        state = { kind: "failed", detail, at: now() };
        report({
          level: "error",
          message: `the ${manifest.model} embedding model could not be downloaded: ${detail}`,
        });
      })
      .finally(() => {
        inFlight = undefined;
      });

    inFlight = attempt;
    // Deliberately not awaited: `requestModel` is a nudge from a caller that
    // must not block on 22 MiB. Every rejection is handled above, so nothing
    // can float away unhandled; `close()` awaits whatever is still running.
    void attempt;
  }

  /**
   * Forgets a host that died on its own, so the next `open()` builds a fresh
   * one.
   *
   * This is all of SERVER-049's crash story on this side. The provider the dead
   * host backs rejects every later `embed()`, which SERVER-044's worker already
   * reads as an outage: it drops the provider, backs off, and re-resolves — and
   * re-resolution calls `open()`, which now finds nothing memoised and starts a
   * fresh thread. The server itself never learns that anything died, because
   * from up there nothing did.
   */
  function forgetHost(dead: InferenceHost, detail: string): void {
    if (closed || host !== dead) return;
    host = undefined;
    loading = undefined;
    // Nothing will hold it after this, and `close()` only reaches the *current*
    // host. For the worker host this is a `terminate()` on a thread that has
    // already exited, which costs nothing and cannot fail; it is here so that a
    // host which reports itself lost without dying is still released.
    void dead.close().catch(() => undefined);
    report({
      level: "error",
      message:
        `the ${manifest.model} embedding worker stopped: ${detail}; ` +
        "it will be started again on the next index pass",
    });
  }

  async function load(signal: AbortSignal | undefined): Promise<EmbeddingProvider> {
    if (dir === undefined) throw new EmbeddingError("the embedded engine has no model cache");

    const spec: InferenceSpec = {
      cacheDir: dir,
      manifest,
      threads: options.threads ?? defaultThreadCount(),
    };
    // `controller` is aborted by `close()`; `signal` is the resolution above
    // being torn down. Either one ends the load, wherever it is running.
    // A host has to be able to name itself in its own death report, and it does
    // not exist until the factory resolves; the box is what closes that circle.
    // A death before the assignment below is a host `open()` is about to reject
    // over anyway, and `forgetHost` would decline it for the same reason.
    const box: { current?: InferenceHost } = {};
    const created = await hostFactory(spec, {
      signal:
        signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]),
      onLost: (detail) => {
        const dead = box.current;
        if (dead !== undefined) forgetHost(dead, detail);
      },
    });
    box.current = created;
    // A call, not a comparison: `closed` is mutated by `close()` during the
    // `await` above, which narrowing would rule out.
    if (closed || signal?.aborted === true) {
      await created.close();
      throw new EmbeddingError("model load aborted");
    }
    host = created;

    return createEmbeddingProvider(ref, async (texts) => {
      const vectors = await created.embed(texts);
      return vectors.map((vector) => Array.from(vector));
    });
  }

  async function open(openOptions?: EmbeddedEngineOpenOptions): Promise<EmbeddingProvider> {
    if (closed) throw new EmbeddingError("the embedded engine has been shut down");
    // One session per engine: `open` is called once per resolution, and a second
    // 22 MiB graph in the same process would be pure duplication.
    loading ??= load(openOptions?.signal).catch((error: unknown) => {
      loading = undefined;
      if (error instanceof EmbeddingError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      report({
        level: "error",
        message: `the ${manifest.model} model could not be loaded: ${detail}`,
      });
      throw new EmbeddingError(`the embedded model could not be loaded: ${detail}`, {
        cause: error,
      });
    });
    return loading;
  }

  return {
    ref,
    availability,
    open,
    requestModel,
    onModelReady(listener) {
      readyListeners.push(listener);
    },
    whenSettled: async () => {
      // A loop rather than a single await: one attempt's `finally` can be
      // followed by a retry the caller started while this was pending.
      while (inFlight !== undefined) await inFlight;
    },
    async close() {
      closed = true;
      controller.abort();
      await inFlight;
      // `loading` may still be resolving into a host nobody will hold.
      const pending = loading;
      loading = undefined;
      if (pending !== undefined) await pending.catch(() => undefined);
      // Awaited, not fired and forgotten: for the worker host this is
      // `Worker.terminate()`, and the point of awaiting it is that no inference
      // thread outlives the server process (SERVER-049).
      const owned = host;
      host = undefined;
      if (owned !== undefined) await owned.close();
    },
  };
}
