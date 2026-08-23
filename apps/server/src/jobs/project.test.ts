import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RECENT_JOBS, JobSchema } from "@corpus/contract";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import { createQueueService, type QueueService } from "../queue/index.js";
import {
  UNKNOWN_EVENT_TYPE,
  UNKNOWN_INSTANT,
  listJobRows,
  readJobRow,
  recordJobLine,
  resolveOrigin,
} from "./project.js";

const DOC = "doc_a1b2c3";
const DOC_TITLE = "Mortgage options";
const THREAD = "th_x9y8";
const THREAD_TITLE = 'Re: "a 30-year fixed at 6.1%"';
const START = Date.parse("2026-07-27T09:00:00Z");

let ws: Workspace;
let queue: QueueService;
let clock: number;

const enqueue = async (payload: Record<string, unknown>): Promise<string> =>
  (await queue.enqueue({ type: "comment.created", source: "ui", payload })).id;

beforeEach(() => {
  ws = createWorkspace("s009-jobproject");
  ws.doc({ id: DOC, title: DOC_TITLE });
  ws.thread({ id: THREAD, parent: DOC, title: THREAD_TITLE });
  ws.reproject();
  clock = START;
  queue = createQueueService({
    corpusDir: ws.config.corpusDir,
    mirror: createProjectionQueueMirror(ws.db),
    now: () => clock,
  });
});

afterEach(() => {
  queue.close();
  ws.close();
});

describe("resolveOrigin", () => {
  it("prefers the thread, then the parent, then the document — each with its own title", () => {
    // A thread origin is labelled by the *thread's* title, not its parent's:
    // "Re: …" is what the console row has to read, or two comments on one
    // document would be indistinguishable.
    expect(resolveOrigin(ws.db, JSON.stringify({ threadId: THREAD, parentId: DOC }))).toEqual({
      id: THREAD,
      title: THREAD_TITLE,
    });
    expect(resolveOrigin(ws.db, JSON.stringify({ parentId: DOC }))).toEqual({
      id: DOC,
      title: DOC_TITLE,
    });
    expect(resolveOrigin(ws.db, JSON.stringify({ docId: DOC }))).toEqual({
      id: DOC,
      title: DOC_TITLE,
    });
  });

  it("reads an unresolvable, absent or malformed origin as none", () => {
    // Resolved *through the projection*: an id the corpus no longer holds is not
    // a link the console can offer.
    expect(resolveOrigin(ws.db, JSON.stringify({ threadId: "th_gone0000" }))).toBeNull();
    expect(resolveOrigin(ws.db, JSON.stringify({ threadId: "not-an-id" }))).toBeNull();
    expect(resolveOrigin(ws.db, JSON.stringify({ threadId: 42 }))).toBeNull();
    expect(resolveOrigin(ws.db, JSON.stringify({}))).toBeNull();
    expect(resolveOrigin(ws.db, JSON.stringify([1, 2]))).toBeNull();
    expect(resolveOrigin(ws.db, "{not json")).toBeNull();
  });

  it("falls through a payload whose preferred id no longer resolves", () => {
    expect(
      resolveOrigin(ws.db, JSON.stringify({ threadId: "th_gone0000", parentId: DOC })),
    ).toEqual({ id: DOC, title: DOC_TITLE });
  });

  it("follows a rename: the title is read at response time, never stored", async () => {
    const id = await enqueue({ threadId: THREAD });
    expect(readJobRow(ws.db, id)?.originTitle).toBe(THREAD_TITLE);

    ws.thread({ id: THREAD, parent: DOC, title: "Renamed after the job ran" });
    ws.reproject();

    expect(readJobRow(ws.db, id)?.originTitle).toBe("Renamed after the job ran");
  });
});

