import { describe, expect, it } from "vitest";
import {
  AGENT_NAME_MAX_LENGTH,
  AgentLaneSchema,
  AgentNameSchema,
  AgentPresenceSchema,
  AgentRosterSchema,
  DesignateResidentRequestSchema,
  LANE_SUMMARY_MAX_LENGTH,
  LaneOriginSchema,
  parseResidentDesignatedPayload,
  parseResidentReleasedPayload,
  presenceLiveField,
  presenceSinceField,
  RESIDENT_DESIGNATED_EVENT_TYPE,
  RESIDENT_WEIGHT_BOUNDARY,
  RESIDENT_RELEASE_REASONS,
  RESIDENT_RELEASED_EVENT_TYPE,
  ResidentDesignatedPayloadSchema,
  ResidentReleasedPayloadSchema,
  ResidentSchema,
  residentField,
} from "./agents.js";
import { REQUESTED_WEIGHT_MAX_LENGTH, RequestedWeightSchema } from "./weight.js";

const resident = { name: "researcher", docId: "doc_agentdef", weight: null };

/** A designation that named no profile (SPEC.md §7, rider SHARED-048). */
const generalResident = { name: null, docId: null, weight: null };

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

  it("demands both halves, present, even when both are null", () => {
    expect(ResidentSchema.safeParse({ name: "researcher", weight: null }).success).toBe(false);
    expect(ResidentSchema.safeParse({ docId: "doc_agentdef", weight: null }).success).toBe(false);
    expect(ResidentSchema.safeParse({}).success).toBe(false);
  });

  /**
   * CONTRACT-061 / SPEC.md §7 rider SHARED-048. A designation may name no
   * profile, and the resident it produces is a resident in every other respect.
   * `{name: null, docId: null}` is the whole spelling of that — no sentinel
   * name, because a sentinel would reach a recipient list dressed as a profile
   * and could collide with a real agent-def titled the same.
   */
  it("round-trips a general resident as two nulls, and never as a name", () => {
    expect(ResidentSchema.parse(generalResident)).toEqual({
      name: null,
      docId: null,
      weight: null,
    });
  });

  /**
   * §7, as amended by SHARED-053 (signed 2026-08-20): *"A profile that is
   * renamed, deleted, or moved out of `.claude/agents/` after designation does
   * not end the designation … the missing profile is reported rather than
   * silently substituted."* **Archiving is not one of those cases**, so an
   * archived profile never produces this pair. It must stay tellable apart
   * from a general resident — one is ordinary, the other is worth mentioning.
   */
  it("round-trips a named profile that no longer resolves, distinguishably", () => {
    const gone = { name: "researcher", docId: null, weight: null };
    expect(ResidentSchema.parse(gone)).toEqual(gone);
    expect(gone.name).not.toBe(generalResident.name);
  });

  /**
   * The one combination that is not a state: a document nobody named. The flat
   * object can represent it, so a refinement rejects it — the union that could
   * not represent it at all would have cost `Resident` its component name
   * (CONTRACT-037: a `oneOf` has no `type: "object"`).
   */
  it("refuses a docId with no name, which would be a document nobody named", () => {
    const parsed = ResidentSchema.safeParse({ name: null, docId: "doc_agentdef", weight: null });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["docId"]);
  });

  /** A blank name is still a mistake, wherever it appears. */
  it("still refuses a blank name rather than reading it as no profile", () => {
    expect(ResidentSchema.safeParse({ name: "   ", docId: null, weight: null }).success).toBe(
      false,
    );
  });
});

/**
 * CONTRACT-067 / SPEC.md §7's rider signed 2026-08-19: a resident's weight is
 * set when it is designated, not per message, and the `Resident` reports it.
 */
