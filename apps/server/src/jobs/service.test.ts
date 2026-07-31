import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { HttpError } from "../errors.js";
import { createProjectionQueueMirror } from "../projection/index.js";
import { createQueueService, type QueueService } from "../queue/index.js";
import { RETRY_LOG_LINE, createJobService, type JobService } from "./service.js";
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

describe("retry", () => {
  /** Failed, and therefore retryable — the one state retry is defined for. */
  const failedJob = async (): Promise<string> => {
    const id = await enqueue();
    await queue.claimAll();
    await queue.fail(id, "boom");
    return id;
  };

  it("puts a failed job back in pending and records why", async () => {
    const id = await failedJob();

    const job = await jobs.retry(id);

    expect(job.status).toBe("pending");
    expect(await queue.store.locate(id)).toBe("pending");
    expect((await jobs.readLog(id, 0)).lines.at(-1)?.line).toBe(RETRY_LOG_LINE);
  });

  it("puts a deferred job back in pending — the manual override §7 names", async () => {
    // SERVER-030: automatic re-entry on lock release, break and reap
    // supplements `job retry`, it does not delete it. The operator still needs
    // a way to pull back a deferral automatic re-entry did not reach.
    const id = await enqueue();
    await queue.claimAll();
    await queue.defer(id, { blockedOn: "doc_locked01", deferReason: "waiting" });

    const job = await jobs.retry(id);

    expect(job.status).toBe("pending");
    // The deferral bookkeeping goes with the state that owned it.
    expect(job.blockedOn).toBeNull();
    expect(job.blockedOnTitle).toBeNull();
    expect(await queue.store.locate(id)).toBe("pending");
    expect((await jobs.readLog(id, 0)).lines.at(-1)?.line).toBe(RETRY_LOG_LINE);
  });

  it("refuses a job that is neither failed nor deferred, naming its status", async () => {
    const id = await enqueue();

    await expect(jobs.retry(id)).rejects.toMatchObject({
      status: 409,
      message: `queue event ${id} is pending; only a failed or deferred job can be retried`,
    });
  });

  it("refuses an event the queue has never heard of", async () => {
    await expect(jobs.retry("evt_nosuchjob")).rejects.toMatchObject({ status: 404 });
  });

  it("cannot re-run a job that completes while the retry is in flight", async () => {
    // SERVER-022 finding 2. The status check used to run in this service,
    // outside the queue's serialize chain, and `requeue` moves an event from
    // whichever directory it is in — so a `complete` landing in the interval
    // left the retry putting a *processed* event back into `pending/`, and the
    // agent ran a finished job a second time.
    const id = await failedJob();

    const completed = queue.complete(id);
    const retried = jobs
      .retry(id)
      .then(() => ({ kind: "landed" as const }))
      .catch((error: unknown) => ({ kind: "refused" as const, error }));
    await completed;
    const outcome = await retried;

    // Exactly one of the two wins, and the completion did: it reached the chain
    // first. What must never happen is both.
    expect(outcome.kind).toBe("refused");
    expect(outcome).toMatchObject({
      error: {
        status: 409,
        message: `queue event ${id} is processed; only a failed or deferred job can be retried`,
      },
    });
    expect(await queue.store.locate(id)).toBe("processed");
    // One status directory holds the event, and the retry left no trace in the
    // log of a run it did not start.
    expect(await queue.status()).toMatchObject({ processed: 1, pending: 0, failed: 0 });
    expect((await jobs.readLog(id, 0)).lines.map((line) => line.line)).not.toContain(
      RETRY_LOG_LINE,
    );
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
