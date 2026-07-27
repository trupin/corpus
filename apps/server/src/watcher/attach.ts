// Wiring the watcher to a server's lifetime.
//
// Attached from `lifecycle.ts` rather than from inside `createServer`, for the
// same reason the projection is: the watcher is filesystem-bound and
// lifecycle-scoped, while `createServer` is a pure function of its config. The
// bus and the SSE hub — pure in-process machinery — stay inside `createServer`
// (sprint-004 Adjudication 2).

import type { CorpusServer } from "../app.js";
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
  server.registerDisposer(async () => {
    await watcher.close();
  });
  return watcher;
}
