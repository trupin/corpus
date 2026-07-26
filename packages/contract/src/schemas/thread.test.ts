import { describe, expect, it } from "vitest";
import {
  AppendTurnRequestSchema,
  AppendTurnResponseSchema,
  CreateThreadRequestSchema,
  CreateThreadResponseSchema,
  THREAD_AGENT_STATES,
  ThreadAgentSchema,
  ThreadSchema,
  ThreadSummarySchema,
  TurnSchema,
} from "./thread.js";

const turns = [
  {
    author: "user",
    ts: "2026-07-19T10:05:00Z",
    body: "@agent is 6.1% still the right assumption?",
  },
  { author: "agent", ts: "2026-07-19T10:07:12Z", body: "Checked current averages; 6.4%." },
];

const thread = {
  id: "th_x9y8",
  title: "Re: 30-year fixed assumption",
  created: "2026-07-19T10:05:00Z",
  updated: "2026-07-19T10:07:12Z",
  status: "open",
  tags: [],
  parent: "doc_a1b2c3",
  anchor: "anc_k4f7",
  agent: "engaged",
  turns,
};

describe("Turn", () => {
  it.each(turns)("round-trips the $author turn", (turn) => {
    expect(TurnSchema.parse(turn)).toEqual(turn);
  });

  it("rejects an author that is neither user nor agent", () => {
    expect(TurnSchema.safeParse({ ...turns[0], author: "system" }).success).toBe(false);
  });
});

describe("Thread", () => {
  it("round-trips an anchored thread", () => {
    expect(ThreadSchema.parse(thread)).toEqual(thread);
  });

  it("round-trips a standalone thread, which has neither parent nor anchor", () => {
    const standalone = { ...thread, parent: null, anchor: null, agent: "requested" };
    expect(ThreadSchema.parse(standalone)).toEqual(standalone);
  });

  it("round-trips a thread whose parent is itself a thread", () => {
    const nested = { ...thread, parent: "th_other1" };
    expect(ThreadSchema.parse(nested).parent).toBe("th_other1");
  });

  it("rejects `archived`, which is a document status but not a thread status", () => {
    expect(ThreadSchema.safeParse({ ...thread, status: "archived" }).success).toBe(false);
  });
});

describe("ThreadSummary", () => {
  it("round-trips the projection row", () => {
    const summary = {
      id: "th_x9y8",
      title: "Re: 30-year fixed assumption",
      status: "resolved",
      parent: "doc_a1b2c3",
      anchor: "anc_k4f7",
      agent: "engaged",
      created: "2026-07-19T10:05:00Z",
      updated: "2026-07-19T10:07:12Z",
      turnCount: 2,
      lastAuthor: "agent",
      lastTs: "2026-07-19T10:07:12Z",
    };
    expect(ThreadSummarySchema.parse(summary)).toEqual(summary);
  });
});

describe("CreateThreadRequest", () => {
  it("defaults to a standalone thread, leaving the enqueue decision to the server", () => {
    const parsed = CreateThreadRequestSchema.parse({ body: "Ask from nowhere." });
    expect(parsed).toEqual({ body: "Ask from nowhere.", parent: null, selector: null });
    expect(parsed.requestsAgent).toBeUndefined();
  });

  it("carries a selection so the server can write the parent's anchor entry", () => {
    const request = {
      parent: "doc_a1b2c3",
      selector: { exact: "6.1%", prefix: "at ", suffix: " which" },
      body: "@agent still right?",
      requestsAgent: true,
    };
    expect(CreateThreadRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects an empty first turn", () => {
    expect(CreateThreadRequestSchema.safeParse({ body: "" }).success).toBe(false);
  });
});

describe("CreateThreadResponse", () => {
  it("reports the written anchor and the enqueued event", () => {
    const response = { thread, anchorId: "anc_k4f7", eventId: "evt_7c1d" };
    expect(CreateThreadResponseSchema.parse(response)).toEqual(response);
  });

  it("reports nulls when nothing was anchored and the agent was not requested", () => {
    const response = { thread, anchorId: null, eventId: null };
    expect(CreateThreadResponseSchema.parse(response)).toEqual(response);
  });
});

describe("AppendTurnRequest and AppendTurnResponse", () => {
  it("leaves an unset enqueue signal unset, rather than deciding for the server", () => {
    const parsed = AppendTurnRequestSchema.parse({ body: "just a note" });
    expect(parsed).toEqual({ body: "just a note" });
    expect("requestsAgent" in parsed).toBe(false);
  });

  it("round-trips the appended turn with its updated thread summary", () => {
    const response = {
      thread: {
        id: "th_x9y8",
        title: "Re: 30-year fixed assumption",
        status: "open",
        parent: "doc_a1b2c3",
        anchor: "anc_k4f7",
        agent: "engaged",
        created: "2026-07-19T10:05:00Z",
        updated: "2026-07-19T10:09:00Z",
        turnCount: 3,
        lastAuthor: "user",
        lastTs: "2026-07-19T10:09:00Z",
      },
      turn: { author: "user", ts: "2026-07-19T10:09:00Z", body: "thanks" },
      eventId: null,
    };
    expect(AppendTurnResponseSchema.parse(response)).toEqual(response);
  });
});

describe("agent participation", () => {
  it.each(THREAD_AGENT_STATES)("recognises the %s state", (state) => {
    expect(ThreadAgentSchema.parse(state)).toBe(state);
  });
});

/**
 * SPEC.md §8: a reply in an engaged thread re-triggers the agent unless the user
 * posts with the "note only" toggle. That toggle only exists if an explicit
 * `false` stays distinguishable from an omitted field after validation.
 */
describe("requestsAgent is a tri-state enqueue signal", () => {
  const schemas = [
    { name: "AppendTurnRequest", schema: AppendTurnRequestSchema, base: { body: "reply" } },
    { name: "CreateThreadRequest", schema: CreateThreadRequestSchema, base: { body: "first" } },
  ] as const;

  describe.each(schemas)("$name", ({ schema, base }) => {
    it('preserves an explicit false, which is the "note only" instruction', () => {
      const parsed = schema.parse({ ...base, requestsAgent: false });
      expect(parsed.requestsAgent).toBe(false);
    });

    it("preserves an explicit true", () => {
      expect(schema.parse({ ...base, requestsAgent: true }).requestsAgent).toBe(true);
    });

    it("leaves an omitted signal undefined, so the server applies its own rule", () => {
      expect(schema.parse(base).requestsAgent).toBeUndefined();
    });

    it("keeps explicit false distinguishable from omission", () => {
      const explicit = schema.parse({ ...base, requestsAgent: false });
      const omitted = schema.parse(base);
      expect(explicit.requestsAgent).not.toBe(omitted.requestsAgent);
    });

    it("rejects a non-boolean signal rather than coercing it", () => {
      expect(schema.safeParse({ ...base, requestsAgent: "false" }).success).toBe(false);
    });
  });
});
