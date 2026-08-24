// The console's rows: the `jobs` table joined with the `events` mirror
// (SPEC.md §7, §9.1).
//
// **`status` is joined from `events`, never read from the log file** (the
// SERVER-004 handoff, pinned): the log carries lines, the queue carries state.
// A row therefore exists for every event — a job that never logged shows an
// empty last line rather than disappearing from the console.

import type { Job, JobList, JobLogLine, QueueEventStatus } from "@corpus/contract";
import { DocumentIdSchema, QueueEventStatusSchema } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";

/**
 * Stand-in for an instant the files do not carry — `Job.enqueued`, which the
 * contract requires and `events.created` supplies. Every event the queue writes
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
 * when unknown. Reads the payload from its stored JSON — the projection's
 * `events.payload_json` column.
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
  return resolveOriginFromPayload(db, payload);
}

/**
 * The same rule, for a caller that already holds the parsed payload: the queue's
 * in-progress report (SERVER-061) reads event files, not projection rows, and
 * re-serialising a payload only to parse it back would be a round-trip in
 * service of nothing.
 *
 * This is the one place the rule lives. "Where did this event come from" must
 * have exactly one answer wherever it is asked, or the console row and the
 * reconciliation row disagree for no reason (SERVER-056) — hence a shared
 * function rather than a second walk over {@link ORIGIN_KEYS}.
 */
export function resolveOriginFromPayload(db: ProjectionDb, payload: unknown): JobOrigin | null {
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

/**
 * **`enqueued` and `started` are two instants and neither stands in for the
 * other** (CONTRACT-029). `started` used to be `row.started ?? row.created`, so
 * a job that had not spoken reported its enqueue instant under the name of its
 * start and a display counting elapsed time reset the moment the agent began
 * talking. The columns were always separate — `events.created` is the enqueue,
 * `jobs.started` is the first log line and is NULL for exactly the jobs that
 * have written none — and nothing new is computed here: the coalesce was the
 * whole bug, and removing it is the whole fix.
 */
function toJob(db: ProjectionDb, row: JobJoinRow): Job {
  const status = QueueEventStatusSchema.safeParse(row.status);
  const enqueued = row.created ?? UNKNOWN_INSTANT;
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
    enqueued,
    // Null until the job writes its first line — `pending`, and claimed but
    // still silent, both read null rather than borrowing `enqueued`.
    started: row.started,
    // The newest line's instant, falling back to `enqueued` for a job that has
    // written none. Never to `started`, which is null in exactly that case.
    updated: row.updated ?? enqueued,
    lastLine: row.last_line,
    originId: origin?.id ?? null,
    originTitle: origin?.title ?? null,
    // The document supplied at defer time (`DeferEventRequest.blockedOn`),
    // projected from the event file (SERVER-030). Non-null exactly while the
    // event sits in `deferred/`: every transition out of it strips the field
    // (`queue/service.ts`'s `stamp`), so the console can never show a finished
    // job still waiting on a document.
    blockedOn: row.blocked_on,
    blockedOnTitle: resolveBlockedOnTitle(db, row.blocked_on),
  };
}

/**
 * The rows a console query is over, named once so the page and its count cannot
 * be taken from different sets. `total` is *"counted over the same filters the
 * array was selected with"* (CONTRACT-035), and the only way to keep that true
 * as filters are added is for both statements to share their `FROM`.
 */
const FROM_JOBS = `
  FROM events e
  LEFT JOIN jobs j ON j.event_id = e.id`;

const SELECT_JOBS = `
  SELECT e.id AS event_id, e.type AS type, e.status AS status, e.created AS created,
         e.payload_json AS payload_json, e.blocked_on AS blocked_on,
         j.started AS started, j.updated AS updated, j.last_line AS last_line
  ${FROM_JOBS}`;

/** The same rows, counted rather than shaped — the `LIMIT` deliberately absent. */
const COUNT_JOBS = `SELECT COUNT(*) AS total ${FROM_JOBS}`;

