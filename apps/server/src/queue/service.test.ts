import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ORCHESTRATOR_LANE,
  QUEUE_EVENT_STATUSES,
  type QueryKey,
  type QueueEventStatus,
} from "@corpus/contract";
import { HttpError } from "../errors.js";
import type { QueueMirror } from "./project.js";
import { QUEUE_TRANSITION_QUERY_KEYS } from "./project.js";
import { formatInstant } from "../core/time.js";
import { LANE_GRACE_MS, createLaneTracker } from "./liveness.js";
import {
  createQueueService,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_STALE_AFTER_MS,
  QueueService,
} from "./service.js";
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
    // Every one of these lands an event in `pending/`, which moves a lane's
    // `pending` count and so names the roster too (SERVER-155).
    expect(invalidations).toEqual([QUEUE_TRANSITION_QUERY_KEYS]);
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

// SPEC.md §7: a resident works its conversation inline, one event at a time, and
// the skill that does so reads the order off the batch. It used to be `readdir`
// order — the event id's, which is random against the conversation (SERVER-131).
describe("the batch is in the order the conversation has it", () => {
  const LANE = "th_resident";

  /**
   * Three events posted in this order, with ids that sort the *other* way, so a
   * batch in id order and a batch in conversation order can never be confused.
   * Ids come from the real drill (2026-08-19), where the conversation ran
   * X → Y → Z and the batch came back Y, Z, X.
   */
  const POSTED = ["evt_y3blrq32r2n6", "evt_q7yaplbvcjop", "evt_xqr572cqvjf3"] as const;
  const BY_ID = [...POSTED].sort();

  const postThree = async (
    service: QueueService,
    options: { readonly apart?: boolean; readonly recipient?: string } = {},
  ): Promise<void> => {
    for (const [index, id] of POSTED.entries()) {
      if (options.apart === true) clock += 60_000;
      await service.enqueue({
        id,
        type: "comment.created",
        source: "ui",
        payload: { threadId: LANE, message: index },
        ...(options.recipient === undefined ? {} : { recipient: options.recipient }),
      });
    }
  };

  it("orders one second's replies by when they were posted, not by their ids", async () => {
    const service = makeService();
    // The clock does not move: three replies inside one second share `created`
    // to the character (SPEC.md §5 stamps instants to the second), which is
    // exactly the drill that found this.
    await postThree(service);
    const created = new Set(
      (await Promise.all(POSTED.map((id) => service.store.readEvent("pending", id)))).map((read) =>
        read?.ok === true ? read.event.created : "",
      ),
    );
    expect(created.size).toBe(1);
    expect(BY_ID).not.toEqual([...POSTED]);

    const claimed = await service.claimAll();
    expect(claimed.events.map((event) => event.id)).toEqual([...POSTED]);
    expect(claimed.events.map((event) => event.payload.message)).toEqual([0, 1, 2]);
  });

  it("orders replies minutes apart by `created`", async () => {
    const service = makeService();
    await postThree(service, { apart: true });

    const claimed = await service.claimAll();
    expect(claimed.events.map((event) => event.id)).toEqual([...POSTED]);
    expect(new Set(claimed.events.map((event) => event.created)).size).toBe(3);
  });

  it("orders a scoped lane's batch the same way as the orchestrator's", async () => {
    const service = makeService();
    service.attachScopeLookup(() => LANE);
    await postThree(service);

    const claimed = await service.claimAll({ scope: LANE });
    expect(claimed.events.map((event) => event.lane)).toEqual([LANE, LANE, LANE]);
    expect(claimed.events.map((event) => event.id)).toEqual([...POSTED]);
  });

  // `idle` reports what the `claim-all` that follows it will hand over, so the
  // two entry points must not disagree about the conversation's order either.
  it("reports the same order from idle as claim-all then hands over", async () => {
    const service = makeService();
    await postThree(service);

    const seen = await service.idle({ timeoutMs: 50 });
    expect(seen?.events.map((event) => event.id)).toEqual([...POSTED]);
    expect((await service.claimAll()).events.map((event) => event.id)).toEqual([...POSTED]);
  });

  it("keeps a retried event in its place rather than moving it to the end", async () => {
    const service = makeService();
    await postThree(service);
    await service.claimAll();
    await service.fail(POSTED[0]);
    clock += 300_000;
    await service.requeue(POSTED[0]);

    const requeued = await service.store.readEvent("pending", POSTED[0]);
    expect(requeued?.ok === true ? requeued.event.seq : undefined).toBe(clock - 300_000);
    // Re-claimed beside a message posted after it, it is still the earlier one.
    await service.enqueue({ type: "comment.created", source: "ui", payload: { message: "later" } });
    const claimed = await service.claimAll();
    expect(claimed.events[0]?.id).toBe(POSTED[0]);
  });

  it("puts an unreadable file last so a quarantine never splits a conversation", async () => {
    const service = makeService();
    await postThree(service);
    // `evt_a…` sorts before every posted id, so `readdir` order would put it
    // first and the old loop would have claimed it in the middle of the batch.
    writeFileSync(service.store.pathFor("pending", "evt_a00000000000"), "{ truncated");

    const claimed = await service.claimAll();
    expect(claimed.events.map((event) => event.id)).toEqual([...POSTED]);
    expect(await service.store.listIds("failed")).toEqual(["evt_a00000000000"]);
  });

  it("stamps a strictly increasing seq even when the clock does not move", async () => {
    const service = makeService();
    await postThree(service);

    const seqs = (
      await Promise.all(POSTED.map((id) => service.store.readEvent("pending", id)))
    ).map((read) => (read?.ok === true ? read.event.seq : undefined));
    expect(seqs).toEqual([clock, clock + 1, clock + 2]);
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

  /**
   * SERVER-145. A repeat used to answer `200` with the first reason still on the
   * file, so a caller that passed a second reason was told the event was failed
   * and never told its reason went nowhere. The refusal says `already`, writes
   * nothing, and leaves the first reason exactly where it was.
   */
  it("refuses a repeat by name, leaving the first reason in place", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.claimAll();
    await service.fail(event.id, "first");

    await expect(service.fail(event.id, "second")).rejects.toMatchObject({
      status: 409,
      body: { message: `queue event ${event.id} is already failed` },
    });
    const failed: unknown = JSON.parse(
      readFileSync(service.store.pathFor("failed", event.id), "utf8"),
    );
    expect(failed).toMatchObject({ error: "first" });
    expect(await service.store.listIds("failed")).toEqual([event.id]);
  });

  /**
   * The pair from SERVER-145's reproduction: a `processed` event re-settled to
   * `failed` and back, exit 0 both times. The event is claimed and completed
   * once, and every later settle is refused with the state it is already in.
   */
  it("refuses to re-settle a processed event in either direction", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.claimAll();
    await service.complete(event.id);

    await expect(service.fail(event.id, "stray")).rejects.toMatchObject({
      status: 409,
      body: {
        message: `queue event ${event.id} is processed; only in-progress work can be failed`,
      },
    });
    await expect(service.complete(event.id)).rejects.toMatchObject({
      status: 409,
      body: { message: `queue event ${event.id} is already processed` },
    });
    await expect(service.defer(event.id, { blockedOn: "doc_a1b2c3d4" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(service.abandon(event.id)).rejects.toMatchObject({
      status: 409,
      body: {
        message:
          `queue event ${event.id} is processed; ` +
          "only pending, in-progress, deferred or failed work can be abandoned",
      },
    });

    // Nothing moved: the account of what happened to this event is unchanged.
    expect(await service.store.listIds("processed")).toEqual([event.id]);
    expect(await service.store.listIds("failed")).toEqual([]);
    expect(await service.store.listIds("abandoned")).toEqual([]);
  });

  /**
   * Worse than the filed defect and found while reproducing it: settling work
   * **nobody ever claimed** moved it straight out of `pending/`, so the work was
   * never done and the event was gone. SPEC.md §7: "nobody settles work they did
   * not claim".
   */
  it("refuses to settle work nobody claimed", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });

    await expect(service.complete(event.id)).rejects.toMatchObject({
      status: 409,
      body: {
        message: `queue event ${event.id} is pending; only in-progress work can be completed`,
      },
    });
    await expect(service.fail(event.id, "never ran")).rejects.toMatchObject({ status: 409 });
    expect(await service.store.listIds("pending")).toEqual([event.id]);
  });

  /**
   * Abandon is the operator's give-up, not the agent's report, so it is admitted
   * from more than `in-progress` — the console offers it on a failed job beside
   * `retry` (SPEC.md §7), and `job abandon` calls straight into it.
   */
  it("abandons a failed event, and refuses a second abandon by name", async () => {
    const service = makeService();
    const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
    await service.claimAll();
    await service.fail(event.id, "boom");

    expect((await service.abandon(event.id)).status).toBe("abandoned");
    await expect(service.abandon(event.id)).rejects.toMatchObject({
      status: 409,
      body: { message: `queue event ${event.id} is already abandoned` },
    });
    expect(await service.store.listIds("abandoned")).toEqual([event.id]);
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
      blockedOn: "doc_edited01",
      deferReason: "the user is editing it",
    });

    expect(deferred).toMatchObject({
      status: "deferred",
      blockedOn: "doc_edited01",
      deferReason: "the user is editing it",
      payload: { parentId: "th_abcd1234" },
    });
    expect(await service.store.listIds("deferred")).toEqual([event.id]);
    expect(await service.store.listIds("in-progress")).toEqual([]);
    // On disk, because §7's "never silently dropped" has to survive a restart —
    // the deferral is a property of the file, not of this process.
    expect(onDisk(service, "deferred", event.id)).toMatchObject({
      status: "deferred",
      blockedOn: "doc_edited01",
      deferReason: "the user is editing it",
    });
    expect(mirror.upserts.at(-1)).toMatchObject({ status: "deferred", blockedOn: "doc_edited01" });
    // The event leaves `in-progress/`, so the lane that was reported as working
    // on it stops being — hence `["agents"]` alongside the queue's own keys
    // (SERVER-115). Asserted by value as well as by symbol: a table that lost a
    // key would still satisfy the symbol.
    expect(invalidations).toEqual([[["queue"], ["jobs"], ["docs"], ["agents"]]]);
    expect(invalidations).toEqual([QUEUE_TRANSITION_QUERY_KEYS]);
  });

  it("is not a failure: the failed count stays put and the deferred count moves", async () => {
    const service = makeService();
    const event = await claimed(service);

    await service.defer(event.id, { blockedOn: "doc_edited01" });

    expect(await service.status()).toMatchObject({ deferred: 1, failed: 0, inProgress: 0 });
  });

  it("accepts a deferral with no reason", async () => {
    const service = makeService();
    const event = await claimed(service);

    const deferred = await service.defer(event.id, { blockedOn: "doc_edited01" });

    expect(deferred.deferReason).toBeUndefined();
    expect(onDisk(service, "deferred", event.id)).not.toHaveProperty("deferReason");
  });

  it("409s anything that is not in-progress, including a second defer", async () => {
    const service = makeService();
    const pending = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });

    // Nothing has tried the edit yet.
    await expect(service.defer(pending.id, { blockedOn: "doc_edited01" })).rejects.toMatchObject({
      status: 409,
      message: `queue event ${pending.id} is pending; only in-progress work can be deferred`,
    });

    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_edited01" });
    // A repeat is a refusal, not a silent no-op that would look like it worked.
    await expect(service.defer(event.id, { blockedOn: "doc_other001" })).rejects.toMatchObject({
      status: 409,
    });
    expect(onDisk(service, "deferred", event.id)).toMatchObject({ blockedOn: "doc_edited01" });

    const done = await claimed(service);
    await service.complete(done.id);
    await expect(service.defer(done.id, { blockedOn: "doc_edited01" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("404s an unknown id", async () => {
    const service = makeService();
    await expect(
      service.defer("evt_missing00000", { blockedOn: "doc_edited01" }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      service.defer("evt_missing00000", { blockedOn: "doc_edited01" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a deferred event out of claim-all and out of idle", async () => {
    const service = makeService();
    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_edited01" });

    // Handing it back would spin the agent against a document it has already
    // decided to leave alone.
    expect((await service.claimAll()).events).toEqual([]);
    expect(await service.idle({ timeoutMs: 20 })).toBeUndefined();
    expect(await service.store.listIds("deferred")).toEqual([event.id]);
  });

  it("drops the deferral bookkeeping on the way out to a terminal state", async () => {
    const service = makeService();
    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_edited01", deferReason: "waiting" });

    // Reachable through the manual override; `Job.blockedOn` is non-null
    // exactly while the job is deferred, so a processed event may not carry it.
    const requeued = await service.requeue(event.id, { onlyFrom: ["failed", "deferred"] });
    expect(requeued.blockedOn).toBeUndefined();
    // A retry puts the event back at the **start** of the work, so it is claimed
    // again before it can be settled again (SERVER-145).
    await service.claimAll();
    const processed = await service.complete(event.id);
    expect(processed.blockedOn).toBeUndefined();
    expect(onDisk(service, "processed", event.id)).not.toHaveProperty("blockedOn");
    expect(onDisk(service, "processed", event.id)).not.toHaveProperty("deferReason");
  });

  it("survives a restart, still deferred and still counted", async () => {
    const service = makeService();
    const event = await claimed(service);
    await service.defer(event.id, { blockedOn: "doc_edited01", deferReason: "waiting" });

    const restarted = makeService();

    expect(await restarted.status()).toMatchObject({ deferred: 1 });
    expect(mirror.replacements.at(-1)).toEqual([
      expect.objectContaining({ id: event.id, status: "deferred", blockedOn: "doc_edited01" }),
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
    const first = await deferOn(service, "doc_edited01");
    const second = await deferOn(service, "doc_edited01");
    const elsewhere = await deferOn(service, "doc_other001");
    invalidations.length = 0;
    const parked = service.idle({ timeoutMs: 2000 });

    const requeued = await service.requeueDeferredFor("doc_edited01");

    expect(requeued.sort()).toEqual([first.id, second.id].sort());
    expect((await service.store.listIds("pending")).sort()).toEqual([first.id, second.id].sort());
    expect(await service.store.listIds("deferred")).toEqual([elsewhere.id]);
    // Every one of these lands an event in `pending/`, which moves a lane's
    // `pending` count and so names the roster too (SERVER-155).
    expect(invalidations).toEqual([QUEUE_TRANSITION_QUERY_KEYS]);
    expect((await parked)?.events.map((event) => event.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it("clears the deferral bookkeeping as the event re-enters", async () => {
    const service = makeService();
    const event = await deferOn(service, "doc_edited01");

    await service.requeueDeferredFor("doc_edited01");

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
    const event = await deferOn(service, "doc_edited01");

    expect(await service.requeueDeferredFor("doc_edited01")).toEqual([event.id]);
    invalidations.length = 0;
    // A second session ending on the same document.
    expect(await service.requeueDeferredFor("doc_edited01")).toEqual([]);
    expect(await service.store.listIds("pending")).toEqual([event.id]);
    expect(invalidations).toEqual([]);
  });

  it("is a silent no-op for a document nothing was deferred on", async () => {
    const service = makeService();

    expect(await service.requeueDeferredFor("doc_nothing1")).toEqual([]);
    expect(invalidations).toEqual([]);
  });

  it("keeps the attempt count, which waiting for a person did not spend", async () => {
    const service = makeService({ staleAfterMs: 1_000 });
    const event = await service.enqueue({ type: "comment.created", source: "cli", payload: {} });
    await service.claimAll();
    clock += 60_000;
    await service.reapStale();
    await service.claimAll();
    await service.defer(event.id, { blockedOn: "doc_edited01" });

    await service.requeueDeferredFor("doc_edited01");

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
    const first = await deferOn(service, "doc_edited01");
    const second = await deferOn(service, "doc_edited01");

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
    const requeued = await service.requeueDeferredFor("doc_edited01");

    expect(requeued.sort()).toEqual([first.id, second.id].sort());
    // Waits on the condition — both events available — not on a duration.
    expect((await parked)?.events.map((event) => event.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it("quarantines a corrupt file in deferred/ rather than skipping it forever", async () => {
    const service = makeService();
    writeFileSync(service.store.pathFor("deferred", "evt_bad000000000"), "not json");

    expect(await service.requeueDeferredFor("doc_edited01")).toEqual([]);
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
    // Every one of these lands an event in `pending/`, which moves a lane's
    // `pending` count and so names the roster too (SERVER-155).
    expect(invalidations).toContainEqual(QUEUE_TRANSITION_QUERY_KEYS);
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

  // Both spies go up **after** the claim, since a settle is now defined for
  // claimed work only (SERVER-145) and the claim itself needs the real store.
  it("404s a transition whose event moved away underneath it", async () => {
    const service = makeService();
    const [event] = await enqueueMany(service, 1);
    await service.claimAll();
    vi.spyOn(service.store, "move").mockResolvedValue(false);

    await expect(service.complete(event?.id ?? "")).rejects.toMatchObject({ status: 404 });
  });

  it("404s a transition whose file vanished between locate and read", async () => {
    const service = makeService();
    const [event] = await enqueueMany(service, 1);
    await service.claimAll();
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
      // Nothing parked on this service, and that is the measurement rather than
      // a placeholder: the queue is the thing a park would have reached.
      agent: { live: false, since: null },
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
      agent: { live: false, since: null },
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

    await service.claimAll();
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
    await service.claimAll();
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
    // §4: "an event the agent defers while a person is editing ends its window
    // like any other
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

    // Refused, and nothing ended: the event was already failed (SERVER-145 —
    // before it, this second call was a `200` that closed a second window).
    await expect(service.fail(event?.id ?? "", "again")).rejects.toMatchObject({ status: 409 });
    expect(closes).toHaveLength(1);
  });

  it("runs with no closer bound at all", async () => {
    const service = makeService();
    const [event] = await enqueueMany(service, 1);
    await service.claimAll();
    expect((await service.complete(event?.id ?? "")).status).toBe("processed");
  });
});

// SPEC.md §7's lanes (SERVER-111): the stamp, the partition it creates, and the
// fallback that keeps a lapsed lane's work from being silently not done.
describe("lanes", () => {
  const RESIDENT = "th_resident";
  const OTHER = "th_other";

  /** A service whose walk answers `lane` for every event; nothing is live. */
  const laned = (lane: string): QueueService => {
    const service = makeService();
    service.attachScopeLookup(() => lane);
    return service;
  };

  /** The scope lookup a real workspace supplies, as a payload-keyed table. */
  const routing = (table: Record<string, string>): QueueService => {
    const service = makeService();
    service.attachScopeLookup((payload) => table[String(payload.threadId)] ?? ORCHESTRATOR_LANE);
    return service;
  };

  const post = async (service: QueueService, threadId: string, recipient?: string) =>
    service.enqueue({
      type: "comment.created",
      source: "ui",
      payload: { threadId },
      ...(recipient === undefined ? {} : { recipient }),
    });

  describe("the stamp", () => {
    it("writes the walk's lane onto the file and the mirror", async () => {
      const service = laned(RESIDENT);
      const event = await service.enqueue({
        type: "comment.created",
        source: "ui",
        payload: { threadId: RESIDENT },
      });

      expect(event.lane).toBe(RESIDENT);
      const onDisk: unknown = JSON.parse(
        readFileSync(join(corpusDir, "queue", "pending", `${event.id}.json`), "utf8"),
      );
      expect(onDisk).toMatchObject({ lane: RESIDENT });
      expect(mirror.upserts.at(-1)?.lane).toBe(RESIDENT);
    });

    it("stamps the orchestrator's lane with no scope lookup bound", async () => {
      const service = makeService();
      const event = await service.enqueue({ type: "comment.created", source: "ui", payload: {} });
      expect(event.lane).toBe(ORCHESTRATOR_LANE);
    });

    it("lets a named recipient override the walk for that one event", async () => {
      const service = laned(RESIDENT);
      const summons = await post(service, RESIDENT, OTHER);
      expect(summons.lane).toBe(OTHER);
      // Nothing persisted: the next message from the same place is computed
      // afresh (§7 — an override "does not persist past the message it was set
      // on").
      expect((await post(service, RESIDENT)).lane).toBe(RESIDENT);
    });

    it("sends a resident.designated to the orchestrator whoever is designated", async () => {
      const service = laned(RESIDENT);
      const event = await service.enqueue({
        type: "resident.designated",
        source: "thread",
        payload: { threadId: RESIDENT, resident: { name: "Ana", docId: "doc_agent" } },
      });
      expect(event.lane).toBe(ORCHESTRATOR_LANE);
    });
  });

  describe("one consumer per lane", () => {
    it("hands a scoped claim only its own lane", async () => {
      const service = routing({ th_resident: RESIDENT });
      const mine = await post(service, "th_resident");
      await post(service, "th_elsewhere");

      const claimed = await service.claimAll({ scope: RESIDENT });
      expect(claimed.events.map((event) => event.id)).toEqual([mine.id]);
      // The orchestrator's event is untouched and still pending.
      expect(await service.store.listIds("pending")).toHaveLength(1);
    });

    it("never shows the orchestrator another lane's events", async () => {
      const service = routing({ th_resident: RESIDENT });
      await post(service, "th_resident");
      const mine = await post(service, "th_elsewhere");

      const claimed = await service.claimAll();
      expect(claimed.events.map((event) => event.id)).toEqual([mine.id]);
    });

    /**
     * **The reproduction** (SERVER-152). SPEC.md §7's rider signed 2026-08-25
     * removed the lapse fallback, and this is what it removed: no listener has
     * ever parked on `RESIDENT` here, which before the rider made its work the
     * orchestrator's after a grace window.
     *
     * That fallback is what starved listeners. The orchestrator held the lane's
     * events in `in-progress/`, so its own skill forbade launching that lane's
     * listener in the same pass; a conversation somebody kept using never had a
     * clear pass, and never got its agent.
     */
    it("leaves an absent lane's work alone, however long nobody listens", async () => {
      const service = routing({ th_resident: RESIDENT });
      const theirs = await post(service, "th_resident");

      expect((await service.claimAll()).events).toHaveLength(0);
      expect((await service.claimAll()).events).toHaveLength(0);
      // Untouched, and still pending — not claimed, not deferred, not moved.
      expect(await service.store.listIds("pending")).toEqual([theirs.id]);
    });

    /**
     * The converse, and the reason the assertion above is worth anything.
     * "Nothing was returned" is also what a wholly broken queue produces, so the
     * same fixture has to be claimable by the lane that owns it.
     */
    it("hands that identical event to the resident the moment it claims", async () => {
      const service = routing({ th_resident: RESIDENT });
      const theirs = await post(service, "th_resident");
      expect((await service.claimAll()).events).toHaveLength(0);

      const claimed = await service.claimAll({ scope: RESIDENT });
      expect(claimed.events.map((event) => event.id)).toEqual([theirs.id]);
      // The stamp was never rewritten by anything the orchestrator did or did
      // not do, because it never had a way to touch this lane.
      expect(claimed.events[0]?.lane).toBe(RESIDENT);
    });

    it("reads an unstamped legacy file as the orchestrator's", async () => {
      const service = makeService();
      writeFileSync(
        join(corpusDir, "queue", "pending", "evt_legacy.json"),
        JSON.stringify({
          id: "evt_legacy",
          type: "comment.created",
          created: "2026-07-19T10:05:00Z",
          source: "cli",
          payload: {},
        }),
        "utf8",
      );

      expect((await service.claimAll({ scope: RESIDENT })).events).toHaveLength(0);
      expect((await service.claimAll()).events.map((event) => event.id)).toEqual(["evt_legacy"]);
    });

    it("scopes the held report the way it scopes the claim", async () => {
      const service = routing({ th_resident: RESIDENT });
      await post(service, "th_resident");
      await post(service, "th_elsewhere");
      await service.claimAll({ scope: RESIDENT });
      await service.claimAll();

      const orchestrator = await service.claimAll();
      expect(orchestrator.held.total).toBe(1);
      expect(orchestrator.held.events[0]?.lane ?? ORCHESTRATOR_LANE).toBe(ORCHESTRATOR_LANE);

      const resident = await service.claimAll({ scope: RESIDENT });
      expect(resident.held.total).toBe(1);
      expect(resident.held.events[0]?.lane).toBe(RESIDENT);
    });
  });

  describe("parking", () => {
    // What a *park* owes: it ends on its own lane's work and on nothing else.
    // Which parked requests a wake-up is delivered to is the registry's own
    // question and is pinned in `waiters.test.ts` — from out here a waiter woken
    // for another lane's event finds nothing available and re-parks silently, so
    // the observable difference is this one.
    it("ends a scoped park on its own lane, and expires one that cannot see the event", async () => {
      const service = routing({ th_resident: RESIDENT });
      const orchestrator = service.idle({ timeoutMs: 100 });
      const resident = service.idle({ timeoutMs: 5_000, scope: RESIDENT });
      await vi.waitFor(() => {
        expect(service.parked).toBe(2);
      });

      await post(service, "th_resident");
      expect((await resident)?.events).toHaveLength(1);
      // The orchestrator's window expires with nothing rather than being woken
      // by another lane's arrival.
      expect(await orchestrator).toBeUndefined();
    });

    it("reports availability per lane, matching what the next claim would hand over", async () => {
      const service = routing({ th_resident: RESIDENT });
      await post(service, "th_resident");

      expect(await service.idle({ timeoutMs: 20 })).toBeUndefined();
      expect((await service.idle({ timeoutMs: 20, scope: RESIDENT }))?.events).toHaveLength(1);
    });
  });

  describe("transitions carry the lane", () => {
    it("keeps it across a manual retry, which rebuilds the event", async () => {
      const service = laned(RESIDENT);
      const event = await service.enqueue({
        type: "comment.created",
        source: "ui",
        payload: {},
      });
      await service.claimAll({ scope: RESIDENT });
      await service.fail(event.id, "boom");

      expect((await service.requeue(event.id)).lane).toBe(RESIDENT);
    });

    it("keeps it across a deferral's automatic re-entry", async () => {
      const service = laned(RESIDENT);
      const event = await service.enqueue({
        type: "comment.created",
        source: "ui",
        payload: {},
      });
      await service.claimAll({ scope: RESIDENT });
      await service.defer(event.id, { blockedOn: "doc_aaaa1111" });
      expect(await service.requeueDeferredFor("doc_aaaa1111")).toEqual([event.id]);

      const read = await service.store.readEvent("pending", event.id);
      expect(read?.ok === true && read.event.lane).toBe(RESIDENT);
    });

    it("reaps a lapsed lane's stuck work without re-routing it", async () => {
      const service = laned(RESIDENT);
      const event = await service.enqueue({
        type: "comment.created",
        source: "ui",
        payload: {},
      });
      await service.claimAll({ scope: RESIDENT });
      clock += DEFAULT_STALE_AFTER_MS + 1_000;

      expect((await service.reapStale()).reaped).toEqual([event.id]);
      const read = await service.store.readEvent("pending", event.id);
      expect(read?.ok === true && read.event.lane).toBe(RESIDENT);
    });
  });

  // SPEC.md §7's presence, at the seam the queue owns: holding an `idle` is what
  // makes a lane live, and the whole tracker arrives through one binding
  // (SERVER-112).
  describe("the presence tracker", () => {
    it("observes the park for the lane the request asked to consume", async () => {
      const service = laned(RESIDENT);
      const tracker = createLaneTracker({ now: () => clock });
      service.attachLaneTracker(tracker);

      const parked = service.idle({ timeoutMs: 5_000, scope: RESIDENT });
      await vi.waitFor(() => {
        expect(tracker.isLive(RESIDENT)).toBe(true);
      });
      expect(tracker.isLive(ORCHESTRATOR_LANE)).toBe(false);

      await post(service, "anything");
      await parked;
      // The hold ended; the lane stays live for the grace window.
      expect(tracker.isLive(RESIDENT)).toBe(true);
      clock += LANE_GRACE_MS;
      expect(tracker.isLive(RESIDENT)).toBe(false);
    });

    // The park an `idle` never made: with work already waiting the request
    // returns at once, and a listener busy enough that every call returns at
    // once would otherwise read as absent for exactly as long as it was busiest.
    it("observes a request that never had to wait", async () => {
      const service = routing({ th_resident: RESIDENT });
      const tracker = createLaneTracker({ now: () => clock });
      service.attachLaneTracker(tracker);
      await post(service, "th_resident");

      expect((await service.idle({ timeoutMs: 20, scope: RESIDENT }))?.events).toHaveLength(1);
      expect(tracker.isLive(RESIDENT)).toBe(true);
    });

    /**
     * This test used to assert the opposite (SERVER-152): that binding the
     * tracker bound the claim path's predicate, proved by claiming a lane's work
     * once it lapsed.
     *
     * SPEC.md §7's rider signed 2026-08-25 severs that wire. The tracker still
     * feeds the park observation and the status aggregate — both of which are
     * what a person reads on a roster — and feeds the claim nothing. So the
     * guarantee worth pinning is the **independence**: the same claim answers
     * the same way on both sides of a lapse, and only the roster changes.
     */
    it("feeds the roster and never the claim, on both sides of a lapse", async () => {
      const service = routing({ th_resident: RESIDENT });
      const tracker = createLaneTracker({ now: () => clock });
      service.attachLaneTracker(tracker);
      await post(service, "th_resident");

      const parked = service.idle({ timeoutMs: 5_000, scope: RESIDENT });
      await vi.waitFor(() => {
        expect(tracker.isLive(RESIDENT)).toBe(true);
      });
      // Live: the orchestrator sees nothing of this lane.
      expect((await service.claimAll()).events).toHaveLength(0);

      service.close();
      await parked;
      clock += LANE_GRACE_MS;

      // Lapsed: the roster's answer changed, and the claim's did not. Before
      // the rider this second claim returned the event.
      expect(tracker.isLive(RESIDENT)).toBe(false);
      expect((await service.claimAll()).events).toHaveLength(0);
    });

    it("reports the aggregate on the queue status, from the same observation", async () => {
      const service = makeService();
      const tracker = createLaneTracker({ now: () => clock });
      service.attachLaneTracker(tracker);
      expect((await service.status()).agent).toEqual({ live: false, since: null });

      const parked = service.idle({ timeoutMs: 5_000, scope: RESIDENT });
      await vi.waitFor(() => {
        expect(service.parked).toBe(1);
      });
      expect((await service.status()).agent).toEqual({ live: true, since: formatInstant(clock) });

      service.close();
      await parked;
    });

    /**
     * The test that used to live here asserted the opposite (SERVER-152): a
     * parked orchestrator was released the moment a lane lapsed, because the
     * lapse had just made that lane's work its own.
     *
     * SPEC.md §7's rider signed 2026-08-25 removes the fallback, so a lapse
     * hands nobody anything and there is nothing to wake for. This asserts the
     * silence, and pins the park staying parked rather than merely not
     * erroring — a wake that fired and found nothing would look identical from
     * outside if the park had already ended.
     */
    it("wakes nobody when a lane's listener goes away, because nothing moved", async () => {
      const service = makeService({ pollIntervalMs: 60_000 });
      service.attachScopeLookup(() => RESIDENT);
      await post(service, "th_resident");

      const orchestrator = service.idle({ timeoutMs: 150 });
      await vi.waitFor(() => {
        expect(service.parked).toBe(1);
      });

      // Nothing here can hand that event over: no lapse hook exists, and the
      // orchestrator's claim could not see the lane even if one did.
      expect(await orchestrator).toBeUndefined();
    });
  });

  describe("halt", () => {
    it("applies to every lane, and resume wakes them all", async () => {
      const service = routing({ th_resident: RESIDENT });
      await post(service, "th_resident");
      await post(service, "th_elsewhere");
      await service.halt("stop");

      expect((await service.claimAll({ scope: RESIDENT })).events).toHaveLength(0);
      expect((await service.claimAll()).events).toHaveLength(0);

      const orchestrator = service.idle({ timeoutMs: 5_000 });
      const resident = service.idle({ timeoutMs: 5_000, scope: RESIDENT });
      await vi.waitFor(() => {
        expect(service.parked).toBe(2);
      });
      await service.resume();
      expect((await orchestrator)?.events).toHaveLength(1);
      expect((await resident)?.events).toHaveLength(1);
    });
  });
});