describe("recordJobLine", () => {
  it("sets `started` once, moves `updated`, and joins the status from the events mirror", async () => {
    const id = await enqueue({ threadId: THREAD });

    recordJobLine(ws.db, id, { ts: "2026-07-27T09:00:01Z", line: "first" });
    recordJobLine(ws.db, id, { ts: "2026-07-27T09:00:05Z", line: "second" });

    expect(ws.db.prepare("SELECT * FROM jobs").get()).toEqual({
      event_id: id,
      status: "pending",
      started: "2026-07-27T09:00:01Z",
      updated: "2026-07-27T09:00:05Z",
      last_line: "second",
    });

    // The status follows the queue, never the log: failing the event ages the
    // console row on its own, with nothing appended to the file. Claimed first,
    // because a settle is defined for claimed work only (SERVER-145).
    await queue.claimAll();
    await queue.fail(id, "boom");
    expect(ws.db.prepare("SELECT status, last_line FROM jobs").get()).toEqual({
      status: "failed",
      last_line: "second",
    });
  });
});

describe("listJobRows", () => {
  it("returns the contract's row, most recently active first", async () => {
    const older = await enqueue({ threadId: THREAD });
    clock += 60_000;
    const newer = await enqueue({});
    recordJobLine(ws.db, older, { ts: "2026-07-27T09:02:00Z", line: "worked on it" });

    const rows = listJobRows(ws.db, 50);

    expect(rows.map((row) => JobSchema.parse(row))).toEqual(rows);
    expect(rows.map((row) => row.eventId)).toEqual([older, newer]);
    expect(rows[0]).toEqual({
      eventId: older,
      // The event's own type, from the `events` mirror — what the console's
      // `<type> · <originTitle>` row says the job actually is (CONTRACT-012).
      type: "comment.created",
      status: "pending",
      started: "2026-07-27T09:02:00Z",
      updated: "2026-07-27T09:02:00Z",
      lastLine: "worked on it",
      originId: THREAD,
      originTitle: THREAD_TITLE,
      // Null on a job that is not `deferred`, which `JobSchema` requires
      // (CONTRACT-021); the deferred case is its own describe below.
      blockedOn: null,
      blockedOnTitle: null,
    });
    // A job that never logged is still a job: an empty last line, dated by the
    // event itself, and no origin when the payload names none — and then the
    // title is null too, which is the contract's rule ("null exactly when
    // `originId` is null").
    expect(rows[1]).toMatchObject({
      lastLine: null,
      originId: null,
      originTitle: null,
      started: "2026-07-27T09:01:00Z",
    });
  });

  it("honours the requested count", async () => {
    for (let index = 0; index < 3; index += 1) {
      clock += 1000;
      await enqueue({});
    }

    expect(listJobRows(ws.db, 1)).toHaveLength(1);
    expect(listJobRows(ws.db, 50)).toHaveLength(3);
  });

  it("lists no row for a `.gitkeep` — only `evt_*.json` is an event", async () => {
    ws.write(".corpus/queue/pending/.gitkeep", "");
    await enqueue({});

    expect(listJobRows(ws.db, 50)).toHaveLength(1);
  });
});

/**
 * SERVER-056 / CONTRACT-030. The console asks "what has the queue been doing";
 * two callers ask "is anything still outstanding on *this* document". The second
 * question used to be answered by scanning the first one's answer, which put it
 * inside a recency window — and the failure was silent and one-directional.
 */
