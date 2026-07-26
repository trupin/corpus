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
  it("defaults to a standalone note-only thread", () => {
    expect(CreateThreadRequestSchema.parse({ body: "Ask from nowhere." })).toEqual({
      body: "Ask from nowhere.",
      parent: null,
      selector: null,
      requestsAgent: false,
    });
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
  it("treats a turn as note-only unless it requests the agent", () => {
    expect(AppendTurnRequestSchema.parse({ body: "just a note" })).toEqual({
      body: "just a note",
      requestsAgent: false,
    });
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