/**
 * `resolveOrigin`'s rule, spelled in SQL so a filter can be a `WHERE`.
 *
 * `originId` is not a column — it is derived per response by walking
 * {@link ORIGIN_KEYS} in preference order and taking the **first key whose value
 * names a document the corpus still holds**. Both halves matter, and a
 * `COALESCE` over the three keys would get the second one wrong: a payload whose
 * `threadId` names a deleted thread but whose `parentId` names a live document
 * resolves to the *parent*, where `COALESCE` would stop at the dead thread and
 * the filter would disagree with the field it filters on.
 *
 * Built from `ORIGIN_KEYS` rather than written out, so adding a key cannot leave
 * the filter behind — the drift SERVER-056 exists to prevent.
 */
const ORIGIN_ID_SQL = `CASE ${ORIGIN_KEYS.map(
  (key) =>
    `WHEN json_extract(e.payload_json, '$.${key}') IN (SELECT id FROM documents) ` +
    `THEN json_extract(e.payload_json, '$.${key}')`,
).join(" ")} END`;

/** The console's order: most recently active first, id breaking ties. */
const ORDER_JOBS = "ORDER BY COALESCE(j.updated, e.created) DESC, e.id DESC";

export interface JobFilter {
  /** Restrict to jobs whose resolved origin is this document (CONTRACT-030). */
  readonly originId?: string | undefined;
  /** Restrict to these statuses; empty/absent means every status. */
  readonly status?: readonly QueueEventStatus[] | undefined;
}

/**
 * Console rows, most recently active first. `recent` is already range-checked by
 * the contract.
 *
 * **`recent` bounds the console list only.** Once `originId` is given the answer
 * is complete, because the question has changed: "what has the queue been doing"
 * is unbounded and wants a window, while "is anything outstanding on this
 * document" must be answered completely or it is not an answer. A windowed
 * predicate fails silently and in one direction — a job pushed out by unrelated
 * churn looks exactly like no job — which is how a deferred job's "working…" row
 * used to disappear while its reply was still coming (CONTRACT-030). One
 * document's jobs are bounded by its own history, so nothing here needs the cap.
 */
export function listJobPage(db: ProjectionDb, recent: number, filter: JobFilter = {}): JobList {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.originId !== undefined) {
    clauses.push(`${ORIGIN_ID_SQL} = ?`);
    params.push(filter.originId);
  }
  if (filter.status !== undefined && filter.status.length > 0) {
    clauses.push(`e.status IN (${filter.status.map(() => "?").join(", ")})`);
    params.push(...filter.status);
  }

  const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
  // The unfiltered path keeps its `LIMIT ?` exactly as it was, ordering and
  // tie-break included; the filtered one drops it rather than raising it.
  const complete = filter.originId !== undefined;

  const rows = db
    .prepare(`${SELECT_JOBS}${where} ${ORDER_JOBS}${complete ? "" : " LIMIT ?"}`)
    .all(...(complete ? params : [...params, recent])) as JobJoinRow[];
  const jobs = rows.map((row) => toJob(db, row));

  // **The count is skipped exactly when it could not differ.** A query that
  // dropped the window selected every row its `WHERE` matches, so `jobs.length`
  // *is* the count — not an assumption about it — and re-running `ORIGIN_ID_SQL`
  // (a `json_extract` per key against a subquery over `documents`) to be told the
  // number already in hand would double the most expensive filter's cost. Every
  // windowed query counts for real, because that is the one case where the page
  // and the set can disagree.
  const total = complete
    ? jobs.length
    : (db.prepare(`${COUNT_JOBS}${where}`).get(...params) as { readonly total: number }).total;

  // Derived from the two, never guessed from `jobs.length === recent`: a set of
  // exactly `recent` rows is complete, and a caller told otherwise would go
  // looking for a page that is not there.
  return { jobs, total, truncated: total > jobs.length };
}

export function readJobRow(db: ProjectionDb, eventId: string): Job | undefined {
  const row = db.prepare(`${SELECT_JOBS} WHERE e.id = ?`).get(eventId) as JobJoinRow | undefined;
  return row === undefined ? undefined : toJob(db, row);
}
