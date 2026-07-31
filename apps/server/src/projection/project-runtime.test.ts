import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openProjection, type ProjectionDb } from "./db.js";
import {
  isEventFile,
  listQueueEventFiles,
  projectEvent,
  projectJob,
  projectJobsDir,
  projectLock,
  projectLocksDir,
  projectQueueDir,
  projectRuntime,
  projectSeen,
  removeEvent,
  removeJob,
  removeLock,
} from "./project-runtime.js";

let root: string;
let ws: string;
let corpusDir: string;
let db: ProjectionDb;

const EVENT = {
  id: "evt_abc123def456",
  type: "comment.created",
  created: "2026-07-06T09:00:00Z",
  source: "cli",
  payload: { threadId: "th_x9y8" },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-runtime-"));
  ws = join(root, "ws");
  corpusDir = join(ws, ".corpus");
  for (const status of QUEUE_EVENT_STATUSES) {
    mkdirSync(join(corpusDir, "queue", status), { recursive: true });
    // Every `init`-produced workspace keeps this so the skeleton survives a clone.
    writeFileSync(join(corpusDir, "queue", status, ".gitkeep"), "", "utf8");
  }
  mkdirSync(join(corpusDir, "jobs"), { recursive: true });
  mkdirSync(join(corpusDir, "locks"), { recursive: true });
  db = openProjection({ workspaceRoot: ws, corpusDir });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function writeJson(relative: string, value: unknown): void {
  const abs = join(corpusDir, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(value), "utf8");
}

describe("isEventFile", () => {
  it("counts only evt_*.json — never the queue skeleton's .gitkeep", () => {
    expect(isEventFile("evt_abc123.json")).toBe(true);
    expect(isEventFile(".gitkeep")).toBe(false);
    expect(isEventFile("evt_abc123.json.tmp")).toBe(false);
    expect(isEventFile("notes.json")).toBe(false);
  });
});

describe("projectQueueDir", () => {
  it("mirrors every status directory and ignores .gitkeep", () => {
    writeJson("queue/pending/evt_abc123def456.json", EVENT);
    writeJson("queue/processed/evt_zzz999888777.json", { ...EVENT, id: "evt_zzz999888777" });

    // Status-directory order, then filename order — deterministic either way.
    expect(listQueueEventFiles(corpusDir).map((file) => [file.status, file.name])).toEqual([
      ["pending", "evt_abc123def456.json"],
      ["processed", "evt_zzz999888777.json"],
    ]);
    expect(projectQueueDir(db, corpusDir)).toBe(2);
    expect(db.prepare("SELECT id, type, status, created FROM events ORDER BY id").all()).toEqual([
      {
        id: "evt_abc123def456",
        type: "comment.created",
        status: "pending",
        created: "2026-07-06T09:00:00Z",
      },
      {
        id: "evt_zzz999888777",
        type: "comment.created",
        status: "processed",
        created: "2026-07-06T09:00:00Z",
      },
    ]);
    expect(
      JSON.parse(
        String(
          (
            db.prepare("SELECT payload_json FROM events WHERE id = ?").get(EVENT.id) as {
              payload_json: string;
            }
          ).payload_json,
        ),
      ),
    ).toEqual({ threadId: "th_x9y8" });
  });

  it("keeps the fields the wire schema declares and drops on-disk bookkeeping", () => {
    writeJson("queue/failed/evt_abc123def456.json", {
      ...EVENT,
      status: "failed",
      attempts: 3,
      error: "boom",
    });
    projectQueueDir(db, corpusDir);
    // Status comes from the directory, never from a field inside the file.
    expect(db.prepare("SELECT status FROM events").get()).toEqual({ status: "failed" });
  });

  it("reads the blocking document off a deferred event file, and only that one", () => {
    // SERVER-030: `blocked_on` is the one piece of on-disk bookkeeping the
    // projection reads back, because `Job.blockedOn` is what the console shows
    // a waiting row waiting *for*.
    writeJson("queue/deferred/evt_abc123def456.json", {
      ...EVENT,
      status: "deferred",
      blockedOn: "doc_locked01",
      deferReason: "the user is editing it",
    });
    writeJson("queue/pending/evt_zzz999888777.json", { ...EVENT, id: "evt_zzz999888777" });

    expect(projectQueueDir(db, corpusDir)).toBe(2);
    expect(db.prepare("SELECT id, status, blocked_on FROM events ORDER BY id").all()).toEqual([
      { id: "evt_abc123def456", status: "deferred", blocked_on: "doc_locked01" },
      { id: "evt_zzz999888777", status: "pending", blocked_on: null },
    ]);
  });

  it("projects an event whose blockedOn is unusable rather than losing it", () => {
    // A field only a deferral reads must never be the reason an event vanishes
    // from the console.
    writeJson("queue/deferred/evt_abc123def456.json", { ...EVENT, blockedOn: "nonsense" });

    expect(projectQueueDir(db, corpusDir)).toBe(1);
    expect(db.prepare("SELECT id, blocked_on FROM events").get()).toEqual({
      id: EVENT.id,
      blocked_on: null,
    });
  });

  it("clears the blocking document when the event is re-projected out of deferred/", () => {
    projectEvent(db, EVENT, "deferred", "doc_locked01");
    expect(db.prepare("SELECT blocked_on FROM events").get()).toEqual({
      blocked_on: "doc_locked01",
    });

    projectEvent(db, EVENT, "pending");

    // An `ON CONFLICT` clause that only ever *set* the column would leave a
    // running job still claiming to be waiting for a lock.
    expect(db.prepare("SELECT blocked_on FROM events").get()).toEqual({ blocked_on: null });
  });

  it("skips unreadable and malformed event files without failing the pass", () => {
    writeFileSync(join(corpusDir, "queue", "pending", "evt_bad000000000.json"), "{oops", "utf8");
    writeJson("queue/pending/evt_shape00000.json", { id: "evt_shape00000" });
    writeJson("queue/pending/evt_abc123def456.json", EVENT);

    expect(projectQueueDir(db, corpusDir)).toBe(1);
    expect(db.prepare("SELECT id FROM events").all()).toEqual([{ id: EVENT.id }]);
  });

  it("upserts and deletes single events for the queue's transitions", () => {
    projectEvent(db, EVENT, "pending");
    projectEvent(db, EVENT, "in-progress");
    expect(db.prepare("SELECT status FROM events").get()).toEqual({ status: "in-progress" });
    removeEvent(db, EVENT.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 0 });
  });

  it("treats a workspace with no queue directories as an empty mirror", () => {
    rmSync(join(corpusDir, "queue"), { recursive: true, force: true });
    expect(projectQueueDir(db, corpusDir)).toBe(0);
  });
});

