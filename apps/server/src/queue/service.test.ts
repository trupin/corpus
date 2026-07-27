import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { HttpError } from "../errors.js";
import type { QueueMirror } from "./project.js";
import { QUEUE_QUERY_KEYS } from "./project.js";
import { createQueueService, DEFAULT_MAX_ATTEMPTS, QueueService } from "./service.js";
import type { StoredEvent } from "./store.js";

let root: string;
let corpusDir: string;
let mirror: QueueMirror & { upserts: StoredEvent[]; replacements: StoredEvent[][] };
let invalidations: (readonly QueryKey[])[];
let clock: number;
let services: QueueService[];

const makeMirror = (): typeof mirror => {
  const upserts: StoredEvent[] = [];
  const replacements: StoredEvent[][] = [];
  return {
    upserts,
    replacements,
    upsertEvent: (event) => upserts.push(event),
    replaceAllEvents: (events) => replacements.push([...events]),
  };
};

function makeService(
  overrides: Partial<Parameters<typeof createQueueService>[0]> = {},
): QueueService {
  const service = createQueueService({
    corpusDir,
    mirror,
    invalidate: (keys) => invalidations.push(keys),
    now: () => clock,
    pollIntervalMs: 10,
    ...overrides,
  });
  services.push(service);
  return service;
}

const enqueueMany = async (service: QueueService, count: number): Promise<StoredEvent[]> => {
  const events: StoredEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    events.push(
      await service.enqueue({ type: "comment.created", source: "cli", payload: { index } }),
    );
  }
  return events;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s008-"));
  corpusDir = join(root, ".corpus");
  mirror = makeMirror();
  invalidations = [];
  clock = Date.parse("2026-07-19T10:05:00Z");
  services = [];
});

afterEach(() => {
  for (const service of services) service.close();
  rmSync(root, { recursive: true, force: true });
});

describe("enqueue", () => {
  it("writes a pending event, mirrors it and invalidates", async () => {
    const service = makeService();
    const event = await service.enqueue({
      type: "comment.created",
      source: "ui",
      payload: { threadId: "th_x9y8" },
    });

    expect(event.id).toMatch(/^evt_[a-z0-9]{12}$/);
    expect(event.created).toBe("2026-07-19T10:05:00Z");
    const onDisk: unknown = JSON.parse(
      readFileSync(service.store.pathFor("pending", event.id), "utf8"),
    );
    expect(onDisk).toMatchObject({
      id: event.id,
      status: "pending",
      payload: { threadId: "th_x9y8" },
    });
    expect(mirror.upserts.at(-1)?.id).toBe(event.id);
    expect(invalidations).toEqual([QUEUE_QUERY_KEYS]);
  });

  it("overwrites rather than duplicating when the same id is enqueued twice", async () => {
    const service = makeService();
    await service.enqueue({ type: "a", source: "cli", payload: {}, id: "evt_aaaaaaaaaaaa" });
    await service.enqueue({ type: "b", source: "cli", payload: {}, id: "evt_aaaaaaaaaaaa" });

    expect(await service.store.listIds("pending")).toEqual(["evt_aaaaaaaaaaaa"]);
    const read = await service.store.readEvent("pending", "evt_aaaaaaaaaaaa");
    expect(read?.ok === true && read.event.type).toBe("b");
  });
});

