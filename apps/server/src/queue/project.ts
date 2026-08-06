import type { QueryKey, QueueEventStatus } from "@corpus/contract";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { DOCS_KEY, JOBS_KEY, QUEUE_KEY } from "../events/index.js";
import type { QueueStore, ReadEventResult, StoredEvent } from "./store.js";

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

/**
 * One event file the scan could not read **at all** — EACCES, EIO, a directory
 * where a file should be — as opposed to one it read and could not parse.
 *
 * Carries the status because the scan spans every directory: "which file" is a
 * path, not an id, and an operator who has to go fix this by hand needs both.
 */
export interface UnreadableEvent {
  readonly id: string;
  readonly status: QueueEventStatus;
  readonly reason: string;
}

/**
 * One status directory the scan could not list — EACCES on the directory itself,
 * EIO, a filesystem that went away — as opposed to one file inside it.
 *
 * There is no id here, and that is the whole difference: an unlistable directory
 * offers no per-file granularity to be narrow with, so what is lost is *every*
 * event in that status, and the status is the only thing an operator can be
 * pointed at.
 */
export interface UnlistableStatus {
  readonly status: QueueEventStatus;
  readonly reason: string;
}

export interface QueueScanResult {
  readonly events: StoredEvent[];
  /** Ids whose file could not be parsed; logged, skipped, never fatal. */
  readonly malformed: string[];
  /** Files that could not be read at all; logged at `error`, skipped, never fatal. */
  readonly unreadable: UnreadableEvent[];
  /** Status directories that could not be listed; logged at `error`, skipped, never fatal. */
  readonly unlistable: UnlistableStatus[];
}

/** What to put in a log field for a thrown value. */
const causeOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Reads every event file across every status directory. Boot path, hence sync.
 *
 * **Nothing here throws.** This runs from `QueueService`'s constructor, i.e.
 * during boot, so a throw is not "the queue is degraded" — it is `corpus server
 * start` reporting that the server exited during startup, with no server left
 * to ask why, over one entry in a directory the user then has to find by hand
 * (SERVER-063). Every way the filesystem can refuse is therefore skipped, and
 * everything skipped is excluded from the mirror the caller replaces the
 * `events` table with: a row the projection cannot read must not be reported as
 * present, and must not be reported as something it is not either. Nothing is
 * moved — **boot is a read**, and relocating something the process could not
 * read is not something a boot should attempt; `reap-stale` is what quarantines.
 *
 * Degradation is as narrow as the failure allows, in the same two tiers
 * `readHeldInProgress` uses (`held.ts`, SERVER-061), because the two failures
 * have different granularity — and the two readers of these directories now
 * really do agree, at both tiers, which the docblock that used to sit here only
 * claimed:
 *
 * - **One unreadable file** — EACCES, EIO, a directory where a file should be —
 *   costs exactly that event. Every other event, in this status directory and in
 *   the ones after it, is still scanned and still mirrored.
 * - **An unlistable status directory** offers no per-file granularity to be
 *   narrow with: there is no list to skip an entry from, so the whole status is
 *   lost. The other status directories are still scanned — losing `pending/` is
 *   not a reason to stop reporting what is `in-progress/`.
 *
 * The store stays honest either way: `listIdsSync` and `readEventSync` throw
 * what the filesystem threw, and the *policy* of skipping lives here, in the
 * reader that knows it is a boot path.
 *
 * The *level* is part of the rule: an unreadable file or directory is a fault in
 * the workspace that only an operator can fix, and `error` is the one level a
 * server running at `silent` still writes — so a skip that costs the console an
 * event can never be invisible. Every kind is reported rather than logged here,
 * because the caller is the one holding the logger.
 *
 * `ensureLayoutSync` runs before this and does **not** cover the directory case:
 * its `mkdirSync(dir, { recursive: true })` succeeds on an existing directory
 * whatever its mode, so a `chmod 000` status directory arrives here intact and
 * fails at the listing. What that `mkdir` does refuse is a status *path that is
 * not a directory at all* (a file, a symlink to one, a loop) — a layout fault,
 * and a write, which is not this reader's to answer.
 */
export function scanQueueSync(store: QueueStore): QueueScanResult {
  const events: StoredEvent[] = [];
  const malformed: string[] = [];
  const unreadable: UnreadableEvent[] = [];
  const unlistable: UnlistableStatus[] = [];
  for (const status of QUEUE_EVENT_STATUSES) {
    let ids: readonly string[];
    try {
      ids = store.listIdsSync(status);
    } catch (error) {
      unlistable.push({ status, reason: causeOf(error) });
      continue;
    }
    for (const id of ids) {
      let read: ReadEventResult | undefined;
      try {
        read = store.readEventSync(status, id);
      } catch (error) {
        unreadable.push({ id, status, reason: causeOf(error) });
        continue;
      }
      if (read === undefined) continue;
      if (read.ok) events.push(read.event);
      else malformed.push(id);
    }
  }
  return { events, malformed, unreadable, unlistable };
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