describe("projectJobsDir", () => {
  const log = (lines: { ts: string; line: string }[]): string =>
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;

  it("summarizes each job's log and joins its status from the event mirror", () => {
    writeJson("queue/in-progress/evt_abc123def456.json", EVENT);
    projectQueueDir(db, corpusDir);
    writeFileSync(
      join(corpusDir, "jobs", `${EVENT.id}.jsonl`),
      log([
        { ts: "2026-07-06T09:00:01Z", line: "starting" },
        { ts: "2026-07-06T09:00:09Z", line: "reading the thread" },
      ]),
      "utf8",
    );

    expect(projectJobsDir(db, corpusDir)).toBe(1);
    expect(db.prepare("SELECT * FROM jobs").get()).toEqual({
      event_id: EVENT.id,
      status: "in-progress",
      started: "2026-07-06T09:00:01Z",
      updated: "2026-07-06T09:00:09Z",
      last_line: "reading the thread",
    });
  });

  it("ignores blank and malformed log lines, and files that are not job logs", () => {
    writeFileSync(
      join(corpusDir, "jobs", `${EVENT.id}.jsonl`),
      `\nnot json\n${JSON.stringify({ nope: 1 })}\n${JSON.stringify({ ts: "2026-07-06T09:00:03Z", line: "real" })}\n`,
      "utf8",
    );
    writeFileSync(join(corpusDir, "jobs", "README.txt"), "hello", "utf8");

    expect(projectJobsDir(db, corpusDir)).toBe(1);
    expect(db.prepare("SELECT status, last_line FROM jobs").get()).toEqual({
      status: null,
      last_line: "real",
    });
  });

  it("projects an empty summary for a job with no log file yet, and deletes on demand", () => {
    projectJob(db, corpusDir, EVENT.id);
    expect(db.prepare("SELECT * FROM jobs").get()).toEqual({
      event_id: EVENT.id,
      status: null,
      started: null,
      updated: null,
      last_line: null,
    });
    removeJob(db, EVENT.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 0 });
  });
});

