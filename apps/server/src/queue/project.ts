import type { QueryKey } from "@corpus/contract";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { DOCS_KEY, JOBS_KEY, QUEUE_KEY } from "../events/index.js";
import type { QueueStore, StoredEvent } from "./store.js";

/**
 * The seam between the queue and the SQLite projection's `events` table
 * (SPEC.md §9.1). The queue owns the files and calls this after every
 * transition, synchronously, **before** responding — a client that just got a
 * `200` must be able to read its own write out of the projection (sprint-003
 * TEST-55). SERVER-004 owns the table and supplies the implementation; nothing
 * durable lives only in SQLite, so {@link rebuildQueueMirrorSync} can always
 * reconstruct it from the directories.
 */
export interface QueueMirror {
  upsertEvent(event: StoredEvent): void;
  /** Boot rebuild: the directories are the truth, the table is replaced wholesale. */
  replaceAllEvents(events: readonly StoredEvent[]): void;
}

/** The mirror used until a projection is wired in. */
export const NOOP_QUEUE_MIRROR: QueueMirror = {
  upsertEvent: () => undefined,
  replaceAllEvents: () => undefined,
};

/**
 * The query keys a queue transition invalidates (SPEC.md §2.2 rule 3: the server
 * announces staleness, the UI refetches). Every queue event is a job, so the
 * console's job list goes stale with the queue itself (§7).
 *
 * `DOCS_KEY` belongs here too, and not as a precaution: `failed-job` is a
 * `needs=` reason computed from `events.status` (`docs/needs.ts` —
 * `FAILED_JOB_SQL` matches any failed event whose payload names the row), so a
 * transition into or out of `failed` changes what `GET /api/docs?needs=me`
 * answers. §2.2 requires the invalidation set to say so; without it the
 * Attention column lagged behind the console until a reload (SERVER-028).
 */
export const QUEUE_QUERY_KEYS: readonly QueryKey[] = [QUEUE_KEY, JOBS_KEY, DOCS_KEY];

export type QueueInvalidate = (keys: readonly QueryKey[]) => void;

export const NOOP_INVALIDATE: QueueInvalidate = () => undefined;

export interface QueueScanResult {
  readonly events: StoredEvent[];
  /** Ids whose file could not be parsed; logged, skipped, never fatal. */
  readonly malformed: string[];
}

/** Reads every event file across every status directory. Boot path, hence sync. */
export function scanQueueSync(store: QueueStore): QueueScanResult {
  const events: StoredEvent[] = [];
  const malformed: string[] = [];
  for (const status of QUEUE_EVENT_STATUSES) {
    for (const id of store.listIdsSync(status)) {
      const read = store.readEventSync(status, id);
      if (read === undefined) continue;
      if (read.ok) events.push(read.event);
      else malformed.push(id);
    }
  }
  return { events, malformed };
}

/**
 * Rebuilds the `events` table from the directories at boot, so a restart — or a
 * crash halfway through a transition, or a file moved by hand while the server
 * was down — can neither lose nor duplicate an event.
 */
export function rebuildQueueMirrorSync(store: QueueStore, mirror: QueueMirror): QueueScanResult {
  const scan = scanQueueSync(store);
  mirror.replaceAllEvents(scan.events);
  return scan;
}
