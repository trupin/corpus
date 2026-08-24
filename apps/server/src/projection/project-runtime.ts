// Runtime-state projectors: the `events`, `jobs` and `seen` tables,
// derived from `.corpus/` (SPEC.md §7, §9.1).
//
// Runtime state is not the corpus — it is gitignored, rebuildable, and a
// malformed file here is a warning, never a boot failure. Each projector comes
// in two shapes: a whole-directory pass (used by `rebuild` and by the queue's
// boot rebuild) and a single-item upsert (used by the queue on every transition
// and by the watcher, SERVER-007).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DocumentIdSchema,
  LaneSchema,
  ORCHESTRATOR_LANE,
  QUEUE_EVENT_STATUSES,
  QueueEventSchema,
  ThreadIdSchema,
  type Lane,
  type QueueEvent,
  type QueueEventStatus,
} from "@corpus/contract";
import { z } from "zod";
import { normalizeInstant } from "../core/time.js";
import type { ProjectionDb } from "./db.js";

export const QUEUE_DIR = "queue";
export const JOBS_DIR = "jobs";
export const SEEN_FILE = "seen.json";

/**
 * The only filename shape that counts as a queue event, anywhere in the system
 * (Sprint-003 Adjudication 2). Every `init`-produced workspace carries a
 * `.gitkeep` inside each `.corpus/queue/<status>/` so the skeleton survives a
 * clone; counting it would make `doctor` report `count_mismatch` on every real
 * workspace, permanently.
 */
const EVENT_FILE = /^evt_[A-Za-z0-9]+\.json$/;

