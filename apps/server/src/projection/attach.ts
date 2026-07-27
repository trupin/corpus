// Wiring the projection to a server's lifetime.
//
// Attached from `lifecycle.ts` rather than from inside `createServer`:
// `createServer` is documented as a pure function of its config — it reads no
// environment and touches no filesystem — and `app.ts` already declares
// `registerDisposer` as the seam a subsystem attaches through. Keeping the
// database open out of the app factory also keeps every `createServer` unit
// test free of a real SQLite file.

import type { CorpusServer } from "../app.js";
import { openProjection, type ProjectionDb } from "./db.js";
import { createProjectionQueueMirror } from "./queue-mirror.js";

/**
 * Opens the workspace's projection, repopulates it from files (the workspace may
 * have been edited while the server was down), registers the handle's closure as
 * a shutdown disposer, and hands the queue its `events` mirror.
 *
 * The mirror is bound here rather than passed to `createServer` for the same
 * reason the database is opened here: `createServer` is a pure function of its
 * config. Both halves stay injectable — `createServer`'s `queueMirror` dep for
 * unit tests, `attachProjectionFn` for the lifecycle's.
 */
export function attachProjection(server: CorpusServer): ProjectionDb {
  const started = Date.now();
  const db = openProjection(server.config, { logger: server.logger });
  // Registered before anything else can fail, so a handle that was opened is
  // always a handle that gets closed.
  server.registerDisposer(() => {
    db.close();
  });
  // The queue's own reader has the last word on the `events` table it mirrors,
  // so this runs after `openProjection`'s repopulation, not instead of it.
  const scan = server.queue.attachMirror(createProjectionQueueMirror(db));
  // Debug, not info: a successful boot already says "listening on …", and every
  // `createServer` in a test run would otherwise narrate its projection.
  server.logger.debug("projection ready", {
    path: db.path,
    events: scan.events.length,
    durationMs: Date.now() - started,
  });
  return db;
}