describe("idle", () => {
  it("returns immediately when work is pending, without claiming it", async () => {
    const service = makeService();
    const [first] = await enqueueMany(service, 2);

    const events = await service.idle({ timeoutMs: 60_000 });
    expect(events?.map((event) => event.id).sort()).toEqual(
      (await service.store.listIds("pending")).sort(),
    );
    expect(events).toHaveLength(2);
    expect(await service.store.listIds("in-progress")).toEqual([]);
    expect(first).toBeDefined();
  });

  it("parks and expires with undefined when nothing arrives", async () => {
    const service = makeService();
    const started = Date.now();
    expect(await service.idle({ timeoutMs: 60 })).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(service.parked).toBe(0);
  });

  it("wakes a parked call the moment an in-process enqueue lands", async () => {
    const service = makeService();
    const parked = service.idle({ timeoutMs: 5_000 });
    await vi.waitFor(() => {
      expect(service.parked).toBe(1);
    });

    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    expect((await parked)?.map((each) => each.id)).toEqual([event.id]);
    expect(service.parked).toBe(0);
  });

  it("wakes on a file dropped into pending/ from outside the process", async () => {
    const service = makeService();
    const parked = service.idle({ timeoutMs: 5_000 });
    await vi.waitFor(() => {
      expect(service.parked).toBe(1);
    });

    writeFileSync(
      service.store.pathFor("pending", "evt_outofband00"),
      JSON.stringify({
        id: "evt_outofband00",
        type: "comment.created",
        created: "2026-07-19T10:05:01Z",
        source: "hand",
        payload: {},
      }),
    );

    expect((await parked)?.map((each) => each.id)).toEqual(["evt_outofband00"]);
  });

  it("releases a dropped client without answering", async () => {
    const service = makeService();
    const controller = new AbortController();
    const parked = service.idle({ timeoutMs: 5_000, signal: controller.signal });
    await vi.waitFor(() => {
      expect(service.parked).toBe(1);
    });

    controller.abort();
    expect(await parked).toBeUndefined();
    expect(service.parked).toBe(0);
  });

  it("parks again when it is woken and finds no work after all", async () => {
    const service = makeService();
    await service.halt();
    const parked = service.idle({ timeoutMs: 200 });
    await vi.waitFor(() => {
      expect(service.parked).toBe(1);
    });

    // `resume` releases the waiters, but the queue is empty: the call must go
    // back to parking for the rest of its window rather than answering early.
    await service.resume();
    const started = Date.now();
    expect(await parked).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it("skips a malformed pending file instead of mutating on a read path", async () => {
    const service = makeService();
    writeFileSync(service.store.pathFor("pending", "evt_bad000000000"), "{ truncated");

    expect(await service.idle({ timeoutMs: 40 })).toBeUndefined();
    expect(await service.store.listIds("pending")).toEqual(["evt_bad000000000"]);
  });
});

describe("halt and resume", () => {
  it("parks idle and empties claim-all while halted, without touching the files", async () => {
    const service = makeService();
    const events = await enqueueMany(service, 2);
    const status = await service.halt("deploying");
    expect(status.halted).toBe(true);
    expect(JSON.parse(readFileSync(service.store.haltPath, "utf8"))).toEqual({
      at: "2026-07-19T10:05:00Z",
      reason: "deploying",
    });

    expect(await service.idle({ timeoutMs: 60 })).toBeUndefined();
    expect(await service.claimAll()).toEqual([]);
    expect((await service.store.listIds("pending")).sort()).toEqual(
      events.map((event) => event.id).sort(),
    );

    const resumed = await service.resume();
    expect(resumed.halted).toBe(false);
    expect(await service.claimAll()).toHaveLength(2);
  });

  it("is idempotent in both directions", async () => {
    const service = makeService();
    await service.halt();
    expect((await service.halt("second")).halted).toBe(true);
    expect(JSON.parse(readFileSync(service.store.haltPath, "utf8"))).toMatchObject({
      reason: "second",
    });

    await service.resume();
    expect((await service.resume()).halted).toBe(false);
  });

  it("wakes parked callers on resume", async () => {
    const service = makeService();
    await service.halt();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    const parked = service.idle({ timeoutMs: 5_000 });
    await vi.waitFor(() => {
      expect(service.parked).toBe(1);
    });

    await service.resume();
    expect((await parked)?.map((each) => each.id)).toEqual([event.id]);
  });
});

describe("claimAll", () => {
  it("moves every pending event to in-progress in one batch, payload intact", async () => {
    const service = makeService();
    const enqueued = await enqueueMany(service, 3);

    const claimed = await service.claimAll();
    expect(claimed.map((event) => event.id).sort()).toEqual(
      enqueued.map((event) => event.id).sort(),
    );
    expect(claimed.map((event) => event.payload.index).sort()).toEqual([0, 1, 2]);
    expect(await service.store.listIds("pending")).toEqual([]);
    expect((await service.store.listIds("in-progress")).sort()).toEqual(
      enqueued.map((event) => event.id).sort(),
    );
    expect(claimed.every((event) => event.status === "in-progress")).toBe(true);
  });

  it("never hands the same event to two concurrent callers", async () => {
    const service = makeService();
    const enqueued = await enqueueMany(service, 50);

    const batches = await Promise.all([
      service.claimAll(),
      service.claimAll(),
      service.claimAll(),
      service.claimAll(),
      service.claimAll(),
    ]);

    const ids = batches.flat().map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(enqueued.map((event) => event.id).sort());
    expect(await service.store.listIds("pending")).toEqual([]);
  });

  it("quarantines a malformed file instead of poisoning the batch", async () => {
    const service = makeService();
    const good = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    writeFileSync(service.store.pathFor("pending", "evt_bad000000000"), "{ truncated");

    const claimed = await service.claimAll();
    expect(claimed.map((event) => event.id)).toEqual([good.id]);
    expect(await service.store.listIds("failed")).toEqual(["evt_bad000000000"]);
    const quarantined: unknown = JSON.parse(
      readFileSync(service.store.pathFor("failed", "evt_bad000000000"), "utf8"),
    );
    expect(quarantined).toMatchObject({ status: "failed" });
    expect(String((quarantined as { error: string }).error)).toMatch(/malformed event file/);
  });

  it("returns an empty batch, and invalidates nothing, when there is no work", async () => {
    const service = makeService();
    expect(await service.claimAll()).toEqual([]);
    expect(invalidations).toEqual([]);
  });
});

describe("complete, fail and abandon", () => {
  it("lands each event in its directory and records the failure reason", async () => {
    const service = makeService();
    const [first, second, third] = await enqueueMany(service, 3);
    await service.claimAll();
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("expected three events");
    }

    expect((await service.complete(first.id)).status).toBe("processed");
    expect((await service.fail(second.id, "boom")).status).toBe("failed");
    expect((await service.abandon(third.id)).status).toBe("abandoned");

    expect(await service.store.listIds("processed")).toEqual([first.id]);
    expect(await service.store.listIds("failed")).toEqual([second.id]);
    expect(await service.store.listIds("abandoned")).toEqual([third.id]);
    expect(await service.store.listIds("in-progress")).toEqual([]);

    const failed: unknown = JSON.parse(
      readFileSync(service.store.pathFor("failed", second.id), "utf8"),
    );
    expect(failed).toMatchObject({ error: "boom", status: "failed" });
  });

  it("is idempotent, and leaves the first reason in place", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.fail(event.id, "first");
    const again = await service.fail(event.id, "second");

    expect(again.error).toBe("first");
    expect(await service.store.listIds("failed")).toEqual([event.id]);
  });

  it("404s an unknown id", async () => {
    const service = makeService();
    await expect(service.complete("evt_missing00000")).rejects.toBeInstanceOf(HttpError);
    await expect(service.complete("evt_missing00000")).rejects.toMatchObject({ status: 404 });
  });

  it("quarantines a corrupt file rather than transitioning it", async () => {
    const service = makeService();
    writeFileSync(service.store.pathFor("in-progress", "evt_bad000000000"), "not json");

    const result = await service.complete("evt_bad000000000");
    expect(result.status).toBe("failed");
    expect(await service.store.listIds("failed")).toEqual(["evt_bad000000000"]);
  });

  it("moves the file rather than deleting it when abandoning", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.abandon(event.id);

    expect(readdirSync(service.store.dirFor("abandoned"))).toEqual([`${event.id}.json`]);
  });
});

