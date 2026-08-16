import { describe, expect, it } from "vitest";
import {
  AGENT_NAME_MAX_LENGTH,
  AgentLaneSchema,
  AgentNameSchema,
  AgentRosterSchema,
  DesignateResidentRequestSchema,
  LANE_SUMMARY_MAX_LENGTH,
  LaneOriginSchema,
  ResidentSchema,
  residentField,
} from "./agents.js";

const resident = { name: "researcher", docId: "doc_agentdef" };

const orchestratorLane = {
  lane: "orchestrator",
  resident: null,
  live: true,
  since: "2026-07-19T10:00:00Z",
  summary: "parked",
  origin: null,
};

const residentLane = {
  lane: "th_x9y8",
  resident,
  live: false,
  since: "2026-07-19T09:40:00Z",
  summary: null,
  origin: { id: "th_x9y8", title: "Mortgage options" },
};

describe("AgentName", () => {
  it.each(["researcher", "Researcher", "code reviewer", "pr-reviewer"])(
    "accepts the invocable name %s",
    (name) => {
      expect(AgentNameSchema.parse(name)).toBe(name);
    },
  );

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["a\nb", "two lines"],
    ["x".repeat(AGENT_NAME_MAX_LENGTH + 1), "past the bound"],
  ])("refuses %s (%s)", (name) => {
    expect(AgentNameSchema.safeParse(name).success).toBe(false);
  });

  it("accepts a name exactly at the bound, so the bound refuses only the absurd", () => {
    expect(AgentNameSchema.safeParse("x".repeat(AGENT_NAME_MAX_LENGTH)).success).toBe(true);
  });
});

describe("Resident", () => {
  it("round-trips the resolved pair", () => {
    expect(ResidentSchema.parse(resident)).toEqual(resident);
  });

  /**
   * An agent-def is a document under `.claude/agents/`, so its id carries the
   * document prefix. A `th_` here would mean a conversation was made resident
   * in a conversation.
   */
  it("refuses a thread id where the agent-def document belongs", () => {
    expect(ResidentSchema.safeParse({ ...resident, docId: "th_x9y8" }).success).toBe(false);
  });

  it("demands both halves: the name a person reads and the document they open", () => {
    expect(ResidentSchema.safeParse({ name: "researcher" }).success).toBe(false);
    expect(ResidentSchema.safeParse({ docId: "doc_agentdef" }).success).toBe(false);
  });
});

describe("the resident field on a thread", () => {
  it("carries a resident", () => {
    expect(residentField.parse(resident)).toEqual(resident);
  });

  /**
   * Nullable rather than optional — the response-side convention. Dissolving is
   * the absence of a resident and never a third state (SPEC.md §7), so "there
   * is nobody" must never have to be told apart from "the key is missing".
   */
  it("spells no resident as null, not as an absent key", () => {
    expect(residentField.parse(null)).toBeNull();
    expect(residentField.safeParse(undefined).success).toBe(false);
  });
});

describe("LaneOrigin", () => {
  it("round-trips the conversation the lane belongs to", () => {
    const origin = { id: "th_x9y8", title: "Mortgage options" };
    expect(LaneOriginSchema.parse(origin)).toEqual(origin);
  });

  /** A lane belongs to a conversation, and only a thread is one. */
  it("refuses a document id", () => {
    expect(LaneOriginSchema.safeParse({ id: "doc_a1b2c3", title: "T" }).success).toBe(false);
  });
});

describe("AgentLane", () => {
  it.each([
    ["the orchestrator's row", orchestratorLane],
    ["a designated conversation's row", residentLane],
  ])("round-trips %s", (_name, row) => {
    expect(AgentLaneSchema.parse(row)).toEqual(row);
  });

  /**
   * Liveness is observed rather than registered (SPEC.md §7), so a lane that is
   * not live is an ordinary row with a `since` behind it — not a missing row,
   * and not an error. That is the state §8's pending indicator needs to see.
   */
  it("represents a lapsed lane as a present row rather than an omitted one", () => {
    const parsed = AgentLaneSchema.parse(residentLane);
    expect(parsed.live).toBe(false);
    expect(parsed.since).toBe("2026-07-19T09:40:00Z");
  });

  it("accepts a lane nothing has ever parked on, whose `since` is null", () => {
    expect(AgentLaneSchema.parse({ ...residentLane, since: null }).since).toBeNull();
  });

  it.each(["live", "since", "summary", "origin", "resident", "lane"])(
    "requires %s rather than letting it be omitted",
    (key) => {
      const { [key]: _dropped, ...rest } = residentLane as Record<string, unknown>;
      expect(AgentLaneSchema.safeParse(rest).success).toBe(false);
    },
  );

  it("caps the summary, which the contract bounds and says nothing else about", () => {
    const atBound = "x".repeat(LANE_SUMMARY_MAX_LENGTH);
    expect(AgentLaneSchema.safeParse({ ...residentLane, summary: atBound }).success).toBe(true);
    expect(AgentLaneSchema.safeParse({ ...residentLane, summary: `${atBound}x` }).success).toBe(
      false,
    );
  });

  it("refuses a lane name that is neither the orchestrator nor a thread", () => {
    expect(AgentLaneSchema.safeParse({ ...residentLane, lane: "doc_a1b2c3" }).success).toBe(false);
  });
});

describe("AgentRoster", () => {
  it("round-trips every lane, the orchestrator's included", () => {
    const roster = { agents: [orchestratorLane, residentLane] };
    expect(AgentRosterSchema.parse(roster)).toEqual(roster);
  });

  /**
   * The shape does not enforce the orchestrator's presence — a schema cannot
   * usefully assert "one of these rows is the orchestrator's" — but the route
   * promises it, so an empty list is representable and is a server bug rather
   * than a wire one.
   */
  it("is an object rather than a bare array, so the roster can grow a sibling", () => {
    expect(AgentRosterSchema.parse({ agents: [] }).agents).toEqual([]);
    expect(AgentRosterSchema.safeParse([orchestratorLane]).success).toBe(false);
  });
});

describe("DesignateResidentRequest", () => {
  it("carries the invocable name and nothing else", () => {
    expect(DesignateResidentRequestSchema.parse({ name: "researcher" })).toEqual({
      name: "researcher",
    });
  });

  /** Strict, like every request body (CONTRACT-017). */
  it("refuses an unknown key rather than silently designating by the wrong field", () => {
    const parsed = DesignateResidentRequestSchema.safeParse({
      name: "researcher",
      docId: "doc_agentdef",
    });
    expect(parsed.success).toBe(false);
  });

  it("demands a name: a designation that names nobody is not one", () => {
    expect(DesignateResidentRequestSchema.safeParse({}).success).toBe(false);
  });

  /**
   * Releasing is `DELETE` on the same path, so `null` never has to mean
   * "release" on a field where `null` already means "there is nobody".
   */
  it("has no null spelling of release", () => {
    expect(DesignateResidentRequestSchema.safeParse({ name: null }).success).toBe(false);
  });
});
