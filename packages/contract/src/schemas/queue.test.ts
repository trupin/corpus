import { describe, expect, it } from "vitest";
import {
  CORE_QUEUE_EVENT_TYPES,
  ClaimBatchSchema,
  CoreQueueEventTypeSchema,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  FailEventRequestSchema,
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

  it("clamps the ask by rejecting anything past the documented maximum", () => {
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
    expect(ReapStaleResultSchema.parse({ reaped: ["evt_7c1d"] })).toEqual({ reaped: ["evt_7c1d"] });
  });

  it("round-trips a reap that found nothing stuck", () => {
    expect(ReapStaleResultSchema.parse({ reaped: [] })).toEqual({ reaped: [] });
  });

  it("rejects an id that is not an event id", () => {
    expect(ReapStaleResultSchema.safeParse({ reaped: ["doc_a1b2c3"] }).success).toBe(false);
  });
});

describe("QueueStatus", () => {
  it("round-trips halt state with per-status counts", () => {
    const status = {
      halted: true,
      pending: 3,
      inProgress: 1,
      processed: 42,
      failed: 0,
      abandoned: 2,
    };
    expect(QueueStatusSchema.parse(status)).toEqual(status);
  });

  /** Pinned by CONTRACT-001 and reused unchanged: widening it is out of scope here. */
  it("carries exactly the six fields the console strip reads", () => {
    expect(Object.keys(QueueStatusSchema.shape)).toEqual([
      "halted",
      "pending",
      "inProgress",
      "processed",
      "failed",
      "abandoned",
    ]);
  });

  it("requires every count, so a partial response is a validation failure", () => {
    expect(QueueStatusSchema.safeParse({ halted: false, pending: 0 }).success).toBe(false);
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
