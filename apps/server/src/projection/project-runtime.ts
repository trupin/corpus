// Runtime-state projectors: the `events`, `jobs`, `locks` and `seen` tables,
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
  LockSchema,
  QUEUE_EVENT_STATUSES,
  QueueEventSchema,
  ThreadIdSchema,
  type QueueEvent,
  type QueueEventStatus,
} from "@corpus/contract";
import { z } from "zod";
import { normalizeInstant } from "../core/time.js";
import type { ProjectionDb } from "./db.js";

export const QUEUE_DIR = "queue";
export const JOBS_DIR = "jobs";
export const LOCKS_DIR = "locks";
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

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Every `evt_*.json` under `.corpus/queue/`, keyed by the status directory holding it. */
export function listQueueEventFiles(
  corpusDir: string,
): { status: QueueEventStatus; name: string; path: string }[] {
  const files: { status: QueueEventStatus; name: string; path: string }[] = [];
  for (const status of QUEUE_EVENT_STATUSES) {
    const dir = join(corpusDir, QUEUE_DIR, status);
    for (const name of listFiles(dir)) {
      if (!isEventFile(name)) continue;
      files.push({ status, name, path: join(dir, name) });
    }
  }
  return files;
}

/** Upserts one event row. The status is the directory the file lives in, never a file field. */
export function projectEvent(db: ProjectionDb, event: QueueEvent, status: QueueEventStatus): void {
  db.prepare(
    `INSERT INTO events (id, type, status, created, payload_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type,
       status = excluded.status,
       created = excluded.created,
       payload_json = excluded.payload_json`,
  ).run(event.id, event.type, status, event.created, JSON.stringify(event.payload));
}

export function removeEvent(db: ProjectionDb, id: string): void {
  db.prepare("DELETE FROM events WHERE id = ?").run(id);
}

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
  const event = QueueEventSchema.safeParse(parsed);
  if (!event.success) {
    db.logger.info("skipping malformed queue event", { path });
    return false;
  }
  projectEvent(db, event.data, status);
  return true;
}

/** Rebuilds `events` from the five status directories. */
export function projectQueueDir(db: ProjectionDb, corpusDir: string): number {
  db.sqlite.exec("DELETE FROM events");
  let projected = 0;
  for (const file of listQueueEventFiles(corpusDir)) {
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
  for (const name of listFiles(join(corpusDir, JOBS_DIR))) {
    const match = JOB_FILE.exec(name);
    const eventId = match?.[1];
    if (eventId === undefined) continue;
    projectJob(db, corpusDir, eventId);
    projected += 1;
  }
  return projected;
}

const LOCK_FILE = /^((?:doc|th)_[A-Za-z0-9]+)\.json$/;

/**
 * An expired lease is treated as absent everywhere it is read (SPEC.md §7), and
 * the projection is no exception: a row for a lock that can no longer refuse
 * anything would put a banner on a document nobody is editing. The file stays
 * until `POST /api/locks/reap` unlinks it; the row goes now.
 */
function isLeaseExpired(acquired: string, ttlSeconds: number, nowMs: number): boolean {
  // Negated "still live" rather than a comparison: every comparison with `NaN`
  // is false, so an undateable `acquired` reads as expired — a lock nobody can
  // date must not be able to wedge a document.
  return !(nowMs < Date.parse(acquired) + ttlSeconds * 1000);
}

export function projectLock(
  db: ProjectionDb,
  corpusDir: string,
  docId: string,
  nowMs: number = Date.now(),
): void {
  let parsed: unknown;
  try {
    parsed = readJsonFile(join(corpusDir, LOCKS_DIR, `${docId}.json`));
  } catch {
    removeLock(db, docId);
    return;
  }
  const lock = LockSchema.safeParse(parsed);
  if (!lock.success) {
    db.logger.info("skipping malformed lock", { docId });
    removeLock(db, docId);
    return;
  }
  if (isLeaseExpired(lock.data.acquired, lock.data.ttl, nowMs)) {
    removeLock(db, docId);
    return;
  }
  db.prepare(
    `INSERT INTO locks (doc_id, holder, acquired, ttl)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(doc_id) DO UPDATE SET
       holder = excluded.holder, acquired = excluded.acquired, ttl = excluded.ttl`,
  ).run(lock.data.docId, lock.data.holder, lock.data.acquired, lock.data.ttl);
}

export function removeLock(db: ProjectionDb, docId: string): void {
  db.prepare("DELETE FROM locks WHERE doc_id = ?").run(docId);
}

/** Rebuilds `locks` from `.corpus/locks/*.json`; the count is of rows, not files. */
export function projectLocksDir(
  db: ProjectionDb,
  corpusDir: string,
  nowMs: number = Date.now(),
): number {
  db.sqlite.exec("DELETE FROM locks");
  for (const name of listFiles(join(corpusDir, LOCKS_DIR))) {
    const match = LOCK_FILE.exec(name);
    const docId = match?.[1];
    if (docId === undefined) continue;
    projectLock(db, corpusDir, docId, nowMs);
  }
  const row = db.prepare("SELECT COUNT(*) AS n FROM locks").get() as { n: number };
  return row.n;
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
  readonly locks: number;
  readonly seen: number;
};

/** Every runtime table, in dependency order (`jobs` joins `events`' status). */
export function projectRuntime(db: ProjectionDb): RuntimeCounts {
  const corpusDir = db.config.corpusDir;
  const events = projectQueueDir(db, corpusDir);
  const jobs = projectJobsDir(db, corpusDir);
  const locks = projectLocksDir(db, corpusDir);
  const seen = projectSeen(db, corpusDir);
  return { events, jobs, locks, seen };
}
