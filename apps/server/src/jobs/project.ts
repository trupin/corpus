// The console's rows: the `jobs` table joined with the `events` mirror
// (SPEC.md §7, §9.1).
//
// **`status` is joined from `events`, never read from the log file** (the
// SERVER-004 handoff, pinned): the log carries lines, the queue carries state.
// A row therefore exists for every event — a job that never logged shows an
// empty last line rather than disappearing from the console.

import type { Job, JobLogLine, QueueEventStatus } from "@corpus/contract";
import { DocumentIdSchema, QueueEventStatusSchema } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";

/**
 * Stand-in for an instant the files do not carry. Every event the queue writes
 * has `created` (the schema requires it), so this is reachable only for a file
 * dropped in by hand with the field missing — and listing such an event with an
 * unknown timestamp is better than dropping it from the console.
 */
export const UNKNOWN_INSTANT = "1970-01-01T00:00:00Z";

/**
 * Stand-in for `Job.type` when the projected event carries none. Every event the
 * queue writes is parsed with `QueueEventSchema` before it is projected, whose
 * `type` is a non-empty string — so, like {@link UNKNOWN_INSTANT}, this is
 * reachable only from a row written by hand. `JobSchema.type` is `min(1)`, and
 * naming the gap is better than emitting an empty string the contract rejects or
 * dropping the job from the console.
 */
export const UNKNOWN_EVENT_TYPE = "unknown";

/**
 * Payload keys that can name the document or thread a job came from, in the
 * order the console prefers them: a `comment.created` event names its thread,
 * and the thread is where "open in its home column" should land.
 */
const ORIGIN_KEYS = ["threadId", "parentId", "docId"] as const;

interface JobJoinRow {
  readonly event_id: string;
  readonly type: string;
  readonly status: string;
  readonly created: string | null;
  readonly payload_json: string;
  readonly blocked_on: string | null;
  readonly started: string | null;
  readonly updated: string | null;
  readonly last_line: string | null;
}

/**
 * Records one appended line against the console row, without re-reading the log
 * file: the write path already knows the line, and a job whose file has grown to
 * megabytes must not be re-read on every append.
 *
 * `started` is set once — the first line is when the job started talking — and
 * `status` is re-joined from `events` on every write, so the row can never
 * disagree with the queue about what state the job is in.
 */
export function recordJobLine(db: ProjectionDb, eventId: string, line: JobLogLine): void {
  db.prepare(
    `INSERT INTO jobs (event_id, status, started, updated, last_line)
     VALUES (?, (SELECT status FROM events WHERE id = ?), ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       status = (SELECT status FROM events WHERE id = jobs.event_id),
       started = COALESCE(jobs.started, excluded.started),
       updated = excluded.updated,
       last_line = excluded.last_line`,
  ).run(eventId, eventId, line.ts, line.ts, line.line);
}

/**
 * What a job came from: the id the console links through, and the label it
 * shows beside it.
 *
 * The title is read from the projection at response time rather than stored, so
 * a renamed document shows its new title on the next read. A thread origin
 * yields the *thread's* own title and a document origin the document's — both
 * are rows of `documents`, which every projected file gets, threads included.
 */
export interface JobOrigin {
  readonly id: string;
  readonly title: string;
}

/**
 * The current title of the document a job is blocked on, or `null` when the
 * corpus no longer holds it.
 *
 * Read at response time from the same row that proves the document exists — the
 * rule `originTitle` follows, so `blockedOnTitle` is null exactly when
 * `blockedOn` is null or its document is gone, and a renamed document shows its
 * new title on the next read (CONTRACT-021).
 */
function resolveBlockedOnTitle(db: ProjectionDb, blockedOn: string | null): string | null {
  if (blockedOn === null) return null;
  const row = db.prepare("SELECT title FROM documents WHERE id = ?").get(blockedOn) as
    { title: string } | undefined;
  return row?.title ?? null;
}

/**
 * The originating document or thread, resolved through the projection; `null`
 * when unknown.
 *
 * The title comes from the same row that proves the document exists, so the
 * response's `originTitle` is null exactly when its `originId` is — the rule
 * `JobSchema` writes down and UI-011's console reads.
 */
export function resolveOrigin(db: ProjectionDb, payloadJson: string): JobOrigin | null {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

  const record = payload as Record<string, unknown>;
  for (const key of ORIGIN_KEYS) {
    const candidate = record[key];
    if (typeof candidate !== "string") continue;
    if (!DocumentIdSchema.safeParse(candidate).success) continue;
    // Resolved through the projection: an id the corpus no longer holds is not a
    // link the console can offer, so it reads as "no origin" rather than a dead one.
    const row = db.prepare("SELECT title FROM documents WHERE id = ?").get(candidate) as
      { title: string } | undefined;
    if (row !== undefined) return { id: candidate, title: row.title };
  }
  return null;
}

function toJob(db: ProjectionDb, row: JobJoinRow): Job {
  const status = QueueEventStatusSchema.safeParse(row.status);
  const started = row.started ?? row.created ?? UNKNOWN_INSTANT;
  const origin = resolveOrigin(db, row.payload_json);
  return {
    eventId: row.event_id,
    // What kind of work this is, straight from the `events` mirror rather than
    // re-derived from the payload (CONTRACT-012): the queue already parsed the
    // event file, and the console's `<type> · <originTitle>` row is only honest
    // if it names the same type the queue does.
    type: row.type === "" ? UNKNOWN_EVENT_TYPE : row.type,
    // The directory a file sits in is the authority on its status, and that is
    // what the mirror recorded; an unrecognised value can only come from a
    // hand-made row, and `pending` is the harmless reading.
    status: status.success ? status.data : ("pending" satisfies QueueEventStatus),
    started,
    updated: row.updated ?? row.created ?? started,
    lastLine: row.last_line,
    originId: origin?.id ?? null,
    originTitle: origin?.title ?? null,
    // The document supplied at defer time (`DeferEventRequest.blockedOn`),
    // projected from the event file (SERVER-030). Non-null exactly while the
    // event sits in `deferred/`: every transition out of it strips the field
    // (`queue/service.ts`'s `stamp`), so the console can never show a finished
    // job still waiting for a lock.
    blockedOn: row.blocked_on,
    blockedOnTitle: resolveBlockedOnTitle(db, row.blocked_on),
  };
}

const SELECT_JOBS = `
  SELECT e.id AS event_id, e.type AS type, e.status AS status, e.created AS created,
         e.payload_json AS payload_json, e.blocked_on AS blocked_on,
         j.started AS started, j.updated AS updated, j.last_line AS last_line
  FROM events e
  LEFT JOIN jobs j ON j.event_id = e.id`;

/** Console rows, most recently active first. `recent` is already range-checked by the contract. */
export function listJobRows(db: ProjectionDb, recent: number): Job[] {
  const rows = db
    .prepare(
      // The id breaks ties so a page is stable across identical timestamps —
      // whole-second instants make ties ordinary, not exotic.
      `${SELECT_JOBS} ORDER BY COALESCE(j.updated, e.created) DESC, e.id DESC LIMIT ?`,
    )
    .all(recent) as JobJoinRow[];
  return rows.map((row) => toJob(db, row));
}

export function readJobRow(db: ProjectionDb, eventId: string): Job | undefined {
  const row = db.prepare(`${SELECT_JOBS} WHERE e.id = ?`).get(eventId) as JobJoinRow | undefined;
  return row === undefined ? undefined : toJob(db, row);
}