describe("listJobRows filtered to one document", () => {
  const bury = async (count: number): Promise<void> => {
    for (let index = 0; index < count; index += 1) {
      clock += 1000;
      await enqueue({ docId: DOC });
    }
  };

  it("returns a match buried behind more than a full console window", async () => {
    const wanted = await enqueue({ threadId: THREAD });
    await bury(DEFAULT_RECENT_JOBS + 10);

    // The console cannot see it any more — that is the bug, reproduced.
    expect(listJobRows(ws.db, DEFAULT_RECENT_JOBS).map((row) => row.eventId)).not.toContain(wanted);
    // The predicate can, and `recent` no longer bounds the answer.
    expect(listJobRows(ws.db, DEFAULT_RECENT_JOBS, { originId: THREAD }).map((r) => r.eventId)) //
      .toEqual([wanted]);
  });

  it("still finds a deferred job whose `updated` stopped advancing (the reported case)", async () => {
    const deferred = await enqueue({ threadId: THREAD });
    await queue.claimAll();
    await queue.defer(deferred, { blockedOn: DOC });
    // The user keeps editing; the rest of the queue moves on for a long time.
    await bury(DEFAULT_RECENT_JOBS + 5);

    const outstanding = listJobRows(ws.db, DEFAULT_RECENT_JOBS, {
      originId: THREAD,
      status: ["pending", "in-progress", "deferred"],
    });

    expect(outstanding.map((row) => row.eventId)).toEqual([deferred]);
    expect(outstanding[0]?.status).toBe("deferred");
    expect(outstanding[0]?.blockedOn).toBe(DOC);
  });

  it("agrees with resolveOrigin when the preferred key names a deleted document", async () => {
    // `threadId` is preferred, but it names nothing the corpus holds, so the
    // origin — and therefore the filter — falls through to the parent.
    const id = await enqueue({ threadId: "th_gone0000", parentId: DOC });

    expect(
      resolveOrigin(ws.db, JSON.stringify({ threadId: "th_gone0000", parentId: DOC })),
    ).toEqual({ id: DOC, title: DOC_TITLE });
    expect(listJobRows(ws.db, 50, { originId: DOC }).map((row) => row.eventId)).toEqual([id]);
    expect(listJobRows(ws.db, 50, { originId: "th_gone0000" })).toEqual([]);
  });

  it("keeps the thread's own jobs apart from its parent's", async () => {
    const onThread = await enqueue({ threadId: THREAD, parentId: DOC });
    clock += 1000;
    const onDoc = await enqueue({ docId: DOC });

    expect(listJobRows(ws.db, 50, { originId: THREAD }).map((row) => row.eventId)).toEqual([
      onThread,
    ]);
    expect(listJobRows(ws.db, 50, { originId: DOC }).map((row) => row.eventId)).toEqual([onDoc]);
  });

  it("filters by status alone without dropping the console's window", async () => {
    const failed = await enqueue({ docId: DOC });
    await queue.claimAll();
    await queue.fail(failed, "boom");
    clock += 1000;
    await enqueue({ docId: DOC });

    expect(listJobRows(ws.db, 50, { status: ["failed"] }).map((row) => row.eventId)).toEqual([
      failed,
    ]);
    // Status without an origin is still the console's list, so `recent` applies.
    expect(listJobRows(ws.db, 1, { status: ["failed", "pending"] })).toHaveLength(1);
  });

  it("returns nothing rather than everything for an origin with no jobs", async () => {
    await enqueue({ docId: DOC });

    expect(listJobRows(ws.db, 50, { originId: "doc_nothing1" })).toEqual([]);
  });

  it("leaves the unfiltered query's ordering and tie-break untouched", async () => {
    const older = await enqueue({ threadId: THREAD });
    clock += 60_000;
    const newer = await enqueue({});
    // A log line moves `updated`, so the *older* event becomes the most recently
    // active one — the console orders by activity, not by creation, and that is
    // the part an added `WHERE` must not disturb.
    recordJobLine(ws.db, older, { ts: "2026-07-27T09:02:00Z", line: "worked on it" });

    expect(listJobRows(ws.db, 50).map((row) => row.eventId)).toEqual([older, newer]);
    expect(listJobRows(ws.db, 50, {}).map((row) => row.eventId)).toEqual([older, newer]);
  });
});