describe("Resident.weight", () => {
  it("is required and nullable: null is none chosen, the launcher decides", () => {
    expect(ResidentSchema.parse(resident).weight).toBeNull();
    expect(ResidentSchema.safeParse({ name: "researcher", docId: "doc_agentdef" }).success).toBe(
      false,
    );
  });

  it("carries a level key verbatim, the same token a message's weight uses", () => {
    expect(ResidentSchema.parse({ ...resident, weight: "heavy" }).weight).toBe("heavy");
    expect(RequestedWeightSchema.parse("heavy")).toBe("heavy");
  });

  /** Orthogonal to the profile pair: a general resident may run at a stated weight. */
  it("is independent of the profile pair", () => {
    expect(ResidentSchema.parse({ ...generalResident, weight: "light" })).toEqual({
      name: null,
      docId: null,
      weight: "light",
    });
    expect(ResidentSchema.parse({ name: "researcher", docId: null, weight: "light" }).weight).toBe(
      "light",
    );
  });

  it("refuses a blank or multi-line level, as the message field does", () => {
    for (const weight of ["", "   ", "hea\nvy"]) {
      expect(ResidentSchema.safeParse({ ...resident, weight }).success).toBe(false);
    }
  });

  it("states the boundary in the one published wording, on both sides of the wire", () => {
    expect(RESIDENT_WEIGHT_BOUNDARY).toBe(
      "governs the resident's own turns; a weight stated on a message still governs what the " +
        "resident hands off (SPEC.md §7, rider signed 2026-08-19)",
    );
    expect(ResidentSchema.shape.weight.description).toContain(RESIDENT_WEIGHT_BOUNDARY);
    expect(DesignateResidentRequestSchema.shape.weight.description).toContain(
      RESIDENT_WEIGHT_BOUNDARY,
    );
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

  /**
   * The two nulls one level apart, and the reason both descriptions spell the
   * difference out: this field null is *nobody*, while a resident whose `name`
   * is null is *somebody with no profile*. A consumer that collapsed them would
   * show a designated conversation as undesignated.
   */
  it("tells nobody apart from somebody with no profile", () => {
    expect(residentField.parse(generalResident)).toEqual(generalResident);
    expect(residentField.parse(null)).toBeNull();
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

  /**
   * CONTRACT-061. A lane with a **general** resident is designated in every
   * sense — it has a lane name, an origin, and a liveness of its own — and the
   * roster must not report it as the one row that has no resident. The two rows
   * differ in exactly one place: whether the resident object carries a profile.
   */
  it("carries a general-resident lane as a designated row, not as a residentless one", () => {
    const general = { ...residentLane, resident: generalResident };
    const parsed = AgentLaneSchema.parse(general);
    expect(parsed.resident).toEqual({ name: null, docId: null, weight: null });
    expect(parsed.resident).not.toBeNull();
    // Everything else about the row is identical to a profiled lane's (SPEC.md
    // §7: "everything else about a resident is identical either way").
    const { resident: _general, ...generalRest } = parsed;
    const { resident: _profiled, ...profiledRest } = AgentLaneSchema.parse(residentLane);
    expect(generalRest).toEqual(profiledRest);
  });

  /**
   * The orchestrator's row is the only one whose `resident` is null: every other
   * lane exists because something was designated. A consumer that read null as
   * "general resident" would show the orchestrator as a designated conversation.
   */
  it("keeps a null resident meaning nobody, which on the roster is the orchestrator", () => {
    expect(AgentLaneSchema.parse(orchestratorLane).resident).toBeNull();
  });
});

/**
 * CONTRACT-045. "Is an agent there" is asked at two grains — of one lane, and of
 * the workspace — and both are answered from these two objects. The tests below
 * are about the *sharing*: a second definition of presence is the drift the
 * field exists to remove, and the cheapest way to grow one is to copy a
 * description rather than reuse the schema.
 */
describe("AgentPresence", () => {
  it("round-trips a listener that is there, and one that never was", () => {
    expect(AgentPresenceSchema.parse({ live: true, since: "2026-07-19T10:00:00Z" })).toEqual({
      live: true,
      since: "2026-07-19T10:00:00Z",
    });
    expect(AgentPresenceSchema.parse({ live: false, since: null })).toEqual({
      live: false,
      since: null,
    });
  });

  it("requires both halves: a verdict with no evidence behind it is not one", () => {
    expect(AgentPresenceSchema.safeParse({ live: true }).success).toBe(false);
    expect(AgentPresenceSchema.safeParse({ since: null }).success).toBe(false);
  });

  it("spells never-observed as null rather than as an absent key", () => {
    expect(AgentPresenceSchema.safeParse({ live: false, since: undefined }).success).toBe(false);
  });

  it("is the very objects a roster row publishes, not a copy of them", () => {
    expect(AgentLaneSchema.shape.live).toBe(presenceLiveField);
    expect(AgentLaneSchema.shape.since).toBe(presenceSinceField);
    expect(AgentPresenceSchema.shape.live).toBe(presenceLiveField);
    expect(AgentPresenceSchema.shape.since).toBe(presenceSinceField);
  });

  /**
   * A roster row is structurally an `AgentPresence`, which is what lets one
   * predicate serve the pill and the picker. Spreading the fields flat rather
   * than nesting keeps the row reading as one sentence; this asserts the price
   * of that choice was not the sharing.
   */
  it("parses a roster row, since a row is a presence with more on it", () => {
    expect(AgentPresenceSchema.parse(orchestratorLane)).toEqual({
      live: orchestratorLane.live,
      since: orchestratorLane.since,
    });
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

  /**
   * CONTRACT-067. The designation is the one place a resident's weight is
   * chosen (SPEC.md §7, rider signed 2026-08-19). Optional, so omitting it keeps
   * today's behaviour exactly; sent alone it designates a general resident at
   * that weight, because the two fields are independent.
   */
  it("takes the weight the resident runs at, independently of the profile", () => {
    expect(DesignateResidentRequestSchema.parse({ name: "researcher", weight: "heavy" })).toEqual({
      name: "researcher",
      weight: "heavy",
    });
    expect(DesignateResidentRequestSchema.parse({ weight: "heavy" })).toEqual({ weight: "heavy" });
    expect(DesignateResidentRequestSchema.parse({}).weight).toBeUndefined();
  });

  it("has no null or blank spelling of no weight: absence is the only one", () => {
    expect(DesignateResidentRequestSchema.safeParse({ weight: null }).success).toBe(false);
    expect(DesignateResidentRequestSchema.safeParse({ weight: "" }).success).toBe(false);
    expect(
      DesignateResidentRequestSchema.safeParse({
        weight: "x".repeat(REQUESTED_WEIGHT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  /** Strict, like every request body (CONTRACT-017). */
  it("refuses an unknown key rather than silently designating by the wrong field", () => {
    const parsed = DesignateResidentRequestSchema.safeParse({
      name: "researcher",
      docId: "doc_agentdef",
    });
    expect(parsed.success).toBe(false);
  });

  /**
   * CONTRACT-061 / SPEC.md §7 rider SHARED-048. Naming no profile is the
   * ordinary case and *"requires nothing to exist first"*, so it is the case
   * that costs a caller nothing to express: an empty body, which the route also
   * accepts as no body at all.
   */
  it("accepts an empty body, which is how a general resident is asked for", () => {
    expect(DesignateResidentRequestSchema.parse({})).toEqual({});
    expect(DesignateResidentRequestSchema.parse({}).name).toBeUndefined();
  });

  /**
   * The strictness is what keeps absence-as-meaning affordable: a caller that
   * means `name` and writes another key is told which key it got wrong, rather
   * than quietly receiving a general resident.
   */
  it("still names the wrong key rather than reading it as an empty body", () => {
    const parsed = DesignateResidentRequestSchema.safeParse({ agent: "researcher" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  /**
   * A blank name is a mistake, not a request for a general resident: dropping a
   * name by accident and asking for no profile must not be the same request
   * (CLI-049 depends on exactly this distinction for `--agent ""`).
   */
  it.each(["", "   ", "\t"])(
    "refuses a blank name (%j) rather than reading it as absence",
    (name) => {
      expect(DesignateResidentRequestSchema.safeParse({ name }).success).toBe(false);
    },
  );

  /**
   * `null` is the response side's word — "there is nobody" on the thread's
   * field, "no profile" inside a `Resident`. Release is the `DELETE` on this
   * same path, so nothing on the request side needs a null, and giving it a
   * third job here is how a field comes to mean two things.
   */
  it("has no null spelling: absence is the only way to ask for no profile", () => {
    expect(DesignateResidentRequestSchema.safeParse({ name: null }).success).toBe(false);
  });
});

/**
 * CONTRACT-069. The designation's payload, declared here rather than hand-built
 * by the server, and the release's beside it.
 */
describe("the resident event payloads", () => {
  const designated = { threadId: "th_x9y8", resident };
  const released = { threadId: "th_x9y8", resident, reason: "released" };

  it("carries a designation as the thread and the resolved resident", () => {
    expect(ResidentDesignatedPayloadSchema.parse(designated)).toEqual(designated);
    expect(
      ResidentDesignatedPayloadSchema.parse({ ...designated, resident: generalResident }).resident,
    ).toEqual(generalResident);
  });

  it("carries a release as the thread, who left, and why", () => {
    expect(ResidentReleasedPayloadSchema.parse(released)).toEqual(released);
  });

  /**
   * Three ways out of a designation (SPEC.md §7), and **a lapse is not one of
   * them**: the fallback is computed at claim time and writes nothing.
   */
  it("closes the reasons at §7's three, with no lapse among them", () => {
    expect([...RESIDENT_RELEASE_REASONS]).toEqual(["released", "resolved", "replaced"]);
    for (const reason of RESIDENT_RELEASE_REASONS) {
      expect(ResidentReleasedPayloadSchema.parse({ ...released, reason }).reason).toBe(reason);
    }
    expect(ResidentReleasedPayloadSchema.safeParse({ ...released, reason: "lapsed" }).success).toBe(
      false,
    );
    expect(
      ResidentReleasedPayloadSchema.safeParse({ ...released, reason: undefined }).success,
    ).toBe(false);
  });

  it("demands the resident that left, so the orchestrator can say who", () => {
    expect(
      ResidentReleasedPayloadSchema.safeParse({ threadId: "th_x9y8", reason: "resolved" }).success,
    ).toBe(false);
    expect(ResidentReleasedPayloadSchema.safeParse({ ...released, resident: null }).success).toBe(
      false,
    );
  });

  it("refuses a document id where the root thread belongs", () => {
    expect(
      ResidentReleasedPayloadSchema.safeParse({ ...released, threadId: "doc_a1b2" }).success,
    ).toBe(false);
  });

  it("narrows a queue event by type, and declines the other type and a malformed payload", () => {
    expect(
      parseResidentReleasedPayload({ type: RESIDENT_RELEASED_EVENT_TYPE, payload: released }),
    ).toEqual(released);
    expect(
      parseResidentReleasedPayload({ type: RESIDENT_DESIGNATED_EVENT_TYPE, payload: released }),
    ).toBeUndefined();
    expect(
      parseResidentReleasedPayload({ type: RESIDENT_RELEASED_EVENT_TYPE, payload: designated }),
    ).toBeUndefined();
    expect(
      parseResidentDesignatedPayload({ type: RESIDENT_DESIGNATED_EVENT_TYPE, payload: designated }),
    ).toEqual(designated);
    expect(
      parseResidentDesignatedPayload({ type: RESIDENT_RELEASED_EVENT_TYPE, payload: designated }),
    ).toBeUndefined();
    // An older server's designation carried a bare name; the parser declines it
    // rather than throwing, because events come off disk.
    expect(
      parseResidentDesignatedPayload({
        type: RESIDENT_DESIGNATED_EVENT_TYPE,
        payload: { threadId: "th_x9y8", name: "researcher" },
      }),
    ).toBeUndefined();
  });
});
