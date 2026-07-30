import { describe, expect, it } from "vitest";
import {
  CORE_QUEUE_EVENT_TYPES,
  ClaimBatchSchema,
  CoreQueueEventTypeSchema,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  DeferEventRequestSchema,
  FailEventRequestSchema,
  HaltQueueRequestSchema,
  IdleQuerySchema,
  IdleResultSchema,
  MAX_IDLE_TIMEOUT_SECONDS,
  QUEUE_EVENT_STATUSES,
  QueueEventSchema,
  QueueEventStatusSchema,
  QueueStatusSchema,
  ReapStaleResultSchema,
} from "./queue.js";

const event = {
  id: "evt_7c1d",
  type: "comment.created",
  created: "2026-07-19T10:05:01Z",
  source: "ui",
  payload: { threadId: "th_x9y8", parentId: "doc_a1b2c3" },
};

describe("QueueEvent", () => {
  it("round-trips the SPEC.md §7 event file", () => {
    expect(QueueEventSchema.parse(event)).toEqual(event);
  });

  it("accepts a plugin-defined type with an arbitrary payload", () => {
    const pluginEvent = { ...event, type: "todo.due", payload: { todoId: 4, nested: { a: [1] } } };
    expect(QueueEventSchema.parse(pluginEvent)).toEqual(pluginEvent);
  });

  it("accepts an empty payload", () => {
    expect(QueueEventSchema.parse({ ...event, payload: {} }).payload).toEqual({});
  });

  it("rejects an id that is not an event id", () => {
    expect(QueueEventSchema.safeParse({ ...event, id: "th_x9y8" }).success).toBe(false);
  });

  it("rejects a payload that is not an object", () => {
    expect(QueueEventSchema.safeParse({ ...event, payload: "threadId" }).success).toBe(false);
  });
});

describe("queue vocabularies", () => {
  it.each(CORE_QUEUE_EVENT_TYPES)("recognises the core type %s", (type) => {
    expect(CoreQueueEventTypeSchema.parse(type)).toBe(type);
  });

  it("does not treat a plugin type as a core type", () => {
    expect(CoreQueueEventTypeSchema.safeParse("todo.due").success).toBe(false);
  });

  it.each(QUEUE_EVENT_STATUSES)("recognises the status %s", (status) => {
    expect(QueueEventStatusSchema.parse(status)).toBe(status);
  });

  /**
   * CONTRACT-021. §7's status set gains exactly one member — the defer/requeue
   * state §7 itself names — and loses none: the interim `deferred:`-prefixed
   * failure protocol retires without any of the states it used going away.
   */
  it("adds `deferred` to §7's set and takes nothing away", () => {
    expect([...QUEUE_EVENT_STATUSES]).toEqual([
      "pending",
      "in-progress",
      "deferred",
      "processed",
      "failed",
      "abandoned",
    ]);
  });

  it("rejects a state nobody defined, so a typo is not a silent new directory", () => {
    for (const status of ["waiting", "blocked", "deferred:lock"]) {
      expect(QueueEventStatusSchema.safeParse(status).success, status).toBe(false);
    }
  });
});

describe("ClaimBatch", () => {
  it("round-trips a batch of claimed events", () => {
    expect(ClaimBatchSchema.parse({ events: [event] })).toEqual({ events: [event] });
  });

  it("round-trips the empty batch a halted queue returns", () => {
    expect(ClaimBatchSchema.parse({ events: [] })).toEqual({ events: [] });
  });
});

describe("IdleQuery", () => {
  it("defaults the long-poll window to the agent loop's rearm interval", () => {
    expect(IdleQuerySchema.parse({}).timeout).toBe(DEFAULT_IDLE_TIMEOUT_SECONDS);
  });

  it("reads the timeout from a query string, which carries numbers as text", () => {
    expect(IdleQuerySchema.parse({ timeout: "30" }).timeout).toBe(30);
  });

  it("rejects anything past the documented maximum rather than clamping it", () => {
    expect(IdleQuerySchema.safeParse({ timeout: MAX_IDLE_TIMEOUT_SECONDS }).success).toBe(true);
    expect(IdleQuerySchema.safeParse({ timeout: MAX_IDLE_TIMEOUT_SECONDS + 1 }).success).toBe(
      false,
    );
  });

  it.each([0, -1, 1.5])("rejects the timeout %s", (timeout) => {
    expect(IdleQuerySchema.safeParse({ timeout }).success).toBe(false);
  });
});

describe("IdleResult", () => {
  it("round-trips the events available to claim", () => {
    expect(IdleResultSchema.parse({ events: [event] })).toEqual({ events: [event] });
  });

  /** An empty 200 would be indistinguishable from the 204 timeout, so it is not a valid body. */
  it("rejects an empty list, because nothing pending is a 204 with no body", () => {
    expect(IdleResultSchema.safeParse({ events: [] }).success).toBe(false);
  });
});

