import { describe, expect, it } from "vitest";
import {
  CORE_QUEUE_EVENT_TYPES,
  ClaimBatchSchema,
  CoreQueueEventTypeSchema,
  FailEventRequestSchema,
  QUEUE_EVENT_STATUSES,
  QueueEventSchema,
  QueueEventStatusSchema,
  QueueStatusSchema,
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
