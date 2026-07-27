// The projection's implementation of the queue's `events` mirror (SPEC.md §9.1).
//
// The queue owns the five status directories and calls this seam synchronously
// on every transition, **before** responding; `project-runtime.ts` owns the
// table and the row writer. This module is only the adapter between the two,
// and is deliberately the single place where a queue event becomes an `events`
// row — there is no second `events` writer and no second DDL (sprint-003's
// SERVER-004 → SERVER-008 ownership rule).
//
// Synchronous, like every projector: a client that just got a `200` must be
// able to read its own write out of the projection.

import { toWireEvent, type QueueMirror, type StoredEvent } from "../queue/index.js";
import type { ProjectionDb } from "./db.js";
import { projectEvent } from "./project-runtime.js";

/** The directory holding the file is the status, never the file's own field. */
function upsert(db: ProjectionDb, event: StoredEvent): void {
  projectEvent(db, toWireEvent(event), event.status);
}

/**
 * Binds the queue's mirror seam to an open projection.
 *
 * `replaceAllEvents` re-derives the whole table from the queue's own scan of the
 * directories rather than from `projectQueueDir`. Both read the same five
 * directories and agree on every well-formed workspace; where they differ, the
 * queue's reader is the one the API addresses events by (the filename and the
 * directory win over the file's `id`/`status` fields), so its view is the honest
 * mirror of what `claim-all` and `complete <id>` will actually find.
 *
 * A file the queue cannot parse produces no row — which is exactly the one-row
 * difference `db doctor` reports as `count_mismatch` until the next claim or
 * transition quarantines it. That asymmetry is deliberate: a corrupt event file
 * is drift, and hiding it would be the bug.
 */
export function createProjectionQueueMirror(db: ProjectionDb): QueueMirror {
  return {
    upsertEvent(event) {
      upsert(db, event);
    },
    replaceAllEvents(events) {
      db.transaction(() => {
        db.sqlite.exec("DELETE FROM events");
        for (const event of events) upsert(db, event);
      })();
    },
  };
}