describe("projectLocksDir", () => {
  // Fixed lease, fixed clock: a lock's row exists only while its lease runs, so
  // every assertion here has to say *when* it is being read (SPEC.md §7).
  const ACQUIRED = "2026-07-06T09:00:00Z";
  const LEASE_START = Date.parse(ACQUIRED);
  const LOCK = { docId: "doc_a1b2c3", holder: "agent", acquired: ACQUIRED, ttl: 300 };
  const DURING_LEASE = LEASE_START + 60_000;
  const AFTER_LEASE = LEASE_START + 301_000;

  it("projects every live lock file", () => {
    writeJson("locks/doc_a1b2c3.json", LOCK);
    expect(projectLocksDir(db, corpusDir, DURING_LEASE)).toBe(1);
    expect(db.prepare("SELECT * FROM locks").get()).toEqual({
      doc_id: "doc_a1b2c3",
      holder: "agent",
      acquired: ACQUIRED,
      ttl: 300,
    });
  });

  it("drops an expired lease even though its file is still there", () => {
    writeJson("locks/doc_a1b2c3.json", LOCK);
    // Expiry is evaluated on read, everywhere: a lease that has run out refuses
    // nothing, so a banner drawn from this table would be a lie.
    expect(projectLocksDir(db, corpusDir, AFTER_LEASE)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });

    projectLock(db, corpusDir, "doc_a1b2c3", DURING_LEASE);
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 1 });
    projectLock(db, corpusDir, "doc_a1b2c3", AFTER_LEASE);
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });
  });

  it("drops a lock whose file became malformed or disappeared", () => {
    projectLock(db, corpusDir, "doc_a1b2c3");
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });

    writeJson("locks/doc_a1b2c3.json", LOCK);
    projectLock(db, corpusDir, "doc_a1b2c3", DURING_LEASE);
    writeFileSync(join(corpusDir, "locks", "doc_a1b2c3.json"), '{"holder":"nobody"}', "utf8");
    projectLock(db, corpusDir, "doc_a1b2c3", DURING_LEASE);
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });
  });

  it("keys the row by the filename, so a disagreeing `docId` field cannot strand it", () => {
    // SERVER-022 finding 9. The row was inserted under the lock file's *own*
    // `docId` field while every removal — the watcher's unlink, `projectLock`'s
    // own miss path, `removeLock` — addresses it by the filename. A file whose
    // two disagree therefore inserted one row and deleted another, and the
    // orphan made its document render read-only forever, naming a holder that
    // had released. `locks/store.ts` already corrects exactly this on the
    // service path.
    writeJson("locks/doc_a1b2c3.json", { ...LOCK, docId: "doc_someother" });

    projectLock(db, corpusDir, "doc_a1b2c3", DURING_LEASE);
    expect(db.prepare("SELECT doc_id FROM locks").all()).toEqual([{ doc_id: "doc_a1b2c3" }]);

    // Released: the file goes, and the row goes with it.
    rmSync(join(corpusDir, "locks", "doc_a1b2c3.json"));
    projectLock(db, corpusDir, "doc_a1b2c3", DURING_LEASE);
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });
  });

  it("rebuilds the directory under filename ids too", () => {
    writeJson("locks/doc_a1b2c3.json", { ...LOCK, docId: "doc_someother" });

    expect(projectLocksDir(db, corpusDir, DURING_LEASE)).toBe(1);
    expect(db.prepare("SELECT doc_id FROM locks").all()).toEqual([{ doc_id: "doc_a1b2c3" }]);
    // And the id the API addresses is the one that removes it.
    removeLock(db, "doc_a1b2c3");
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });
  });

  it("ignores files that are not <docId>.json and supports explicit removal", () => {
    writeFileSync(join(corpusDir, "locks", "notes.json"), "{}", "utf8");
    writeJson("locks/doc_a1b2c3.json", LOCK);
    expect(projectLocksDir(db, corpusDir, DURING_LEASE)).toBe(1);
    removeLock(db, "doc_a1b2c3");
    expect(db.prepare("SELECT COUNT(*) AS n FROM locks").get()).toEqual({ n: 0 });
  });
});

describe("projectSeen", () => {
  it("projects the flat thread-id → instant map", () => {
    writeJson("seen.json", {
      th_x9y8: "2026-07-06T09:00:00Z",
      th_aaa: "2026-07-05T08:00:00.000Z",
      "not-a-thread": "2026-07-06T09:00:00Z",
      th_bad: 42,
      th_nots: "yesterday",
    });
    expect(projectSeen(db, corpusDir)).toBe(2);
    expect(db.prepare("SELECT * FROM seen ORDER BY thread_id").all()).toEqual([
      { thread_id: "th_aaa", last_seen_ts: "2026-07-05T08:00:00Z" },
      { thread_id: "th_x9y8", last_seen_ts: "2026-07-06T09:00:00Z" },
    ]);
  });

  it("projects an empty table when the file is missing, unreadable or the wrong shape", () => {
    expect(projectSeen(db, corpusDir)).toBe(0);

    writeFileSync(join(corpusDir, "seen.json"), "[1,2,3]", "utf8");
    expect(projectSeen(db, corpusDir)).toBe(0);

    writeFileSync(join(corpusDir, "seen.json"), "{oops", "utf8");
    expect(projectSeen(db, corpusDir)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM seen").get()).toEqual({ n: 0 });
  });
});

describe("projectRuntime", () => {
  it("projects events, jobs, locks and seen in one pass", () => {
    writeJson("queue/pending/evt_abc123def456.json", EVENT);
    writeFileSync(
      join(corpusDir, "jobs", `${EVENT.id}.jsonl`),
      `${JSON.stringify({ ts: "2026-07-06T09:00:01Z", line: "go" })}\n`,
      "utf8",
    );
    // A live lease: `projectRuntime` reads the wall clock, and only a lock that
    // has not expired earns a row (SPEC.md §7).
    writeJson("locks/doc_a1b2c3.json", {
      docId: "doc_a1b2c3",
      holder: "user",
      acquired: `${new Date().toISOString().slice(0, 19)}Z`,
      ttl: 300,
    });
    writeJson("seen.json", { th_x9y8: "2026-07-06T09:00:00Z" });

    expect(projectRuntime(db)).toEqual({ events: 1, jobs: 1, locks: 1, seen: 1 });
    // `jobs` joins the status the events pass just wrote — order matters.
    expect(db.prepare("SELECT status FROM jobs").get()).toEqual({ status: "pending" });
  });
});
