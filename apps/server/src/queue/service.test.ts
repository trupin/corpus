import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_EVENT_STATUSES, type QueryKey, type QueueEventStatus } from "@corpus/contract";
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

  // SERVER-069's seam. What matters about it is the *ordering* it promises: the
  // observer runs after the event is durable and mirrored, and before anything
  // parked on the queue is woken — so a line written about a job cannot land
  // after a line the agent it woke wrote on the same log.
  describe("the enqueue observer", () => {
    it("sees every event, after the mirror and before the wake", async () => {
      const seen: StoredEvent[] = [];
      const mirroredWhenSeen: number[] = [];
      const service = makeService();
      let woken = 0;
      const idle = service.idle({ timeoutMs: 60_000 }).then(() => {
        woken += 1;
      });
      service.observeEnqueued(async (event) => {
        seen.push(event);
        mirroredWhenSeen.push(mirror.upserts.length);
        expect(woken).toBe(0);
        await Promise.resolve();
      });

      const event = await service.enqueue({ type: "a", source: "cli", payload: { weight: "x" } });
      await idle;

      expect(seen.map((each) => each.id)).toEqual([event.id]);
      expect(mirroredWhenSeen).toEqual([1]);
    });

    it("never fails the producer's enqueue when it throws", async () => {
      const service = makeService();
      service.observeEnqueued(() => Promise.reject(new Error("log volume full")));

      const event = await service.enqueue({ type: "a", source: "cli", payload: {} });

      // The event is on disk and the agent is woken for it; a lost log line may
      // not become "your comment was not posted" about a comment that was.
      expect(await service.store.listIds("pending")).toEqual([event.id]);
    });
  });
});

describe("idle", () => {
  it("returns immediately when work is pending, without claiming it", async () => {
    const service = makeService();
    const [first] = await enqueueMany(service, 2);

    const available = await service.idle({ timeoutMs: 60_000 });
    expect(available?.events.map((event) => event.id).sort()).toEqual(
      (await service.store.listIds("pending")).sort(),
    );
    expect(available?.events).toHaveLength(2);
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
    expect((await parked)?.events.map((each) => each.id)).toEqual([event.id]);
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

    expect((await parked)?.events.map((each) => each.id)).toEqual(["evt_outofband00"]);
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
    expect((await service.claimAll()).events).toEqual([]);
    expect((await service.store.listIds("pending")).sort()).toEqual(
      events.map((event) => event.id).sort(),
    );

    const resumed = await service.resume();
    expect(resumed.halted).toBe(false);
    expect((await service.claimAll()).events).toHaveLength(2);
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
    expect((await parked)?.events.map((each) => each.id)).toEqual([event.id]);
  });
});

