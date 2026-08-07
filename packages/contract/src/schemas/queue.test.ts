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
  InProgressEventSchema,
  InProgressSetSchema,
  MAX_IDLE_TIMEOUT_SECONDS,
  MAX_IN_PROGRESS_REPORTED,
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

const held = {
  id: "evt_held",
  type: "comment.created",
  heldSince: "2026-07-19T09:41:00Z",
  originId: "th_x9y8",
  originTitle: "Re: 30-year fixed assumption",
};

/** Nothing held — the shape a healthy loop sees on every claim. */
const nothingHeld = { events: [], total: 0, truncated: false };

/**
 * CONTRACT-033, the wire half of SHARED-015. SPEC.md §7: "Claiming work also
 * reports the events the server currently holds `in-progress`, each with what it
 * is and how long it has been held." Everything pinned here is that sentence
 * and the rider's four resolved questions — nothing else.
 */
describe("InProgressEvent", () => {
  it("round-trips a held event", () => {
    expect(InProgressEventSchema.parse(held)).toEqual(held);
  });

  /**
   * The four facts §7's sentence and the rider's Q4 name: what it is (`id`,
   * `type`), where it came from (`originId`/`originTitle`), and how long it has
   * been held (`heldSince`). Pinned as an exact set so a fifth field is a
   * deliberate contract change rather than a drive-by.
   */
  it("carries what it is, where it came from, and since when", () => {
    expect(Object.keys(InProgressEventSchema.shape)).toEqual([
      "id",
      "type",
      "heldSince",
      "originId",
      "originTitle",
    ]);
  });

  /**
   * The instant-not-duration decision. A duration would parse here as a plain
   * number or a `PT3H`-style string; both are rejected, so a server that decided
   * to "help" by pre-computing the age cannot do it silently.
   */
  it("takes an instant, not an elapsed duration", () => {
    expect(InProgressEventSchema.safeParse({ ...held, heldSince: 10_800 }).success).toBe(false);
    expect(InProgressEventSchema.safeParse({ ...held, heldSince: "PT3H" }).success).toBe(false);
    expect(InProgressEventSchema.safeParse({ ...held, heldSince: "3h" }).success).toBe(false);
  });

  /** The `Job.originId` rule: an event whose payload names no document reports null, not "". */
  it("reports a missing origin as null on both halves", () => {
    const anonymous = { ...held, originId: null, originTitle: null };
    expect(InProgressEventSchema.parse(anonymous)).toEqual(anonymous);
  });

  /**
   * A title with no id would be a second, weaker way of saying where an event
   * came from — the thing reusing `Job`'s shape exists to avoid. Both halves are
   * required keys even though both are nullable, so neither can be omitted.
   */
  it("requires both origin halves as keys, nullable but never absent", () => {
    for (const key of ["originId", "originTitle"] as const) {
      const { [key]: _dropped, ...rest } = held;
      expect(InProgressEventSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("rejects an id that is not an event id, so a document cannot be listed as held", () => {
    expect(InProgressEventSchema.safeParse({ ...held, id: "doc_a1b2c3" }).success).toBe(false);
  });

  /** `originId` is a document id: a thread is a document (§6), an event is not. */
  it("accepts a thread as an origin and refuses an event", () => {
    expect(InProgressEventSchema.parse({ ...held, originId: "th_x9y8" }).originId).toBe("th_x9y8");
    expect(InProgressEventSchema.safeParse({ ...held, originId: "evt_7c1d" }).success).toBe(false);
  });

  /** Open, for the reason `QueueEvent.type` is: plugins define their own event types. */
  it("leaves the type open to plugin-defined values", () => {
    expect(InProgressEventSchema.parse({ ...held, type: "todo.due" }).type).toBe("todo.due");
    expect(InProgressEventSchema.safeParse({ ...held, type: "" }).success).toBe(false);
  });
});

describe("InProgressSet", () => {
  it("round-trips a set with one held event", () => {
    const set = { events: [held], total: 1, truncated: false };
    expect(InProgressSetSchema.parse(set)).toEqual(set);
  });

  it("round-trips the empty set a healthy loop sees", () => {
    expect(InProgressSetSchema.parse(nothingHeld)).toEqual(nothingHeld);
  });

  /**
   * The rider's Q2. The cap is published so a client author reads it, and
   * enforced so a server cannot quietly exceed it — a list longer than the cap
   * would mean the cap is not the contract it claims to be.
   */
  it("caps the list at the documented size and rejects a longer one", () => {
    const at = Array.from({ length: MAX_IN_PROGRESS_REPORTED }, (_, index) => ({
      ...held,
      id: `evt_${String(index).padStart(4, "0")}`,
    }));
    expect(
      InProgressSetSchema.safeParse({ events: at, total: at.length, truncated: false }).success,
    ).toBe(true);
    expect(
      InProgressSetSchema.safeParse({ events: [...at, held], total: 21, truncated: true }).success,
    ).toBe(false);
  });

  /**
   * The overflow signal, and the whole reason the cap is tolerable: a truncated
   * list still reports how many there really are. `total` minus the list's
   * length is the "and N more" — never a silent truncation (CONTRACT-030 set
   * this precedent on this very route, and `DocDiff` set the field pairing).
   */
  it("reports the real total alongside a truncated list", () => {
    const overflowing = {
      events: Array.from({ length: MAX_IN_PROGRESS_REPORTED }, () => held),
      total: 57,
      truncated: true,
    };
    const parsed = InProgressSetSchema.parse(overflowing);
    expect(parsed.total - parsed.events.length).toBe(57 - MAX_IN_PROGRESS_REPORTED);
    expect(parsed.truncated).toBe(true);
  });

  /**
   * Both halves of the signal are required. A set that omitted `truncated` would
   * make a capped list indistinguishable from a complete one at exactly the
   * boundary where it matters most, and one that omitted `total` could say it
   * was cut without ever saying by how much.
   */
  it("requires both halves of the overflow signal", () => {
    expect(InProgressSetSchema.safeParse({ events: [], total: 0 }).success).toBe(false);
    expect(InProgressSetSchema.safeParse({ events: [], truncated: false }).success).toBe(false);
  });

  it("rejects a negative or fractional total", () => {
    for (const total of [-1, 1.5]) {
      expect(InProgressSetSchema.safeParse({ ...nothingHeld, total }).success, `${total}`).toBe(
        false,
      );
    }
  });
});

describe("ClaimBatch", () => {
  it("round-trips a batch of claimed events", () => {
    const batch = { events: [event], inProgress: nothingHeld };
    expect(ClaimBatchSchema.parse(batch)).toEqual(batch);
  });

  it("round-trips the empty batch a halted queue returns", () => {
    const batch = { events: [], inProgress: nothingHeld };
    expect(ClaimBatchSchema.parse(batch)).toEqual(batch);
  });

  /**
   * The separation SPEC.md §7 depends on: "work I just claimed" and "work you
   * apparently think I already had" are different questions, and an agent that
   * confused them would either redo settled work or settle work it never did.
   * Two fields make that confusion impossible; one array with a flag would have
   * made it a one-character mistake.
   */
  it("keeps the held events out of the claimed batch entirely", () => {
    const batch = ClaimBatchSchema.parse({
      events: [event],
      inProgress: { events: [held], total: 1, truncated: false },
    });
    expect(batch.events.map((claimed) => claimed.id)).toEqual([event.id]);
    expect(batch.inProgress.events.map((entry) => entry.id)).toEqual([held.id]);
  });

  /**
   * Required rather than optional: an absent field is indistinguishable from an
   * empty one, which is the same silent-incompleteness failure the overflow
   * signal exists to prevent. Nothing held is a stated empty set.
   */
  it("demands the in-progress set rather than letting a server omit it", () => {
    expect(ClaimBatchSchema.safeParse({ events: [] }).success).toBe(false);
  });

  /** A halted queue claims nothing, but it can still be holding plenty. */
  it("allows a non-empty held set beside an empty claim", () => {
    const batch = ClaimBatchSchema.parse({
      events: [],
      inProgress: { events: [held], total: 1, truncated: false },
    });
    expect(batch.inProgress.events).toHaveLength(1);
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
    const result = { events: [event], inProgress: nothingHeld };
    expect(IdleResultSchema.parse(result)).toEqual(result);
  });

  /** An empty 200 would be indistinguishable from the 204 timeout, so it is not a valid body. */
  it("rejects an empty list, because nothing pending is a 204 with no body", () => {
    expect(IdleResultSchema.safeParse({ events: [], inProgress: nothingHeld }).success).toBe(false);
  });

  /**
   * The rider's resolved Q1: the list rides on the loop's two entry points —
   * `claim-all`, and `idle` when it returns work. The `204` that ends an empty
   * window has no body and so cannot carry it, which is why the field is on the
   * `200` body rather than on a header.
   */
  it("carries the same in-progress set claim-all does", () => {
    const result = IdleResultSchema.parse({
      events: [event],
      inProgress: { events: [held], total: 1, truncated: false },
    });
    expect(result.inProgress.events.map((entry) => entry.id)).toEqual([held.id]);
    expect(result.events.map((pending) => pending.id)).toEqual([event.id]);
  });

  it("demands it, so a server cannot report availability without its own view", () => {
    expect(IdleResultSchema.safeParse({ events: [event] }).success).toBe(false);
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