describe("ReapStaleResult", () => {
  it("round-trips the events recovered from in-progress", () => {
    const result = { reaped: ["evt_7c1d"], failed: [] };
    expect(ReapStaleResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips a reap that found nothing stuck", () => {
    const result = { reaped: [], failed: [] };
    expect(ReapStaleResultSchema.parse(result)).toEqual(result);
  });

  /**
   * The half the route used to drop on the floor: an event whose attempts have
   * run out is given up on rather than recovered, and an operator running
   * `corpus queue reap-stale` has no other way to hear about it.
   */
  it("reports the given-up events separately from the recovered ones", () => {
    const result = { reaped: ["evt_7c1d"], failed: ["evt_dead"] };
    expect(ReapStaleResultSchema.parse(result)).toEqual(result);
  });

  it("requires both halves, so a reap cannot silently report only one", () => {
    expect(ReapStaleResultSchema.safeParse({ reaped: [] }).success).toBe(false);
    expect(ReapStaleResultSchema.safeParse({ failed: [] }).success).toBe(false);
  });

  it.each(["reaped", "failed"])("rejects an id in %s that is not an event id", (field) => {
    const result = { reaped: [], failed: [], [field]: ["doc_a1b2c3"] };
    expect(ReapStaleResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("QueueStatus", () => {
  it("round-trips halt state with per-status counts", () => {
    const status = {
      halted: true,
      pending: 3,
      inProgress: 1,
      deferred: 2,
      processed: 42,
      failed: 0,
      abandoned: 2,
    };
    expect(QueueStatusSchema.parse(status)).toEqual(status);
  });

  /**
   * Pinned by CONTRACT-001; widened once, by CONTRACT-021, because a deferral
   * counted as a failure is exactly the misreading SPEC.md §7 asks the surface
   * to stop making.
   */
  it("carries exactly the seven fields the console strip reads", () => {
    expect(Object.keys(QueueStatusSchema.shape)).toEqual([
      "halted",
      "pending",
      "inProgress",
      "deferred",
      "processed",
      "failed",
      "abandoned",
    ]);
  });

  it("requires every count, so a partial response is a validation failure", () => {
    expect(QueueStatusSchema.safeParse({ halted: false, pending: 0 }).success).toBe(false);
  });
});

describe("HaltQueueRequest", () => {
  /** A bare `POST /api/queue/halt` validates as `{}`, so the empty object must parse. */
  it("accepts a halt with no annotation at all", () => {
    expect(HaltQueueRequestSchema.parse({})).toEqual({});
  });

  it("carries a reason through", () => {
    expect(HaltQueueRequestSchema.parse({ reason: "deploying" })).toEqual({ reason: "deploying" });
  });

  /** A blank reason is worse than none: it records an annotation that says nothing. */
  it("rejects a blank reason", () => {
    expect(HaltQueueRequestSchema.safeParse({ reason: "" }).success).toBe(false);
  });

  it("leaves the reason optional rather than defaulting it", () => {
    expect(HaltQueueRequestSchema.parse({}).reason).toBeUndefined();
  });
});

/**
 * CONTRACT-021. The deferral's one mandatory fact is the document it waits on:
 * §7's "re-enters automatically on lock release" has nothing to key off without
 * it, and the payload cannot supply it for every event type.
 */
describe("DeferEventRequest", () => {
  it("carries the blocking document, with or without a note", () => {
    expect(DeferEventRequestSchema.parse({ blockedOn: "doc_a1b2c3" })).toEqual({
      blockedOn: "doc_a1b2c3",
    });
    const annotated = { blockedOn: "doc_a1b2c3", reason: "user is editing the budget" };
    expect(DeferEventRequestSchema.parse(annotated)).toEqual(annotated);
  });

  /** A thread is a document too (§6), and threads are locked like anything else. */
  it("accepts a thread id, since threads are documents", () => {
    expect(DeferEventRequestSchema.parse({ blockedOn: "th_x9y8" }).blockedOn).toBe("th_x9y8");
  });

  it("refuses a deferral that names no document, since it could never re-enter", () => {
    expect(DeferEventRequestSchema.safeParse({}).success).toBe(false);
    expect(DeferEventRequestSchema.safeParse({ reason: "locked" }).success).toBe(false);
  });

  it("refuses an event id where the blocking document belongs", () => {
    expect(DeferEventRequestSchema.safeParse({ blockedOn: "evt_7c1d" }).success).toBe(false);
  });

  it("refuses a blank reason, which records an annotation that says nothing", () => {
    expect(DeferEventRequestSchema.safeParse({ blockedOn: "doc_a1b2c3", reason: "" }).success).toBe(
      false,
    );
  });

  /** CONTRACT-017: `docId` is the plausible typo, and dropping it silently would wedge the event. */
  it.each(["docId", "lock", "until"])("rejects the unknown key %s", (key) => {
    expect(
      DeferEventRequestSchema.safeParse({ blockedOn: "doc_a1b2c3", [key]: "doc_a1b2c3" }).success,
    ).toBe(false);
  });
});

describe("FailEventRequest", () => {
  it("accepts a bodiless failure", () => {
    expect(FailEventRequestSchema.parse({})).toEqual({});
  });

  it("carries a reason through", () => {
    expect(FailEventRequestSchema.parse({ reason: "tool timeout" })).toEqual({
      reason: "tool timeout",
    });
  });
});