describe("claimAll", () => {
  it("moves every pending event to in-progress in one batch, payload intact", async () => {
    const service = makeService();
    const enqueued = await enqueueMany(service, 3);

    const claimed = (await service.claimAll()).events;
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

    const ids = batches.flatMap((batch) => batch.events).map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(enqueued.map((event) => event.id).sort());
    expect(await service.store.listIds("pending")).toEqual([]);

    // Each caller's held set was read before its own moves, so no batch reports
    // the events it is handing over — and a later caller sees what the earlier
    // ones took (the chain is FIFO, so the last one sees the other four).
    for (const batch of batches) {
      const claimedHere = new Set(batch.events.map((event) => event.id));
      expect(batch.held.events.filter((event) => claimedHere.has(event.id))).toEqual([]);
    }
    expect(Math.max(...batches.map((batch) => batch.held.total))).toBeGreaterThan(0);
  });

  it("quarantines a malformed file instead of poisoning the batch", async () => {
    const service = makeService();
    const good = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    writeFileSync(service.store.pathFor("pending", "evt_bad000000000"), "{ truncated");

    const claimed = (await service.claimAll()).events;
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
    expect((await service.claimAll()).events).toEqual([]);
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

describe("defer", () => {
  /** One claimed event, ready to be deferred. */
  const claimed = async (service: QueueService): Promise<StoredEvent> => {
    const event = await service.enqueue({
      type: "comment.created",
      source: "cli",
      payload: { parentId: "th_abcd1234" },
    });
    await service.claimAll();
    return event;
  };

  const onDisk = (service: QueueService, status: QueueEventStatus, id: string): unknown =>
    JSON.parse(readFileSync(service.store.pathFor(status, id), "utf8"));

  it("moves a claimed event to deferred/, recording the blocking document", async () => {
    const service = makeService();
    const event = await claimed(service);
    invalidations.length = 0;

    const deferred = await service.defer(event.id, {
      blockedOn: "doc_locked01",
      deferReason: "the user is editing it",
    });

    expect(deferred).toMatchObject({
      status: "deferred",
      blockedOn: "doc_locked01",
      deferReason: "the user is editing it",
      payload: { parentId: "th_abcd1234" },
    });
    expect(await service.store.listIds("deferred")).toEqual([event.id]);
    expect(await service.store.listIds("in-progress")).toEqual([]);
    // On disk, because §7's "never silently dropped" has to survive a restart —
    // the deferral is a property of the file, not of this process.
    expect(onDisk(service, "deferred", event.id)).toMatchObject({
      status: "deferred",
      blockedOn: "doc_locked01",
      deferReason: "the user is editing it",
    });
    expect(mirror.upserts.at(-1)).toMatchObject({ status: "deferred", blockedOn: "doc_locked01" });
    expect(invalidations).toEqual([QUEUE_QUERY_KEYS]);
  });

  it("is not a failure: the failed count stays put and the deferred count moves", async () => {
    const service = makeService();
    const event = await claimed(service);

    await service.defer(event.id, { blockedOn: "doc_locked01" });

    expect(await service.status()).toMatchObject({ deferred: 1, failed: 0, inProgress: 0 });
  });

  it("accepts a deferral with no reason", async () => {
    const service = makeService();
    const event = await claimed(service);

    const deferred = await service.defer(event.id, { blockedOn: "doc_locked01" });

    expect(deferred.deferReason).toBeUndefined();
    expect(onDisk(service, "deferred", event.id)).not.toHaveProperty("deferReason");
  });

  it("409s anything that is not in-progress, including a second defer", async () => {
    const service = makeService();
    const pending = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });

    // Nothing has tried the edit yet.
    await expect(service.defer(pending.id, { blockedOn: "doc_locked01" })).rejects.toMatchObject({
      status: 409,
      message: `queue event ${pending.id} is pending; only in-progress work can be deferred`,
    });

    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_locked01" });
    // A repeat is a refusal, not a silent no-op that would look like it worked.
    await expect(service.defer(event.id, { blockedOn: "doc_other001" })).rejects.toMatchObject({
      status: 409,
    });
    expect(onDisk(service, "deferred", event.id)).toMatchObject({ blockedOn: "doc_locked01" });

    const done = await claimed(service);
    await service.complete(done.id);
    await expect(service.defer(done.id, { blockedOn: "doc_locked01" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("404s an unknown id", async () => {
    const service = makeService();
    await expect(
      service.defer("evt_missing00000", { blockedOn: "doc_locked01" }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      service.defer("evt_missing00000", { blockedOn: "doc_locked01" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a deferred event out of claim-all and out of idle", async () => {
    const service = makeService();
    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_locked01" });

    // Handing it back would spin the agent against a lock it still cannot take.
    expect((await service.claimAll()).events).toEqual([]);
    expect(await service.idle({ timeoutMs: 20 })).toBeUndefined();
    expect(await service.store.listIds("deferred")).toEqual([event.id]);
  });

  it("drops the deferral bookkeeping on the way out to a terminal state", async () => {
    const service = makeService();
    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_locked01", deferReason: "waiting" });

    // Reachable through the manual override; `Job.blockedOn` is non-null
    // exactly while the job is deferred, so a processed event may not carry it.
    const requeued = await service.requeue(event.id, { onlyFrom: ["failed", "deferred"] });
    expect(requeued.blockedOn).toBeUndefined();
    const processed = await service.complete(event.id);
    expect(processed.blockedOn).toBeUndefined();
    expect(onDisk(service, "processed", event.id)).not.toHaveProperty("blockedOn");
    expect(onDisk(service, "processed", event.id)).not.toHaveProperty("deferReason");
  });

  it("survives a restart, still deferred and still counted", async () => {
    const service = makeService();
    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_locked01", deferReason: "waiting" });

    const restarted = makeService();

    expect(await restarted.status()).toMatchObject({ deferred: 1 });
    expect(mirror.replacements.at(-1)).toEqual([
      expect.objectContaining({ id: event.id, status: "deferred", blockedOn: "doc_locked01" }),
    ]);
  });
});

describe("requeueDeferredFor", () => {
  const deferOn = async (service: QueueService, docId: string): Promise<StoredEvent> => {
    const event = await service.enqueue({ type: "comment.created", source: "cli", payload: {} });
    await service.claimAll();
    return service.defer(event.id, { blockedOn: docId });
  };

  it("returns every event deferred on the document to pending, and wakes a parked poll", async () => {
    const service = makeService();
    const first = await deferOn(service, "doc_locked01");
    const second = await deferOn(service, "doc_locked01");
    const elsewhere = await deferOn(service, "doc_other001");
    invalidations.length = 0;
    const parked = service.idle({ timeoutMs: 2000 });

    const requeued = await service.requeueDeferredFor("doc_locked01");

    expect(requeued.sort()).toEqual([first.id, second.id].sort());
    expect((await service.store.listIds("pending")).sort()).toEqual([first.id, second.id].sort());
    expect(await service.store.listIds("deferred")).toEqual([elsewhere.id]);
    expect(invalidations).toEqual([QUEUE_QUERY_KEYS]);
    expect((await parked)?.events.map((event) => event.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it("clears the deferral bookkeeping as the event re-enters", async () => {
    const service = makeService();
    const event = await deferOn(service, "doc_locked01");

    await service.requeueDeferredFor("doc_locked01");

    const pending: unknown = JSON.parse(
      readFileSync(service.store.pathFor("pending", event.id), "utf8"),
    );
    expect(pending).toMatchObject({ status: "pending" });
    expect(pending).not.toHaveProperty("blockedOn");
    expect(pending).not.toHaveProperty("deferReason");
    expect(mirror.upserts.at(-1)?.blockedOn).toBeUndefined();
  });

  it("re-enters each event exactly once, and a second trigger is a no-op", async () => {
    const service = makeService();
    const event = await deferOn(service, "doc_locked01");

    expect(await service.requeueDeferredFor("doc_locked01")).toEqual([event.id]);
    invalidations.length = 0;
    // A break following a release, or a reap of a lock nobody re-took.
    expect(await service.requeueDeferredFor("doc_locked01")).toEqual([]);
    expect(await service.store.listIds("pending")).toEqual([event.id]);
    expect(invalidations).toEqual([]);
  });

  it("is a silent no-op for a document nothing was deferred on", async () => {
    const service = makeService();

    expect(await service.requeueDeferredFor("doc_nothing1")).toEqual([]);
    expect(invalidations).toEqual([]);
  });

  it("keeps the attempt count, which waiting for a lock did not spend", async () => {
    const service = makeService({ staleAfterMs: 1_000 });
    const event = await service.enqueue({ type: "comment.created", source: "cli", payload: {} });
    await service.claimAll();
    clock += 60_000;
    await service.reapStale();
    await service.claimAll();
    await service.defer(event.id, { blockedOn: "doc_locked01" });

    await service.requeueDeferredFor("doc_locked01");

    // Only a manual `job retry` asserts a clean slate; a deferral is not an
    // attempt, and resetting here would let a repeatedly-stale event outlive
    // the cap by being deferred once.
    const pending: unknown = JSON.parse(
      readFileSync(service.store.pathFor("pending", event.id), "utf8"),
    );
    expect(pending).toMatchObject({ attempts: 1 });
  });

  it("never reports a half-applied batch to a poll that ticks mid-requeue", async () => {
    const service = makeService();
    const first = await deferOn(service, "doc_locked01");
    const second = await deferOn(service, "doc_locked01");

    // The 10 ms poll tick hits this window by luck; here it is forced, because a
    // test that reproduces one time in twenty is how INFRA-020's four gate
    // cycles were spent. The delay sits between the two pending writes, so any
    // reader that is not serialized against the requeue sees exactly one of them.
    const realWrite = service.store.writeEvent.bind(service.store);
    let pendingWrites = 0;
    vi.spyOn(service.store, "writeEvent").mockImplementation(async (status, event) => {
      await realWrite(status, event);
      if (status === "pending") {
        pendingWrites += 1;
        if (pendingWrites === 1) await new Promise((resolve) => setTimeout(resolve, 60));
      }
    });

    const parked = service.idle({ timeoutMs: 2000 });
    const requeued = await service.requeueDeferredFor("doc_locked01");

    expect(requeued.sort()).toEqual([first.id, second.id].sort());
    // Waits on the condition — both events available — not on a duration.
    expect((await parked)?.events.map((event) => event.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it("quarantines a corrupt file in deferred/ rather than skipping it forever", async () => {
    const service = makeService();
    writeFileSync(service.store.pathFor("deferred", "evt_bad000000000"), "not json");

    expect(await service.requeueDeferredFor("doc_locked01")).toEqual([]);
    expect(await service.store.listIds("failed")).toEqual(["evt_bad000000000"]);
    expect(await service.store.listIds("deferred")).toEqual([]);
  });
});

describe("requeue", () => {
  it("returns an event to pending with a clean slate and wakes a parked poll", async () => {
    const service = makeService();
    const event = await service.enqueue({
      type: "comment.created",
      source: "ui",
      payload: { a: 1 },
    });
    await service.claimAll();
    await service.fail(event.id, "boom");
    invalidations.length = 0;
    const parked = service.idle({ timeoutMs: 2000 });

    const requeued = await service.requeue(event.id);

    expect(requeued).toMatchObject({ status: "pending", attempts: 0, payload: { a: 1 } });
    // A retry is an assertion that the run can start over: the recorded failure
    // must not travel with it.
    expect(requeued.error).toBeUndefined();
    const onDisk: unknown = JSON.parse(
      readFileSync(service.store.pathFor("pending", event.id), "utf8"),
    );
    expect(onDisk).toMatchObject({ status: "pending", attempts: 0 });
    expect(onDisk).not.toHaveProperty("error");
    expect(invalidations).toContainEqual(QUEUE_QUERY_KEYS);
    expect((await parked)?.events.map((pending) => pending.id)).toEqual([event.id]);
  });

  it("is a no-op for an event that is already pending", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });

    expect((await service.requeue(event.id)).status).toBe("pending");
    expect(await service.store.listIds("pending")).toEqual([event.id]);
  });

  it("404s an unknown id and quarantines a corrupt file", async () => {
    const service = makeService();
    await expect(service.requeue("evt_missing00000")).rejects.toMatchObject({ status: 404 });

    writeFileSync(service.store.pathFor("failed", "evt_bad000000000"), "not json");
    expect((await service.requeue("evt_bad000000000")).status).toBe("failed");
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
    expect((await parked)?.events.map((each) => each.id)).toEqual([event.id]);
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

    expect((await service.claimAll()).events).toEqual([]);
  });

  it("skips an event whose file disappeared between the move and the read", async () => {
    const service = makeService();
    await enqueueMany(service, 1);
    vi.spyOn(service.store, "readEvent").mockResolvedValue(undefined);

    expect((await service.claimAll()).events).toEqual([]);
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
    for (const status of QUEUE_EVENT_STATUSES) {
      writeFileSync(join(service.store.dirFor(status), ".gitkeep"), "");
    }

    expect(await service.status()).toEqual({
      halted: false,
      pending: 0,
      inProgress: 2,
      deferred: 0,
      processed: 1,
      failed: 1,
      abandoned: 0,
    });
  });

  // Regression, CONTRACT-021: `status()` used to map over the contract's status
  // list and destructure the counts positionally, so inserting `deferred` at
  // index 2 shifted every later count by one — `corpus queue status` reported
  // deferrals as processed, processed as failed, and dropped `abandoned`
  // entirely, with nothing failing to compile. A fixture with the same count in
  // every directory cannot see an offset, so every directory gets a distinct
  // one and each is asserted by name.
  it("reports each status directory's own count, not its neighbour's", async () => {
    const service = makeService();
    const counts: Record<QueueEventStatus, number> = {
      pending: 1,
      "in-progress": 2,
      deferred: 3,
      processed: 4,
      failed: 5,
      abandoned: 6,
    };
    for (const [status, count] of Object.entries(counts) as [QueueEventStatus, number][]) {
      for (let index = 0; index < count; index += 1) {
        writeFileSync(
          join(service.store.dirFor(status), `evt_${status.replace("-", "")}${String(index)}.json`),
          "{}",
        );
      }
    }

    expect(await service.status()).toEqual({
      halted: false,
      pending: 1,
      inProgress: 2,
      deferred: 3,
      processed: 4,
      failed: 5,
      abandoned: 6,
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

  // SERVER-063. The rebuild runs from the *constructor*, so the pre-fix rethrow
  // was not "the queue is degraded": it was `corpus server start` reporting that
  // the server exited during startup, over one file, with no server left to ask
  // why. The projection's own boot pass was already skipping the same file one
  // line above the crash — this makes the readers agree.
  it("skips a file it cannot read at all at boot, and still boots and serves", async () => {
    const seeded = makeService();
    const [held] = await enqueueMany(seeded, 1);
    if (held === undefined) throw new Error("expected one event");
    await seeded.claimAll();
    // A real unreadable entry, and one no user can read by accident: `readdir`
    // lists it as an event file and every read of it fails with EISDIR. A
    // `chmod` would be bypassed by root and let this pass without proving
    // anything.
    mkdirSync(join(corpusDir, "queue", "in-progress", "evt_unreadable00.json"));
    mirror = makeMirror();
    const logger = { level: "silent" as const, info: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const service = makeService({ logger });

    // Booted — and the mirror carries the readable event *only*: an event the
    // projection could not read must not be reported as present, nor counted as
    // something it is not.
    expect(mirror.replacements[0]?.map((event) => [event.id, event.status])).toEqual([
      [held.id, "in-progress"],
    ]);
    // Named, with its reason, at the one level a `silent` server still writes.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith("skipping unreadable queue event", {
      id: "evt_unreadable00",
      status: "in-progress",
      reason: expect.stringContaining("EISDIR") as string,
    });
    // Skipped, never quarantined: boot is a read, and moving a file the process
    // could not read is not something a boot should attempt (SPEC.md §7).
    expect(readdirSync(join(corpusDir, "queue", "in-progress")).sort()).toEqual(
      ["evt_unreadable00.json", `${held.id}.json`].sort(),
    );
    expect(readdirSync(join(corpusDir, "queue", "failed"))).toEqual([]);

    // Serving: a full round trip through the very directory the bad entry sits
    // in, with the in-progress report skipping it exactly as the boot scan did.
    const fresh = await service.enqueue({ type: "comment.created", source: "cli", payload: {} });
    const batch = await service.claimAll();
    expect(batch.events.map((event) => event.id)).toEqual([fresh.id]);
    expect(batch.held.events.map((event) => event.id)).toEqual([held.id]);
    expect(batch.held.total).toBe(1);
    expect((await service.complete(fresh.id)).status).toBe("processed");
  });

  // SERVER-063 review round. The rebuild also runs from `attachMirror`, which
  // `attachProjection` calls during boot — and a status directory that cannot be
  // listed used to throw straight out of it, with the same result as the file
  // case above: no server, and no server left to ask why.
  it("skips a status directory it cannot list at boot, and still boots and serves", async () => {
    const logger = { level: "silent" as const, info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const service = makeService({ logger });
    const [held, done] = await enqueueMany(service, 2);
    if (held === undefined || done === undefined) throw new Error("expected two events");
    await service.claimAll();
    await service.complete(done.id);
    // Unlistable for every user, root included — `readdirSync` on a path that is
    // not a directory is ENOTDIR for everyone, the directory-level twin of the
    // EISDIR trick above. A `chmod 000` (the shape this was reported as) would
    // be bypassed by root, and is pinned at the store's seam in project.test.ts.
    const processedDir = join(corpusDir, "queue", "processed");
    rmSync(processedDir, { recursive: true });
    writeFileSync(processedDir, "not a directory\n");
    const late = makeMirror();

    const scan = service.attachMirror(late);

    // Alive, and honest about the loss: the processed event is excluded from the
    // mirror rather than counted as something it is not, and the *other* status
    // directories are still scanned.
    expect(scan.unlistable).toEqual([
      { status: "processed", reason: expect.stringContaining("ENOTDIR") as string },
    ]);
    expect(late.replacements[0]?.map((event) => [event.id, event.status])).toEqual([
      [held.id, "in-progress"],
    ]);
    // Named, with the consequence an operator needs, at the one level a `silent`
    // server still writes.
    expect(logger.error).toHaveBeenCalledWith(
      "cannot list queue status directory; its events are missing from the projection",
      { status: "processed", reason: expect.stringContaining("ENOTDIR") as string },
    );
    // Nothing moved or quarantined: boot is a read.
    expect(readFileSync(processedDir, "utf8")).toBe("not a directory\n");

    // Serving: a full round trip through the directories that are still there.
    const fresh = await service.enqueue({ type: "comment.created", source: "cli", payload: {} });
    const batch = await service.claimAll();
    expect(batch.events.map((event) => event.id)).toEqual([fresh.id]);
    expect(batch.held.events.map((event) => event.id)).toEqual([held.id]);
  });

  it("rebuilds into a mirror attached after construction, and uses it from then on", async () => {
    const service = makeService();
    const seeded = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });

    // The projection opens after `createServer`, so the real mirror arrives late.
    const late = makeMirror();
    const scan = service.attachMirror(late);

    expect(scan.malformed).toEqual([]);
    expect(late.replacements).toHaveLength(1);
    expect(late.replacements[0]?.map((event) => [event.id, event.status])).toEqual([
      [seeded.id, "pending"],
    ]);

    await service.complete(seeded.id);
    expect(late.upserts.at(-1)).toMatchObject({ id: seeded.id, status: "processed" });
    // The mirror handed to the constructor stops receiving anything: it saw the
    // enqueue and nothing after the swap.
    expect(mirror.upserts.map((event) => event.status)).toEqual(["pending"]);
  });

  it("runs with no mirror and no invalidation bus wired in", async () => {
    const service = createQueueService({ corpusDir, pollIntervalMs: 10 });
    services.push(service);
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    expect((await service.complete(event.id)).status).toBe("processed");
  });
});

// SPEC.md §4's commit-window closers (SERVER-092). "A queue event finished,
// however it finished — completed, failed, deferred (§7) or abandoned" closes
// the open window, so the agent's stewardship for one event is one commit
// rather than one per document it touched. The queue writes only to
// `.corpus/queue/`, which is gitignored: it commits nothing, opens no window,
// and this is the whole of its involvement.
describe("a finished event closes the commit window (§4)", () => {
  /** The service, plus every close it asked for — the call is what this owes. */
  const withCloser = (): { service: QueueService; closes: number[] } => {
    const closes: number[] = [];
    const service = makeService();
    service.attachWindowCloser(() => {
      closes.push(closes.length);
      return Promise.resolve();
    });
    return { service, closes };
  };

  it.each([
    ["completed", async (service: QueueService, id: string) => service.complete(id)],
    ["failed", async (service: QueueService, id: string) => service.fail(id, "boom")],
    ["abandoned", async (service: QueueService, id: string) => service.abandon(id)],
  ])("closes it when an event is %s", async (_name, finish) => {
    const { service, closes } = withCloser();
    const [event] = await enqueueMany(service, 1);
    await service.claimAll();
    // Claiming begins the work; §4 closes on an *ending*, so nothing yet.
    expect(closes).toHaveLength(0);

    await finish(service, event?.id ?? "");
    expect(closes).toHaveLength(1);
  });

  it("closes it on a deferral, and the rider accepts the two commits that costs", async () => {
    // §4: "an event deferred on a lock ends the agent's window like any other
    // ending, so one act that resumes later lands as two commits — accepted,
    // rather than hold a window open across a wait of unknown length".
    const { service, closes } = withCloser();
    const [event] = await enqueueMany(service, 1);
    await service.claimAll();
    await service.defer(event?.id ?? "", { blockedOn: "doc_aaaa1111" });
    expect(closes).toHaveLength(1);

    // Re-entry is the *start* of the work again, not an ending.
    await service.requeue(event?.id ?? "");
    expect(closes).toHaveLength(1);
    await service.claimAll();
    expect(closes).toHaveLength(1);

    await service.complete(event?.id ?? "");
    expect(closes).toHaveLength(2);
  });

  it("closes nothing when a repeat of a terminal verb finishes nothing", async () => {
    const { service, closes } = withCloser();
    const [event] = await enqueueMany(service, 1);
    await service.claimAll();
    await service.fail(event?.id ?? "", "boom");
    expect(closes).toHaveLength(1);

    // Idempotent, and nothing ended: the event was already failed.
    await service.fail(event?.id ?? "", "again");
    expect(closes).toHaveLength(1);
  });

  it("runs with no closer bound at all", async () => {
    const service = makeService();
    const [event] = await enqueueMany(service, 1);
    await service.claimAll();
    expect((await service.complete(event?.id ?? "")).status).toBe("processed");
  });
});
