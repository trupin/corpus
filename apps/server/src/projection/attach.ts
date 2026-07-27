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

/**
 * Opens the workspace's projection, repopulates it from files (the workspace may
 * have been edited while the server was down), and registers the handle's
 * closure as a shutdown disposer.
 */
export function attachProjection(server: CorpusServer): ProjectionDb {
  const started = Date.now();
  const db = openProjection(server.config, { logger: server.logger });
  // Debug, not info: a successful boot already says "listening on …", and every
  // `createServer` in a test run would otherwise narrate its projection.
  server.logger.debug("projection ready", {
    path: db.path,
    durationMs: Date.now() - started,
  });
  server.registerDisposer(() => {
    db.close();
  });
  return db;
}
