import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobSchema } from "@corpus/contract";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import { createQueueService, type QueueService } from "../queue/index.js";
import {
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
    // console row on its own, with nothing appended to the file.
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
      status: "pending",
      started: "2026-07-27T09:02:00Z",
      updated: "2026-07-27T09:02:00Z",
      lastLine: "worked on it",
      originId: THREAD,
      originTitle: THREAD_TITLE,
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
});
