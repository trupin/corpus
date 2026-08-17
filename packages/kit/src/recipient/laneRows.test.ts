import { AGENT_PRESENCE_WINDOW_SECONDS, type AgentLane } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  laneLine,
  laneLiveness,
  laneName,
  laneRow,
  laneRows,
  unknownLaneRow,
  LAPSED_FALLBACK,
  LAPSED_ORCHESTRATOR,
  LIVE_WITHOUT_SUMMARY,
  NEVER_SEEN_LINE,
  ORCHESTRATOR_LABEL,
  UNNAMED_RESIDENT_LABEL,
} from "./laneRows.js";

const NOW = new Date("2026-08-16T12:00:00Z");

function lane(overrides: Partial<AgentLane> = {}): AgentLane {
  return {
    lane: "th_root",
    resident: { name: "claims-review", docId: "doc_agent" },
    live: true,
    since: NOW.toISOString(),
    summary: "reviewing the draft",
    origin: { id: "th_root", title: "The claims conversation" },
    ...overrides,
  };
}

const ORCHESTRATOR = lane({ lane: "orchestrator", resident: null, origin: null });

describe("laneName", () => {
  it("names the orchestrator's lane 'agent' — the product's word, not the queue's", () => {
    expect(laneName(ORCHESTRATOR)).toBe(ORCHESTRATOR_LABEL);
  });

  it("names a designated lane by its resident", () => {
    expect(laneName(lane())).toBe("claims-review");
  });

  it("falls back to the conversation when the designation names no resident", () => {
    // Only reachable from a hand-edited frontmatter, and the roster still lists
    // it: "we cannot say who owns this" is not "this is not owned".
    expect(laneName(lane({ resident: null }))).toBe("The claims conversation");
  });

  it("still names something when there is neither a resident nor a title", () => {
    expect(laneName(lane({ resident: null, origin: null }))).toBe(UNNAMED_RESIDENT_LABEL);
  });
});

describe("laneLiveness", () => {
  it("is live while the server says a listener is parked", () => {
    expect(laneLiveness(lane(), NOW)).toBe("live");
  });

  it("is waiting when nobody has ever parked — not lapsed", () => {
    expect(laneLiveness(lane({ live: false, since: null }), NOW)).toBe("waiting");
  });

  it("is lapsed when somebody was there and is not", () => {
    expect(laneLiveness(lane({ live: false }), NOW)).toBe("lapsed");
  });

  it("expires a live verdict whose evidence has aged past the grace window", () => {
    // The client may let the server's verdict expire and may never overrule it
    // (`isAgentPresent`) — a roster held since before the agent left must not
    // keep claiming it is there.
    const stale = new Date(NOW.getTime() + (AGENT_PRESENCE_WINDOW_SECONDS + 60) * 1000);
    expect(laneLiveness(lane(), stale)).toBe("lapsed");
  });
});

describe("laneLine", () => {
  it("shows what a live lane says it is doing", () => {
    expect(laneLine(lane(), "live", NOW)).toBe("reviewing the draft");
  });

  it("says it is listening when the server had nothing to add", () => {
    expect(laneLine(lane({ summary: null }), "live", NOW)).toBe(LIVE_WITHOUT_SUMMARY);
  });

  it("says a lane nobody has parked on has no listener yet", () => {
    expect(laneLine(lane({ live: false, since: null }), "waiting", NOW)).toBe(NEVER_SEEN_LINE);
  });

  it("says how long a lapsed lane has been gone, and who answers meanwhile", () => {
    const since = new Date(NOW.getTime() - 18 * 60_000).toISOString();
    expect(laneLine(lane({ live: false, since }), "lapsed", NOW)).toBe(
      `last seen 18m ago — ${LAPSED_FALLBACK}`,
    );
  });

  it("spells a long absence in the board's own shape for an age", () => {
    // `humanizeElapsed`, shared with §8's pending row so the two lines one
    // composer apart never spell a duration differently.
    const since = new Date(NOW.getTime() - (2 * 3_600_000 + 5 * 60_000)).toISOString();
    expect(laneLine(lane({ live: false, since }), "lapsed", NOW)).toBe(
      `last seen 2h 05m ago — ${LAPSED_FALLBACK}`,
    );
  });

  it("does not promise the orchestrator will cover for the orchestrator", () => {
    const since = new Date(NOW.getTime() - 3 * 60_000).toISOString();
    expect(laneLine({ ...ORCHESTRATOR, live: false, since }, "lapsed", NOW)).toBe(
      `last seen 3m ago — ${LAPSED_ORCHESTRATOR}`,
    );
  });

  it("drops the age rather than printing a broken one", () => {
    expect(laneLine(lane({ live: false, since: "not a date" }), "lapsed", NOW)).toBe(
      LAPSED_FALLBACK,
    );
  });

  it("says nothing at all about a lane the roster has not described", () => {
    // UI-098's rule at lane grain: an unknown row asserts no absence.
    expect(unknownLaneRow("th_ghost")).toEqual({
      lane: "th_ghost",
      name: UNNAMED_RESIDENT_LABEL,
      liveness: "unknown",
      line: "",
      conversation: null,
    });
  });
});

describe("laneRows", () => {
  it("keeps the server's order and carries the conversation for each lane", () => {
    expect(laneRows([ORCHESTRATOR, lane()], NOW)).toEqual([
      {
        lane: "orchestrator",
        name: ORCHESTRATOR_LABEL,
        liveness: "live",
        line: "reviewing the draft",
        conversation: null,
      },
      {
        lane: "th_root",
        name: "claims-review",
        liveness: "live",
        line: "reviewing the draft",
        conversation: "The claims conversation",
      },
    ]);
  });

  it("builds one row the same way whichever entry point is used", () => {
    expect(laneRows([lane()], NOW)[0]).toEqual(laneRow(lane(), NOW));
  });
});
