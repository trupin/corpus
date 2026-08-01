/**
 * Boot wiring for the embed worker.
 *
 * **It attaches last, and that is the whole design of this file.** Disposers run
 * in reverse registration order (`app.ts`), so the last subsystem registered is
 * the first one stopped — and the worker must stop before the projection's
 * handle closes, before the embedding seam's in-flight resolution is awaited,
 * and before the embedded engine releases its model session. A worker registered
 * anywhere earlier passes every behavioural test in this file and then, in
 * production, writes a row into a database that has just been closed.
 *
 * It resolves its own provider rather than borrowing `attachSemanticIndex`'s.
 * The two resolutions answer different questions at different times: the seam's
 * runs at boot to *report* what the workspace has, while the worker's runs at
 * the moment there is something to index, which may be minutes later and — for
 * an engine whose model was still downloading at boot — with a different answer.
 * Tying the worker to the boot answer would make "the model downloads on the
 * first index need" unimplementable, because the first index need has not
 * happened yet when the boot answer is computed.
 */

import type { CorpusServer } from "../app.js";
import { recordedIdentities } from "./embeddings.js";
import type { CorpusEmbeddedEngine } from "./engine/index.js";
import { resolveEmbeddingProvider } from "./resolve.js";
import { startEmbedWorker, type EmbedWorkerHandle, type EmbedWorkerOptions } from "./worker.js";

export interface AttachEmbedWorkerDeps {
  /** SERVER-048's engine, when this build has one. Its `requestModel` is the lazy download. */
  readonly engine?: CorpusEmbeddedEngine | undefined;
  /** Test seams: scheduling, batching, the clock. Nothing sets them in production. */
  readonly worker?: Omit<EmbedWorkerOptions, "db" | "logger" | "bus" | "resolve"> | undefined;
}

/**
 * Starts the worker and registers its disposer. Returns `undefined` when the
 * server was built without a projection — there are no chunk rows to drain, and
 * a worker over no database is a timer with nothing to do.
 */
export function attachEmbedWorker(
  server: CorpusServer,
  deps: AttachEmbedWorkerDeps = {},
): EmbedWorkerHandle | undefined {
  const db = server.projection;
  if (db === undefined) return undefined;

  const { engine } = deps;
  const worker = startEmbedWorker({
    ...deps.worker,
    db,
    logger: server.logger,
    bus: server.bus,
    resolve: () =>
      resolveEmbeddingProvider({
        settings: server.config.embedding,
        // Read fresh on every resolution: an identity invalidation, an
        // `index rebuild` or a first vector all change what the index is sticky
        // to, and a value captured at attach time would be a boot-time snapshot
        // making a decision about a corpus that has moved on.
        recordedIdentities: recordedIdentities(db),
        ...(engine === undefined ? {} : { embeddedEngine: engine }),
      }),
    ...(engine === undefined ? {} : { requestModel: () => engine.requestModel() }),
  });

  // `POST /api/index/rebuild` discards the vectors synchronously and then has to
  // restart a worker that may have *correctly* stopped asking — stickiness kept
  // the recorded model, so resolution parked at the backoff ceiling, and the
  // rows that made it sticky are the ones just deleted. The routes were mounted
  // before this worker existed, so the binding goes the other way, exactly as
  // `semantic.useEngine` does for the embedded engine.
  server.indexMaintenance?.useWorker(worker);

  server.registerDisposer(() => worker.close());
  return worker;
}
