import type { QueryKey, QueueEventStatus } from "@corpus/contract";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { AGENTS_KEY, DOCS_KEY, JOBS_KEY, QUEUE_KEY, jobKey } from "../events/index.js";
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

/**
 * The same set **plus §7's roster**, for a change that moves an event into or
 * out of `in-progress`.
 *
 * A lane row's `summary` is read at response time off the newest **in-progress**
 * event on that lane and the `jobs.last_line` joined to it (`agents/roster.ts`),
 * so exactly those moves change what `GET /api/agents` answers — the rule
 * SERVER-114 established, applied here: *an emit names every key a route
 * carrying the changed fact is cached under, not the key of the route the fact
 * is named after*. Reproduced before the fix: a claim on a designated lane moved
 * its summary from `null` to `working Claims review` and announced
 * `[["queue"],["jobs"],["docs"]]`.
 *
 * **Not every queue frame belongs here, and that is the point.** An enqueue
 * writes a `pending` event, and `halt`/`resume` write a sentinel that is not an
 * event at all; neither touches a row the roster reads, so neither may send
 * every open client to refetch it. {@link queueTransitionKeys} is where a call
 * site says which of the two it is, by naming the statuses it moved between.
 */
export const QUEUE_TRANSITION_QUERY_KEYS: readonly QueryKey[] = [...QUEUE_QUERY_KEYS, AGENTS_KEY];

/**
 * The keys a queue change names, chosen by the statuses it moved an event
 * between — `undefined` for "there was no event on that side", which is what an
 * enqueue's origin and a removal's destination are.
 *
 * Total over the statuses rather than a judgement per verb: a caller states
 * what it did and the rule answers, so a new transition cannot be added with a
 * hand-picked key list the way the seven sites of SERVER-115 were.
 *
 * **`pending` joins `in-progress` here, and it is a reversal** (SERVER-155).
 * SERVER-115 decided that an enqueue must not name the roster, and was right
 * then: a lane's row reported the work it was *holding*, and nobody holds a
 * pending event. A row now also carries `pending`, so an enqueue moves it.
 *
 * It is not a refinement of that decision but a change to what the roster is
 * for. Since SPEC.md §7's rider signed 2026-08-25 there is no fallback, so a
 * conversation whose listener is not running waits until one starts, and
 * `pending > 0 && !live` is the only thing that tells the orchestrator to start
 * it. A roster that stayed stale on an enqueue would leave that conversation
 * waiting with nothing announcing that anything had changed — which is now
 * indefinitely rather than merely slowly.
 *
 * The cost SERVER-115 named is real and now worth paying: an enqueue is not a
 * hot path, and the refetch is a bounded read over the designated lanes.
 */
export function queueTransitionKeys(
  ...statuses: readonly (QueueEventStatus | undefined)[]
): readonly QueryKey[] {
  const movesTheRoster = statuses.some(
    (status) => status === "in-progress" || status === "pending",
  );
  return movesTheRoster ? QUEUE_TRANSITION_QUERY_KEYS : QUEUE_QUERY_KEYS;
}

/**
 * What an append to one job's log makes stale: the console's list, that job's
 * own log — and the roster, but only while the job is the work a lane is
 * **holding**.
 *
 * `jobs.last_line` is the first thing a lane's summary reports (§7), and it is
 * read through `events.status = 'in-progress'`, so an append to a finished job's
 * log changes the console and nothing about who is running. `holdsWork` is that
 * distinction, asked of the projection by the caller, which is the only place
 * the event's status is known.
 */
export function jobLogKeys(eventId: string, holdsWork: boolean): readonly QueryKey[] {
  const keys: QueryKey[] = [JOBS_KEY, jobKey(eventId)];
  if (holdsWork) keys.push(AGENTS_KEY);
  return keys;
}

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
