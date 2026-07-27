import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { HttpError } from "../errors.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import { createQueueService, type QueueService } from "../queue/index.js";
import { createJobService, type JobService } from "./service.js";
import { FILE_CAP_NOTICE, MAX_LOG_FILE_BYTES } from "./store.js";

let ws: Workspace;
let queue: QueueService;
let jobs: JobService;
let logged: { message: string; fields?: Record<string, unknown> }[];

const enqueue = async (): Promise<string> =>
  (await queue.enqueue({ type: "comment.created", source: "ui", payload: {} })).id;

beforeEach(() => {
  ws = createWorkspace("s009-jobservice");
  ws.reproject();
  logged = [];
  queue = createQueueService({
    corpusDir: ws.config.corpusDir,
    mirror: createProjectionQueueMirror(ws.db),
  });
  jobs = createJobService({
    corpusDir: ws.config.corpusDir,
    projection: ws.db,
    queue,
    logger: {
      level: "info",
      debug: () => undefined,
      info: (message, fields) => {
        logged.push({ message, ...(fields === undefined ? {} : { fields }) });
      },
      error: () => undefined,
    },
  });
});

afterEach(() => {
  queue.close();
  ws.close();
});

describe("appendLine", () => {
  it("stamps the line with the wall clock when no clock is injected", async () => {
    // The default `now` is the one the real server runs on; a line dated in the
    // past would make the console's ordering a lie.
    const bare = createJobService({ corpusDir: ws.config.corpusDir, projection: ws.db, queue });
    const id = await enqueue();
    const before = Date.now();

    const outcome = await bare.appendLine(id, "wall clock", "server");

    const stamped = Date.parse(outcome.stored?.ts ?? "");
    // Canonical instants are truncated to the second, so `before` may round up.
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it("records a refused line at the file cap instead of failing the call", async () => {
    const id = await enqueue();
    mkdirSync(join(ws.config.corpusDir, "jobs"), { recursive: true });
    writeFileSync(
      join(ws.config.corpusDir, "jobs", `${id}.jsonl`),
      `${"x".repeat(MAX_LOG_FILE_BYTES - 1)}\n`,
      "utf8",
    );

    const outcome = await jobs.appendLine(id, "one line too many", "hook");

    expect(outcome).toEqual({ stored: undefined, capped: true });
    expect(logged).toEqual([
      { message: "job log is at its size cap; dropping the line", fields: { eventId: id } },
    ]);
    // The notice is in the file, so an operator reading it sees why it stopped.
    expect((await jobs.readLog(id, 0)).lines.at(-1)?.line).toBe(FILE_CAP_NOTICE);
  });

  it("refuses an event that exists nowhere in the queue", async () => {
    await expect(jobs.appendLine("evt_nosuchjob", "x", "hook")).rejects.toBeInstanceOf(HttpError);
    await expect(jobs.appendLine("evt_nosuchjob", "x", "hook")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("readLog", () => {
  it("reads an unknown job as a 404 and a silent one as an empty log", async () => {
    await expect(jobs.readLog("evt_nosuchjob", 0)).rejects.toMatchObject({ status: 404 });

    const id = await enqueue();
    expect(await jobs.readLog(id, 0)).toEqual({ lines: [], nextCursor: 0 });
  });

  it("reads a log whose event has been pruned from the queue", async () => {
    // The file outlives its event: the log is evidence, and a console row that
    // still points at it must be able to open it.
    const id = "evt_orphaned01";
    mkdirSync(join(ws.config.corpusDir, "jobs"), { recursive: true });
    writeFileSync(
      join(ws.config.corpusDir, "jobs", `${id}.jsonl`),
      `${JSON.stringify({ ts: "2026-07-27T09:00:00Z", line: "left behind" })}\n`,
      "utf8",
    );

    expect(await jobs.readLog(id, 0)).toEqual({
      lines: [{ ts: "2026-07-27T09:00:00Z", line: "left behind" }],
      nextCursor: 1,
    });
  });
});
