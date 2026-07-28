// Wiring the watcher to a server's lifetime.
//
// Attached from `lifecycle.ts` rather than from inside `createServer`, for the
// same reason the projection is: the watcher is filesystem-bound and
// lifecycle-scoped, while `createServer` is a pure function of its config. The
// bus and the SSE hub — pure in-process machinery — stay inside `createServer`
// (sprint-004 Adjudication 2).

import type { CorpusServer } from "../app.js";
import { catchUpOnWatcherReady } from "./catch-up.js";
import { startWatcher, type WatcherHandle } from "./watcher.js";

/**
 * Starts the watcher over the workspace and registers its shutdown disposer.
 * Returns `undefined` when the server was built without a projection — there is
 * nothing to re-project into, so watching would only burn file descriptors.
 *
 * Disposers run in reverse registration order, so the watcher — registered after
 * the projection — is stopped before the database handle it writes to closes.
 */
export function attachWatcher(server: CorpusServer): WatcherHandle | undefined {
  const db = server.projection;
  if (db === undefined) return undefined;
  const watcher = startWatcher({
    db,
    bus: server.bus,
    selfWrites: server.selfWrites,
    logger: server.logger,
  });
  let stopped = false;
  server.registerDisposer(async () => {
    stopped = true;
    await watcher.close();
  });

  // SERVER-025: the watcher's own startup window. Registered rather than
  // awaited — the bind must not wait on chokidar's initial walk, and a `ready`
  // that never resolves must leave the server running rather than hang it.
  void catchUpOnWatcherReady({
    db,
    bus: server.bus,
    queue: server.queue,
    logger: server.logger,
    ready: watcher.ready,
    cancelled: () => stopped,
  }).catch((error: unknown) => {
    // A catch-up that fails costs the window's files their rows until the next
    // restart or edit — bad, but not worth taking down a server that is
    // otherwise serving correctly.
    server.logger.error("boot catch-up failed", { error: String(error) });
  });

  return watcher;
}
