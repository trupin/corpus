// Integration: the real QueueService driving the real projection through the
// mirror seam. No HTTP, no stubs — a temp workspace, `.corpus/cache.db`, and the
// status directories, which is everything the seam actually touches.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQueueService, type QueueService } from "../queue/index.js";
import { openProjection, type ProjectionConfig, type ProjectionDb } from "./db.js";
import { doctor } from "./doctor.js";
import { createProjectionQueueMirror } from "./queue-mirror.js";

const STALE_AFTER_MS = 1000;

interface Booted {
  readonly queue: QueueService;
  readonly db: ProjectionDb;
}

let root: string;
let config: ProjectionConfig;
let clock: number;
let booted: Booted[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-queue-mirror-"));
  const workspaceRoot = join(root, "ws");
  config = { workspaceRoot, corpusDir: join(workspaceRoot, ".corpus") };
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "data", "docs", "a.md"),
    `---\nid: doc_aaa\ntype: note\ntitle: A\n---\n\nBody.\n`,
    "utf8",
  );
  clock = Date.parse("2026-07-19T10:05:00Z");
  booted = [];
});

afterEach(() => {
  for (const instance of booted) shutdown(instance);
  rmSync(root, { recursive: true, force: true });
});

/**
 * Boots the pair in the order a real process does: the queue is constructed
 * first (it creates the status directories), the projection opens and
 * repopulates second, and the mirror is bound last — which is exactly what
 * `attachProjection` does.
 */
function boot(): Booted {
  const queue = createQueueService({
    corpusDir: config.corpusDir,
    now: () => clock,
    pollIntervalMs: 50,
    staleAfterMs: STALE_AFTER_MS,
  });
  const db = openProjection(config);
  queue.attachMirror(createProjectionQueueMirror(db));
  const instance = { queue, db };
  booted.push(instance);
  return instance;
}

/** Stops the process without deleting anything: files are the source of truth. */
function shutdown(instance: Booted): void {
  instance.queue.close();
  instance.db.close();
}

type EventRow = { readonly id: string; readonly status: string };

const rows = (db: ProjectionDb): EventRow[] =>
  db.prepare("SELECT id, status FROM events ORDER BY id").all() as EventRow[];

const statusOf = (db: ProjectionDb, id: string): string | undefined =>
  (db.prepare("SELECT status FROM events WHERE id = ?").get(id) as { status: string } | undefined)
    ?.status;

const payloadOf = (db: ProjectionDb, id: string): unknown => {
  const row = db.prepare("SELECT payload_json FROM events WHERE id = ?").get(id) as
    { payload_json: string } | undefined;
  return row === undefined ? undefined : JSON.parse(row.payload_json);
};

const eventFiles = (status: string): string[] =>
  readdirSync(join(config.corpusDir, "queue", status))
    .filter((name) => name.startsWith("evt_"))
    .sort();

describe("the queue mirrored into the projection", () => {
  it("puts an enqueued event in the events table, payload and all", async () => {
    const { queue, db } = boot();

    const event = await queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: { threadId: "th_x9y8" },
    });

    expect(rows(db)).toEqual([{ id: event.id, status: "pending" }]);
    expect(payloadOf(db, event.id)).toEqual({ threadId: "th_x9y8" });
  });

  it("tracks the status column through claim, complete, fail and abandon", async () => {
    const { queue, db } = boot();
    const first = await queue.enqueue({ type: "comment.created", source: "cli", payload: {} });
    const second = await queue.enqueue({ type: "comment.created", source: "cli", payload: {} });

    await queue.claimAll();
    expect(statusOf(db, first.id)).toBe("in-progress");
    expect(statusOf(db, second.id)).toBe("in-progress");

    await queue.complete(first.id);
    expect(statusOf(db, first.id)).toBe("processed");
    // The sibling is untouched: an upsert writes one row, not the whole table.
    expect(statusOf(db, second.id)).toBe("in-progress");

    await queue.fail(second.id, "boom");
    expect(statusOf(db, second.id)).toBe("failed");

    const third = await queue.enqueue({ type: "form.answer", source: "ui", payload: {} });
    await queue.abandon(third.id);
    expect(statusOf(db, third.id)).toBe("abandoned");
  });

  it("follows a reaped event back to pending", async () => {
    const { queue, db } = boot();
    const event = await queue.enqueue({ type: "comment.created", source: "cli", payload: {} });
    await queue.claimAll();
    expect(statusOf(db, event.id)).toBe("in-progress");

    clock += STALE_AFTER_MS * 2;
    expect(await queue.reapStale()).toEqual({ reaped: [event.id], failed: [] });

    expect(statusOf(db, event.id)).toBe("pending");
    expect(eventFiles("pending")).toEqual([`${event.id}.json`]);
  });

  it("rebuilds from the directories at boot, including files moved while it was down", async () => {
    const first = boot();
    const moved = await first.queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: {},
    });
    const stayed = await first.queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: {},
    });
    await first.queue.claimAll();
    shutdown(first);

    // The server is down: one event is dragged back to pending by hand.
    const from = join(config.corpusDir, "queue", "in-progress", `${moved.id}.json`);
    const to = join(config.corpusDir, "queue", "pending", `${moved.id}.json`);
    writeFileSync(to, readFileSync(from, "utf8"), "utf8");
    rmSync(from);

    const restarted = boot();
    expect(rows(restarted.db)).toEqual(
      [
        { id: moved.id, status: "pending" },
        { id: stayed.id, status: "in-progress" },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    // Directory over field: the hand-moved file still claims `in-progress`.
    expect(JSON.parse(readFileSync(to, "utf8"))).toMatchObject({ status: "in-progress" });
  });

  it("leaves a corrupt event file as the one row of drift, until a write path quarantines it", async () => {
    const first = boot();
    const good = await first.queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: {},
    });
    shutdown(first);

    const badId = "evt_bad000000000";
    writeFileSync(
      join(config.corpusDir, "queue", "pending", `${badId}.json`),
      "{ truncated",
      "utf8",
    );

    // The boot scan skips what it cannot parse, so the file exists and the row
    // does not: the honest one-row difference `db doctor` is meant to surface.
    const restarted = boot();
    expect(rows(restarted.db).map((row) => row.id)).toEqual([good.id]);
    // Sorted on both sides: `good.id` is randomly generated, so its position
    // relative to the fixture id is a coin flip.
    expect([...eventFiles("pending")].sort()).toEqual([`${badId}.json`, `${good.id}.json`].sort());

    const report = doctor(config);
    expect(report.ok).toBe(false);
    expect(report.drift).toEqual([
      {
        kind: "count_mismatch",
        detail: ".corpus/queue holds 2 evt_*.json file(s) but the projection has 1 event row(s)",
      },
    ]);

    // The first write path to touch it quarantines it, and the row appears.
    expect((await restarted.queue.claimAll()).map((event) => event.id)).toEqual([good.id]);
    expect(statusOf(restarted.db, badId)).toBe("failed");
    expect(eventFiles("failed")).toEqual([`${badId}.json`]);
    expect(doctor(config).ok).toBe(true);
  });
});
