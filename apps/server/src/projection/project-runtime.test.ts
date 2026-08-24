import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { QUEUE_EVENT_STATUSES } from "@corpus/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogFields, Logger } from "../logger.js";
import { openProjection, type ProjectionDb } from "./db.js";
import {
  isEventFile,
  listQueueEventFiles,
  projectEvent,
  projectJob,
  projectJobsDir,
  projectQueueDir,
  projectRuntime,
  projectSeen,
  removeEvent,
  removeJob,
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
    expect(listQueueEventFiles(corpusDir).files.map((file) => [file.status, file.name])).toEqual([
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
      blockedOn: "doc_edited01",
      deferReason: "the user is editing it",
    });
    writeJson("queue/pending/evt_zzz999888777.json", { ...EVENT, id: "evt_zzz999888777" });

    expect(projectQueueDir(db, corpusDir)).toBe(2);
    expect(db.prepare("SELECT id, status, blocked_on FROM events ORDER BY id").all()).toEqual([
      { id: "evt_abc123def456", status: "deferred", blocked_on: "doc_edited01" },
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
    projectEvent(db, EVENT, "deferred", "doc_edited01");
    expect(db.prepare("SELECT blocked_on FROM events").get()).toEqual({
      blocked_on: "doc_edited01",
    });

    projectEvent(db, EVENT, "pending");

    // An `ON CONFLICT` clause that only ever *set* the column would leave a
    // running job still claiming to be waiting on a document.
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
  it("projects events, jobs and seen in one pass", () => {
    writeJson("queue/pending/evt_abc123def456.json", EVENT);
    writeFileSync(
      join(corpusDir, "jobs", `${EVENT.id}.jsonl`),
      `${JSON.stringify({ ts: "2026-07-06T09:00:01Z", line: "go" })}\n`,
      "utf8",
    );
    writeJson("seen.json", { th_x9y8: "2026-07-06T09:00:00Z" });

    expect(projectRuntime(db)).toEqual({ events: 1, jobs: 1, seen: 1 });
    // `jobs` joins the status the events pass just wrote — order matters.
    expect(db.prepare("SELECT status FROM jobs").get()).toEqual({ status: "pending" });
  });
});

/**
 * SERVER-065. `listFiles` carried no comment and no distinction: it answered the
 * empty list both for a directory that does not exist — the ordinary state of a
 * workspace that has enqueued nothing — and for one the process cannot read,
 * which means `events` or `jobs` is short by however many files are in there.
 *
 * Provoked with `ENOTDIR`, which holds for every user including root, rather
 * than with a mode a privileged process ignores.
 */
describe("a runtime directory that cannot be listed (SERVER-065)", () => {
  type Line = { readonly message: string; readonly fields: LogFields | undefined };

  const capturing = (): { logger: Logger; errors: Line[] } => {
    const errors: Line[] = [];
    const logger: Logger = {
      // `silent` deliberately: `error` is the one level a server run this way
      // still writes, which is half of what SERVER-065 is asserting.
      level: "silent",
      info: () => undefined,
      debug: () => undefined,
      error: (message: string, fields?: LogFields) => {
        errors.push({ message, fields });
      },
    };
    return { logger, errors };
  };

  const unlistable = (relative: string): void => {
    const abs = join(corpusDir, relative);
    rmSync(abs, { recursive: true, force: true });
    writeFileSync(abs, "not a directory", "utf8");
  };

  it("is reported by `listQueueEventFiles` rather than read as empty", () => {
    writeJson("queue/processed/evt_zzz999888777.json", { ...EVENT, id: "evt_zzz999888777" });
    unlistable("queue/pending");

    const listing = listQueueEventFiles(corpusDir);

    // The other status directories are still scanned: losing `pending/` is not a
    // reason to stop reporting what is `processed/`.
    expect(listing.files.map((file) => file.name)).toEqual(["evt_zzz999888777.json"]);
    expect(listing.unlistable).toHaveLength(1);
    expect(listing.unlistable[0]?.reason).toContain("ENOTDIR");
  });

  it("says nothing about a status directory that is simply absent", () => {
    rmSync(join(corpusDir, "queue", "abandoned"), { recursive: true, force: true });
    expect(listQueueEventFiles(corpusDir).unlistable).toEqual([]);
  });

  it("logs the queue skip at `error` and leaves it out of the count", () => {
    writeJson("queue/processed/evt_zzz999888777.json", { ...EVENT, id: "evt_zzz999888777" });
    unlistable("queue/pending");
    const { logger, errors } = capturing();
    const logged = openProjection({ workspaceRoot: ws, corpusDir }, { logger });
    // Boot's own population already logged it once, which is the point of the
    // rule; the explicit call below is what this test is asserting about.
    expect(errors).toHaveLength(1);
    errors.length = 0;

    // One event projected, not two-minus-a-silent-nothing: the events under
    // `pending/` were never read, so the count says so.
    expect(projectQueueDir(logged, corpusDir)).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("cannot list queue status directory");
    expect(String(errors[0]?.fields?.["reason"])).toContain("ENOTDIR");
    logged.close();
  });

  it("logs the jobs skip at `error` too, which is the same choice", () => {
    unlistable("jobs");
    const { logger, errors } = capturing();
    const logged = openProjection({ workspaceRoot: ws, corpusDir }, { logger });
    expect(errors).toHaveLength(1);
    errors.length = 0;

    expect(projectJobsDir(logged, corpusDir)).toBe(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("cannot list the jobs directory");
    logged.close();
  });

  it("logs nothing when the jobs directory is merely absent", () => {
    rmSync(join(corpusDir, "jobs"), { recursive: true, force: true });
    const { logger, errors } = capturing();
    const logged = openProjection({ workspaceRoot: ws, corpusDir }, { logger });

    expect(projectJobsDir(logged, corpusDir)).toBe(0);
    expect(errors).toEqual([]);
    logged.close();
  });
});