export function isEventFile(name: string): boolean {
  return EVENT_FILE.test(name);
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * A runtime directory the reader could not list, and why (SERVER-065) — the same
 * shape `roots.ts` returns, for the same reason: skip, exclude from the counts,
 * report. `ENOENT` is silent, because a workspace that has enqueued nothing has
 * no `pending/` yet and that is the ordinary state.
 */
export type UnlistableRuntimeDirectory = {
  readonly path: string;
  readonly reason: string;
};

/**
 * Every name in a runtime directory, and the reason if there were none to read.
 *
 * This function carried **no comment at all** before SERVER-065, and no
 * distinction either: it answered the empty list for a directory that does not
 * exist and for one the process cannot read, which are opposite facts. The first
 * is the ordinary state of a workspace that has enqueued nothing. The second
 * means `events` or `jobs` is short by however many files are in there, with
 * nothing anywhere saying so — the projection reporting success over a partial
 * corpus.
 *
 * The failure is **returned rather than logged**, as `roots.ts` returns its own:
 * this module is called from a boot path and from `doctor`, and only the caller
 * knows which channel an operator is watching.
 */
function listFiles(dir: string): {
  readonly names: string[];
  readonly unlistable: UnlistableRuntimeDirectory | null;
} {
  try {
    return { names: readdirSync(dir).sort(), unlistable: null };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { names: [], unlistable: null };
    }
    return {
      names: [],
      unlistable: {
        path: dir,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export type QueueEventFile = { status: QueueEventStatus; name: string; path: string };

/**
 * Every `evt_*.json` under `.corpus/queue/`, keyed by the status directory
 * holding it, plus any status directory that could not be listed (SERVER-065).
 *
 * The skips are carried on the result rather than swallowed because both callers
 * need them and neither could recover them: `projectQueueDir` must not report a
 * count over a directory it never read, and `doctor`'s `count_mismatch` compares
 * this list's length against the `events` table — so a status directory silently
 * read as empty would make files and rows *agree* about a queue that is missing
 * events.
 */
export function listQueueEventFiles(corpusDir: string): {
  readonly files: QueueEventFile[];
  readonly unlistable: readonly UnlistableRuntimeDirectory[];
} {
  const files: QueueEventFile[] = [];
  const unlistable: UnlistableRuntimeDirectory[] = [];
  for (const status of QUEUE_EVENT_STATUSES) {
    const dir = join(corpusDir, QUEUE_DIR, status);
    const listing = listFiles(dir);
    if (listing.unlistable !== null) unlistable.push(listing.unlistable);
    for (const name of listing.names) {
      if (!isEventFile(name)) continue;
      files.push({ status, name, path: join(dir, name) });
    }
  }
  return { files, unlistable };
}

/**
 * Upserts one event row. The status is the directory the file lives in, never a
 * file field.
 *
 * `blockedOn` is the document a `deferred` event waits on (SERVER-030). It is
 * always written, `null` included: an event that leaves `deferred/` has to
 * *clear* the column, and an `ON CONFLICT` clause that only ever set it would
 * leave a processed job still claiming to be waiting on a document.
 *
 * `lane` defaults to the orchestrator's for the same reason `queue/lanes.ts`'s
 * `laneOf` does: an event file written before lanes existed carries no stamp,
 * and the caller that has one passes it. Unlike `blockedOn` it never *changes*
 * across a transition — SPEC.md §7 makes the stamp once and never rewrites it —
 * so the `ON CONFLICT` clause carrying it is about re-projecting the same value,
 * not about updating it.
 */
export function projectEvent(
  db: ProjectionDb,
  event: QueueEvent,
  status: QueueEventStatus,
  blockedOn: string | null = null,
  lane: Lane = ORCHESTRATOR_LANE,
): void {
  db.prepare(
    `INSERT INTO events (id, type, status, created, payload_json, blocked_on, lane)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type,
       status = excluded.status,
       created = excluded.created,
       payload_json = excluded.payload_json,
       blocked_on = excluded.blocked_on,
       lane = excluded.lane`,
  ).run(
    event.id,
    event.type,
    status,
    event.created,
    JSON.stringify(event.payload),
    blockedOn,
    lane,
  );
}

export function removeEvent(db: ProjectionDb, id: string): void {
  db.prepare("DELETE FROM events WHERE id = ?").run(id);
}

/**
 * The wire shape plus the one piece of transition bookkeeping the projection
 * reads back: which document a deferred event is waiting for (SERVER-030). The
 * rest of the on-disk superset — `attempts`, `error`, `deferReason` — stays in
 * the file, which is where its readers are.
 *
 * A `blockedOn` that is not a document id is dropped rather than rejected: the
 * file is still a perfectly good event, and refusing to project it over a field
 * only a deferral uses would lose the event from the console entirely.
 */
const ProjectedEventFileSchema = QueueEventSchema.extend({
  blockedOn: DocumentIdSchema.optional().catch(undefined),
  // Same leniency, for the same reason: a `lane` that is not a lane leaves the
  // event projected on the orchestrator's, rather than dropping an otherwise
  // perfectly good event out of the console entirely. The *claim* path is
  // stricter — `store.ts` quarantines a file whose stamp does not parse — because
  // a routing decision nobody can read must not be silently reinterpreted; this
  // path only decides what a console row says.
  lane: LaneSchema.optional().catch(undefined),
});

/**
 * Projects one event file into the `events` table. The on-disk event file is a
 * superset of the wire shape (SERVER-008 adds transition bookkeeping), so the
 * schema parse keeps the declared fields and ignores the rest. `false` means the
 * file was unreadable or malformed — logged, skipped, never fatal.
 *
 * The single-file form is what the watcher (SERVER-007) uses for an `evt_*.json`
 * that appeared out of band; the directory pass below is the boot rebuild.
 */
export function projectEventFile(
  db: ProjectionDb,
  path: string,
  status: QueueEventStatus,
): boolean {
  let parsed: unknown;
  try {
    parsed = readJsonFile(path);
  } catch (error) {
    db.logger.info("skipping unreadable queue event", { path, error: String(error) });
    return false;
  }
  const event = ProjectedEventFileSchema.safeParse(parsed);
  if (!event.success) {
    db.logger.info("skipping malformed queue event", { path });
    return false;
  }
  projectEvent(db, event.data, status, event.data.blockedOn ?? null, event.data.lane);
  return true;
}

/**
 * Rebuilds `events` from every status directory.
 *
 * A status directory that could not be listed is skipped and logged at `error`,
 * never fatal (SERVER-065). Its events are absent from the count for the only
 * honest reason there is: they were never read. `error` is the level because
 * only an operator can repair an unreadable directory, and it is the one level a
 * server running at `silent` still writes.
 */
export function projectQueueDir(db: ProjectionDb, corpusDir: string): number {
  db.sqlite.exec("DELETE FROM events");
  let projected = 0;
  const { files, unlistable } = listQueueEventFiles(corpusDir);
  for (const directory of unlistable) {
    db.logger.error("cannot list queue status directory; its events are not projected", {
      path: directory.path,
      reason: directory.reason,
    });
  }
  for (const file of files) {
    if (projectEventFile(db, file.path, file.status)) projected += 1;
  }
  return projected;
}

const JobLineSchema = z.object({ ts: z.string(), line: z.string() });

type JobSummary = { started: string | null; updated: string | null; lastLine: string | null };

/**
 * Full log lines stay in the file and are tailed, never projected (§9.1) — the
 * projection keeps only the console row's summary, so the file is read once for
 * its first and last parseable line and then dropped.
 */
function summarizeJobLog(path: string): JobSummary {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { started: null, updated: null, lastLine: null };
  }
  let started: string | null = null;
  let updated: string | null = null;
  let lastLine: string | null = null;
  for (const text of raw.split("\n")) {
    if (text.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const line = JobLineSchema.safeParse(parsed);
    if (!line.success) continue;
    const ts = normalizeInstant(line.data.ts);
    started ??= ts;
    updated = ts;
    lastLine = line.data.line;
  }
  return { started, updated, lastLine };
}

const JOB_FILE = /^(evt_[A-Za-z0-9]+)\.jsonl$/;

/** Upserts the console row for one job; `status` is joined from the event mirror. */
export function projectJob(db: ProjectionDb, corpusDir: string, eventId: string): void {
  const summary = summarizeJobLog(join(corpusDir, JOBS_DIR, `${eventId}.jsonl`));
  const event = db.prepare("SELECT status FROM events WHERE id = ?").get(eventId) as
    { status: string } | undefined;
  db.prepare(
    `INSERT INTO jobs (event_id, status, started, updated, last_line)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       status = excluded.status,
       started = excluded.started,
       updated = excluded.updated,
       last_line = excluded.last_line`,
  ).run(eventId, event?.status ?? null, summary.started, summary.updated, summary.lastLine);
}

export function removeJob(db: ProjectionDb, eventId: string): void {
  db.prepare("DELETE FROM jobs WHERE event_id = ?").run(eventId);
}

/** Rebuilds `jobs` from `.corpus/jobs/*.jsonl`. Run after `events`, whose status it joins. */
export function projectJobsDir(db: ProjectionDb, corpusDir: string): number {
  db.sqlite.exec("DELETE FROM jobs");
  let projected = 0;
  const listing = listFiles(join(corpusDir, JOBS_DIR));
  // Skipped, excluded from the count, logged at `error` — the same three things
  // the queue directory above and the document walk in `roots.ts` do, and for
  // the same reason (SERVER-065).
  if (listing.unlistable !== null) {
    db.logger.error("cannot list the jobs directory; its job logs are not projected", {
      path: listing.unlistable.path,
      reason: listing.unlistable.reason,
    });
  }
  for (const name of listing.names) {
    const match = JOB_FILE.exec(name);
    const eventId = match?.[1];
    if (eventId === undefined) continue;
    projectJob(db, corpusDir, eventId);
    projected += 1;
  }
  return projected;
}

/**
 * `.corpus/seen.json` is a flat map of thread id → last-seen instant, written by
 * `POST /api/threads/{id}/seen` (`threads/seen.ts`) and followed by the watcher
 * as a single watched file, so an out-of-band edit re-projects like every other
 * root. A missing or malformed file projects an empty table with a warning,
 * because read state is not the corpus and refusing to answer would be worse
 * than answering "nothing has been read".
 */
export function projectSeen(db: ProjectionDb, corpusDir: string): number {
  db.sqlite.exec("DELETE FROM seen");
  let parsed: unknown;
  try {
    parsed = readJsonFile(join(corpusDir, SEEN_FILE));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    db.logger.info("ignoring unreadable seen.json", { error: String(error) });
    return 0;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    db.logger.info("ignoring malformed seen.json: expected an object of thread id → instant");
    return 0;
  }

  const insert = db.prepare("INSERT OR REPLACE INTO seen (thread_id, last_seen_ts) VALUES (?, ?)");
  let projected = 0;
  for (const [threadId, value] of Object.entries(parsed).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!ThreadIdSchema.safeParse(threadId).success || typeof value !== "string") continue;
    const ts = normalizeInstant(value);
    if (ts === null) continue;
    insert.run(threadId, ts);
    projected += 1;
  }
  return projected;
}

export type RuntimeCounts = {
  readonly events: number;
  readonly jobs: number;
  readonly seen: number;
};

/** Every runtime table, in dependency order (`jobs` joins `events`' status). */
export function projectRuntime(db: ProjectionDb): RuntimeCounts {
  const corpusDir = db.config.corpusDir;
  const events = projectQueueDir(db, corpusDir);
  const jobs = projectJobsDir(db, corpusDir);
  const seen = projectSeen(db, corpusDir);
  return { events, jobs, seen };
}