describe("reapStale", () => {
  it("returns stuck work to pending with an incremented attempt count", async () => {
    const service = makeService({ staleAfterMs: 1_000 });
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.claimAll();

    expect((await service.reapStale()).reaped).toEqual([]);

    clock += 60_000;
    const result = await service.reapStale();
    expect(result.reaped).toEqual([event.id]);
    expect(await service.store.listIds("pending")).toEqual([event.id]);
    const onDisk: unknown = JSON.parse(
      readFileSync(service.store.pathFor("pending", event.id), "utf8"),
    );
    expect(onDisk).toMatchObject({ attempts: 1, status: "pending" });
  });

  it("gives up past the attempt cap, and does not report it as reaped", async () => {
    const service = makeService({ staleAfterMs: 1_000 });
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.claimAll();
    await service.store.writeEvent("in-progress", {
      ...event,
      status: "in-progress",
      attempts: DEFAULT_MAX_ATTEMPTS,
    });

    clock += 60_000;
    const result = await service.reapStale();
    expect(result.reaped).toEqual([]);
    expect(result.failed).toEqual([event.id]);
    const onDisk: unknown = JSON.parse(
      readFileSync(service.store.pathFor("failed", event.id), "utf8"),
    );
    expect(onDisk).toMatchObject({ attempts: DEFAULT_MAX_ATTEMPTS + 1, status: "failed" });
    expect(String((onDisk as { error: string }).error)).toMatch(/attempt cap/);
  });

  it("wakes a parked caller with the work it recovered", async () => {
    const service = makeService({ staleAfterMs: 1_000 });
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.claimAll();
    const parked = service.idle({ timeoutMs: 5_000 });
    await vi.waitFor(() => {
      expect(service.parked).toBe(1);
    });

    clock += 60_000;
    await service.reapStale();
    expect((await parked)?.map((each) => each.id)).toEqual([event.id]);
  });

  it("quarantines a corrupt in-progress file", async () => {
    const service = makeService({ staleAfterMs: 0 });
    writeFileSync(service.store.pathFor("in-progress", "evt_bad000000000"), "{");

    const result = await service.reapStale();
    expect(result.failed).toEqual(["evt_bad000000000"]);
    expect(await service.store.listIds("failed")).toEqual(["evt_bad000000000"]);
  });

  it("does nothing, and invalidates nothing, when no run is stuck", async () => {
    const service = makeService();
    await enqueueMany(service, 1);
    await service.claimAll();
    invalidations = [];

    expect(await service.reapStale()).toEqual({ reaped: [], failed: [] });
    expect(invalidations).toEqual([]);
  });
});

