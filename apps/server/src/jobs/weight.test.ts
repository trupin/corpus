import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogFields, Logger } from "../logger.js";
import {
  createProjectionQueueMirror,
  openProjection,
  type ProjectionDb,
} from "../projection/index.js";
import { createQueueService, type QueueService } from "../queue/index.js";
import { createJobService, type JobService } from "./service.js";
import { STATED_WEIGHT_PREFIX, createStatedWeightRecorder, statedWeightLine } from "./weight.js";

let root: string;
let corpusDir: string;
let db: ProjectionDb;
let queue: QueueService;
let jobs: JobService;
let errors: { message: string; fields: LogFields }[];

const logger: Logger = {
  level: "silent",
  debug: () => undefined,
  info: () => undefined,
  error: (message: string, fields: LogFields = {}) => {
    errors.push({ message, fields });
  },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s069-weight-"));
  corpusDir = join(root, ".corpus");
  errors = [];
  db = openProjection({ workspaceRoot: root, corpusDir }, { populate: false });
  queue = createQueueService({ corpusDir, now: () => Date.parse("2026-08-08T09:00:00Z") });
  queue.attachMirror(createProjectionQueueMirror(db));
  jobs = createJobService({
    corpusDir,
    projection: db,
    queue,
    now: () => Date.parse("2026-08-08T09:00:00Z"),
  });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const logOf = (eventId: string): string[] =>
  readFileSync(join(corpusDir, "jobs", `${eventId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { line: string; source: string })
    .map((record) => `${record.source}: ${record.line}`);

describe("statedWeightLine", () => {
  it("reproduces the level exactly, however the workspace spells it", () => {
    // The server has no list of levels to check this against, on purpose: §7
    // keeps model tiers in the orchestrate skill and §2.4 lets a workspace edit
    // that document, so a level the shipped guidance never heard of is still
    // that workspace's own vocabulary.
    expect(statedWeightLine("Deliberative — two readers")).toBe(
      `${STATED_WEIGHT_PREFIX}Deliberative — two readers`,
    );
  });
});

describe("createStatedWeightRecorder", () => {
  it("writes one server-sourced line for an event whose request stated a weight", async () => {
    const record = createStatedWeightRecorder({ jobs, logger });
    const event = await queue.enqueue({
      type: "comment.created",
      source: "thread",
      payload: { threadId: "th_x9y8z7w6", weight: "Standard" },
    });

    await record(event);

    expect(logOf(event.id)).toEqual([`server: ${STATED_WEIGHT_PREFIX}Standard`]);
  });

  it("writes nothing at all when the request stated none", async () => {
    const record = createStatedWeightRecorder({ jobs, logger });
    const event = await queue.enqueue({
      type: "comment.created",
      source: "thread",
      payload: { threadId: "th_x9y8z7w6" },
    });

    await record(event);

    // Silence *is* "the orchestrator decides" (§7). A line announcing the
    // ordinary case on every job would be noise in the surface an operator
    // watches live — and the file is not even created.
    expect(() => logOf(event.id)).toThrow();
  });

  it("logs a weight on any event type, without being taught the type", async () => {
    // `REQUESTED_WEIGHT_PAYLOAD_KEY` is event-type-agnostic by contract design
    // so a plugin's own event can carry one with no contract change; reading the
    // payload rather than switching on the type is what honours that here.
    const record = createStatedWeightRecorder({ jobs, logger });
    const event = await queue.enqueue({
      type: "todos.item.flagged",
      source: "plugin",
      payload: { itemId: "itm_1", weight: "Small and mechanical" },
    });

    await record(event);

    expect(logOf(event.id)).toEqual([`server: ${STATED_WEIGHT_PREFIX}Small and mechanical`]);
  });

  it("reads an ill-shaped weight as none rather than throwing", async () => {
    // Events come off disk and an older server may have written one. The
    // contract's reader answers `undefined` for anything that is not a level,
    // which is the state that means "the orchestrator decides" — the only
    // reading that cannot cause work to run at something nobody asked for.
    const record = createStatedWeightRecorder({ jobs, logger });
    const event = await queue.enqueue({
      type: "comment.created",
      source: "thread",
      payload: { threadId: "th_x9y8z7w6", weight: 7 },
    });

    await record(event);

    expect(() => logOf(event.id)).toThrow();
    expect(errors).toEqual([]);
  });

  it("reports a failed append to the operator and lets the caller continue", async () => {
    const record = createStatedWeightRecorder({ jobs, logger });

    // No such event, so `appendLine` refuses with a 404 — the shape any append
    // failure takes from here.
    await expect(
      record({
        id: "evt_aaaaaaaaaaaa",
        type: "comment.created",
        created: "2026-08-08T09:00:00Z",
        source: "thread",
        payload: { weight: "Standard" },
        status: "pending",
        updated: "2026-08-08T09:00:00Z",
      }),
    ).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.fields["eventId"]).toBe("evt_aaaaaaaaaaaa");
  });
});