describe("readJobRow", () => {
  it("reads one row, and nothing for an unknown event", async () => {
    const id = await enqueue({ parentId: DOC });

    expect(readJobRow(ws.db, id)).toMatchObject({
      eventId: id,
      originId: DOC,
      originTitle: DOC_TITLE,
      lastLine: null,
    });
    expect(readJobRow(ws.db, "evt_nothing00")).toBeUndefined();
  });

  it("dates a row that carries no instant anywhere rather than dropping it", () => {
    // Only reachable for a hand-made row: every event the queue writes carries
    // `created`, which the schema requires.
    ws.db
      .prepare("INSERT INTO events (id, type, status, created, payload_json) VALUES (?,?,?,?,?)")
      .run("evt_handmade0", "comment.created", "pending", null, "{}");

    expect(readJobRow(ws.db, "evt_handmade0")).toMatchObject({
      started: UNKNOWN_INSTANT,
      updated: UNKNOWN_INSTANT,
    });
  });

  it("reads an unrecognised status as pending rather than serving an invalid shape", () => {
    ws.db
      .prepare("INSERT INTO events (id, type, status, created, payload_json) VALUES (?,?,?,?,?)")
      .run("evt_weird0000", "comment.created", "sideways", "2026-07-27T09:00:00Z", "{}");

    const row = readJobRow(ws.db, "evt_weird0000");

    expect(row?.status).toBe("pending");
    expect(JobSchema.parse(row)).toEqual(row);
  });

  it("carries an event type this build has never heard of through untouched", () => {
    // `Job.type` is open rather than enumerated for exactly this reason: the
    // console must name the work as the event named it, not fall back to a core
    // type (SPEC.md §7, CONTRACT-012).
    ws.db
      .prepare("INSERT INTO events (id, type, status, created, payload_json) VALUES (?,?,?,?,?)")
      .run("evt_unknown000", "errands.rollup", "pending", "2026-07-27T09:00:00Z", "{}");

    const row = readJobRow(ws.db, "evt_unknown000");

    expect(row?.type).toBe("errands.rollup");
    expect(JobSchema.parse(row)).toEqual(row);
  });

  it("names an untyped hand-made row rather than serving a shape the contract rejects", () => {
    // Unreachable through the queue — `QueueEventSchema.type` is `min(1)` — but
    // `JobSchema.type` is too, so an empty column must not reach the wire.
    ws.db
      .prepare("INSERT INTO events (id, type, status, created, payload_json) VALUES (?,?,?,?,?)")
      .run("evt_untyped00", "", "pending", "2026-07-27T09:00:00Z", "{}");

    const row = readJobRow(ws.db, "evt_untyped00");

    expect(row?.type).toBe(UNKNOWN_EVENT_TYPE);
    expect(JobSchema.parse(row)).toEqual(row);
  });
});

describe("a deferred job (SERVER-030)", () => {
  const deferOn = async (docId: string): Promise<string> => {
    const id = await enqueue({ threadId: THREAD });
    await queue.claimAll();
    await queue.defer(id, { blockedOn: docId, deferReason: "the user is editing it" });
    return id;
  };

  it("names the document it is waiting for, and that document's current title", async () => {
    const id = await deferOn(DOC);

    const row = readJobRow(ws.db, id);

    expect(row).toMatchObject({
      status: "deferred",
      blockedOn: DOC,
      blockedOnTitle: DOC_TITLE,
      // The origin is still where the work came *from*; the blocking document
      // is a different question and usually a different row.
      originId: THREAD,
      originTitle: THREAD_TITLE,
    });
    expect(JobSchema.parse(row)).toEqual(row);
  });

  it("follows a rename of the blocking document, read at response time", async () => {
    const id = await deferOn(DOC);

    ws.db.prepare("UPDATE documents SET title = ? WHERE id = ?").run("Refinancing", DOC);

    expect(readJobRow(ws.db, id)?.blockedOnTitle).toBe("Refinancing");
  });

  it("reports a null title for a blocking document the corpus no longer holds", async () => {
    const id = await deferOn(DOC);

    ws.db.prepare("DELETE FROM documents WHERE id = ?").run(DOC);

    // The same rule `originTitle` follows: the id is still what the deferral
    // named, and a title nobody can read is null rather than invented.
    expect(readJobRow(ws.db, id)).toMatchObject({ blockedOn: DOC, blockedOnTitle: null });
  });

  it("clears both fields the moment the event leaves deferred/", async () => {
    const id = await deferOn(DOC);

    await queue.requeueDeferredFor(DOC);

    expect(readJobRow(ws.db, id)).toMatchObject({
      status: "pending",
      blockedOn: null,
      blockedOnTitle: null,
    });
  });
});