describe("losing a race with another actor", () => {
  it("skips an event that vanished from pending mid-claim", async () => {
    const service = makeService();
    await enqueueMany(service, 1);
    vi.spyOn(service.store, "move").mockResolvedValue(false);

    expect(await service.claimAll()).toEqual([]);
  });

  it("skips an event whose file disappeared between the move and the read", async () => {
    const service = makeService();
    await enqueueMany(service, 1);
    vi.spyOn(service.store, "readEvent").mockResolvedValue(undefined);

    expect(await service.claimAll()).toEqual([]);
  });

  it("skips an event that left in-progress mid-reap", async () => {
    const service = makeService({ staleAfterMs: 0 });
    await enqueueMany(service, 1);
    await service.claimAll();
    vi.spyOn(service.store, "move").mockResolvedValue(false);

    expect(await service.reapStale()).toEqual({ reaped: [], failed: [] });
  });

  it("404s a transition whose event moved away underneath it", async () => {
    const service = makeService();
    const [event] = await enqueueMany(service, 1);
    vi.spyOn(service.store, "move").mockResolvedValue(false);

    await expect(service.complete(event?.id ?? "")).rejects.toMatchObject({ status: 404 });
  });

  it("404s a transition whose file vanished between locate and read", async () => {
    const service = makeService();
    const [event] = await enqueueMany(service, 1);
    vi.spyOn(service.store, "readEvent").mockResolvedValue(undefined);

    await expect(service.complete(event?.id ?? "")).rejects.toMatchObject({ status: 404 });
  });

  it("logs a failing poll and keeps the request parked", async () => {
    const logger = { level: "silent" as const, info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const service = makeService({ logger });
    let calls = 0;
    vi.spyOn(service.store, "isHalted").mockImplementation(() => {
      calls += 1;
      if (calls > 1) return Promise.reject(new Error("stat exploded"));
      return Promise.resolve(false);
    });

    expect(await service.idle({ timeoutMs: 120 })).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith("queue poll failed", expect.anything());
  });
});

describe("status", () => {
  it("counts each directory, ignoring .gitkeep", async () => {
    const service = makeService();
    const [first, second] = await enqueueMany(service, 4);
    if (first === undefined || second === undefined) throw new Error("expected four events");
    await service.claimAll();
    await service.complete(first.id);
    await service.fail(second.id, "boom");
    for (const status of ["pending", "in-progress", "processed", "failed", "abandoned"] as const) {
      writeFileSync(join(service.store.dirFor(status), ".gitkeep"), "");
    }

    expect(await service.status()).toEqual({
      halted: false,
      pending: 0,
      inProgress: 2,
      processed: 1,
      failed: 1,
      abandoned: 0,
    });
  });
});

describe("the projection mirror", () => {
  it("mirrors every transition, synchronously, before the call returns", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    expect(mirror.upserts.at(-1)).toMatchObject({ id: event.id, status: "pending" });

    await service.claimAll();
    expect(mirror.upserts.at(-1)).toMatchObject({ id: event.id, status: "in-progress" });

    await service.complete(event.id);
    expect(mirror.upserts.at(-1)).toMatchObject({ id: event.id, status: "processed" });
  });

  it("rebuilds itself from the directories at boot", async () => {
    const seeded = makeService();
    const [first, second] = await enqueueMany(seeded, 2);
    if (first === undefined || second === undefined) throw new Error("expected two events");
    await seeded.claimAll();
    await seeded.complete(first.id);
    mirror = makeMirror();

    const restarted = makeService();
    expect(mirror.replacements).toHaveLength(1);
    const rebuilt = mirror.replacements[0] ?? [];
    expect(
      rebuilt
        .map((event) => [event.id, event.status])
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(
      [
        [first.id, "processed"],
        [second.id, "in-progress"],
      ].sort((a, b) => String(a).localeCompare(String(b))),
    );
    expect(await restarted.status()).toMatchObject({ processed: 1, inProgress: 1 });
  });

  it("skips — and reports — a malformed file at boot instead of crashing", () => {
    mkdirSync(join(corpusDir, "queue", "pending"), { recursive: true });
    writeFileSync(join(corpusDir, "queue", "pending", "evt_bad000000000.json"), "{ truncated");
    const logger = { level: "silent" as const, info: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const service = makeService({ logger });
    expect(logger.error).toHaveBeenCalledWith(
      "queue boot rebuild skipped malformed events",
      expect.objectContaining({ ids: "evt_bad000000000" }),
    );
    expect(mirror.replacements[0]).toEqual([]);
    expect(service.parked).toBe(0);
  });

  it("runs with no mirror and no invalidation bus wired in", async () => {
    const service = createQueueService({ corpusDir, pollIntervalMs: 10 });
    services.push(service);
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    expect((await service.complete(event.id)).status).toBe("processed");
  });
});
