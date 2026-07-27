// Wiring the projection to a server's lifetime.
//
// Opened and attached from `lifecycle.ts` rather than from inside
// `createServer`: `createServer` is documented as a pure function of its config
// — it reads no environment and touches no filesystem — so it receives an open
// handle as a dep rather than opening one (sprint-004 Adjudication 2). Keeping
// the database out of the app factory also keeps every `createServer` unit test
// free of a real SQLite file.

import type { CorpusServer } from "../app.js";
import type { Logger } from "../logger.js";
import { openProjection, type ProjectionConfig, type ProjectionDb } from "./db.js";
import { createProjectionQueueMirror } from "./queue-mirror.js";

/**
 * Opens the workspace's projection and repopulates it from files (the workspace
 * may have been edited while the server was down). Called *before*
 * `createServer`, whose `projection` dep this becomes — route handlers and the
 * watcher both need the handle, and inventing two ways to reach it is how two
 * seams end up in one file.
 */
export function openWorkspaceProjection(config: ProjectionConfig, logger: Logger): ProjectionDb {
  return openProjection(config, { logger });
}

/**
 * Registers the projection's closure as a shutdown disposer and hands the queue
 * its `events` mirror.
 *
 * The mirror is bound here rather than passed to `createServer` because the
 * queue's own reader has the last word on the table it mirrors: binding re-runs
 * the rebuild against the real mirror, which the constructor could only run
 * against the no-op.
 */
export function attachProjection(server: CorpusServer): ProjectionDb {
  const started = Date.now();
  const db = server.projection;
  if (db === undefined) {
    throw new TypeError("attachProjection requires a server built with a `projection` dep");
  }
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
