import { AGENT_PRESENCE_WINDOW_SECONDS, type AgentLane } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import {
  laneLine,
  laneLiveness,
  laneMark,
  laneName,
  laneNote,
  laneResidentKind,
  laneRow,
  laneRows,
  unknownLaneRow,
  LAPSED_FALLBACK,
  LAPSED_ORCHESTRATOR,
  LIVE_WITHOUT_SUMMARY,
  MISSING_PROFILE_MARK,
  MISSING_PROFILE_NOTE,
  NEVER_SEEN_LINE,
  ORCHESTRATOR_LABEL,
  UNNAMED_RESIDENT_LABEL,
} from "./laneRows.js";

const NOW = new Date("2026-08-16T12:00:00Z");

function lane(overrides: Partial<AgentLane> = {}): AgentLane {
  return {
    lane: "th_root",
    resident: { name: "claims-review", docId: "doc_agent", weight: "heavy", designationId: null },
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

  /**
   * §7's general resident, in a **list** of lanes. It is named by the
   * conversation it owns rather than by a word for the state: a word would sit
   * beside real profile names indistinguishable from one, and would repeat
   * across every general lane, leaving a picker with two rows nobody can choose
   * between (CONTRACT-061).
   */
  it("names a general resident by the conversation, never by a word for the state", () => {
    const name = laneName(
      lane({ resident: { name: null, docId: null, weight: null, designationId: null } }),
    );
    expect(name).toBe("The claims conversation");
    expect(name).not.toContain("general");
    expect(name).not.toBe(ORCHESTRATOR_LABEL);
  });
});

describe("laneResidentKind", () => {
  it("is the orchestrator's own lane, which nobody designated", () => {
    expect(laneResidentKind(ORCHESTRATOR)).toBe("orchestrator");
  });

  it("is general when the designation named no profile — §7's ordinary case", () => {
    expect(
      laneResidentKind(
        lane({ resident: { name: null, docId: null, weight: null, designationId: null } }),
      ),
    ).toBe("general");
  });

  it("is profiled when the name still resolves to an agent-def", () => {
    expect(laneResidentKind(lane())).toBe("profiled");
  });

  /**
   * SPEC.md §7: the designation stands and "the missing profile is reported
   * rather than silently substituted". Distinguishing it from `general` is the
   * whole point — one is ordinary, one is worth mentioning.
   */
  it("tells a resident whose profile has gone from one that never had a profile", () => {
    expect(
      laneResidentKind(
        lane({
          resident: { name: "claims-review", docId: null, weight: null, designationId: null },
        }),
      ),
    ).toBe("profile-gone");
  });

  it("says nothing at all about a designated lane the roster left empty", () => {
    expect(laneResidentKind(lane({ resident: null }))).toBe("unknown");
  });
});

describe("laneNote", () => {
  it("reports a missing profile, and says nothing about any other kind", () => {
    expect(laneNote("profile-gone")).toBe(MISSING_PROFILE_NOTE);
    expect(laneNote("general")).toBe("");
    expect(laneNote("profiled")).toBe("");
    expect(laneNote("orchestrator")).toBe("");
    expect(laneNote("unknown")).toBe("");
  });
});

describe("laneMark", () => {
  /**
   * The same report at the width of a row in a list. Both come from the kind, so
   * a surface cannot end up marking a lane the note says nothing about — the way
   * two independently derived labels for one state eventually do.
   */
  it("marks exactly the kind the note reports, and no other", () => {
    expect(laneMark("profile-gone")).toBe(MISSING_PROFILE_MARK);
    for (const kind of ["general", "profiled", "orchestrator", "unknown"] as const) {
      expect(laneMark(kind)).toBe("");
      expect(laneNote(kind)).toBe("");
    }
  });

  it("is short enough to sit inside a lane pill, and still says what is gone", () => {
    expect(MISSING_PROFILE_MARK.length).toBeLessThan(MISSING_PROFILE_NOTE.length);
    expect(MISSING_PROFILE_MARK).toContain("profile");
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
      kind: "unknown",
      profile: null,
      profileDoc: null,
      note: "",
      weight: null,
      mark: "",
      conversation: null,
    });
  });

  it("does not read a lane it has never heard of as a general resident", () => {
    // The two are one word apart and mean opposite things: `general` is a
    // designation somebody made, `unknown` is an answer nobody gave (UI-098).
    expect(unknownLaneRow("th_ghost").kind).not.toBe("general");
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
        kind: "orchestrator",
        profile: null,
        profileDoc: null,
        note: "",
        weight: null,
        mark: "",
        conversation: null,
      },
      {
        lane: "th_root",
        name: "claims-review",
        liveness: "live",
        line: "reviewing the draft",
        kind: "profiled",
        profile: "claims-review",
        profileDoc: "doc_agent",
        note: "",
        // Verbatim off the roster row (CONTRACT-067): the composer's line and
        // the resident sentence read it from here.
        weight: "heavy",
        mark: "",
        conversation: "The claims conversation",
      },
    ]);
  });

  it("builds one row the same way whichever entry point is used", () => {
    expect(laneRows([lane()], NOW)[0]).toEqual(laneRow(lane(), NOW));
  });

  /**
   * The row a general resident produces, in full — the state a fresh workspace
   * reaches in one gesture (UI-122). `profile` is null so no surface can name it
   * by a profile it does not have, and the liveness half is identical to a
   * profiled lane's, which is §7's *"everything else about a resident is
   * identical either way"*.
   */
  it("carries a general resident with no profile and no note", () => {
    expect(
      laneRow(
        lane({ resident: { name: null, docId: null, weight: null, designationId: null } }),
        NOW,
      ),
    ).toEqual({
      lane: "th_root",
      name: "The claims conversation",
      liveness: "live",
      line: "reviewing the draft",
      kind: "general",
      profile: null,
      profileDoc: null,
      note: "",
      weight: null,
      mark: "",
      conversation: "The claims conversation",
    });
  });

  it("reports a profile that has gone, and still names the resident", () => {
    const row = laneRow(
      lane({ resident: { name: "claims-review", docId: null, weight: null, designationId: null } }),
      NOW,
    );
    expect(row.kind).toBe("profile-gone");
    expect(row.profile).toBe("claims-review");
    expect(row.note).toBe(MISSING_PROFILE_NOTE);
    // Carried at both widths, so a surface whose rows sit side by side can still
    // report it (PR #49 review — the picker drew a gone lane as a healthy one).
    expect(row.mark).toBe(MISSING_PROFILE_MARK);
    // The report is about the profile; presence is a separate axis and unmoved.
    expect(row.liveness).toBe("live");
  });

  /**
   * The identity half of a resident, which is the only half a surface may
   * compare: the server resolves a designation against a document's stem *and*
   * its title and stores the name it resolved to, so `profile` may legitimately
   * be spelled differently from the title `GET /api/docs` carries for the very
   * same document (`bookkeeper` against `Bookkeeper`, SERVER-122 / CLI-050).
   */
  it("carries the document the profile resolves to, beside the name it was designated with", () => {
    const row = laneRow(
      lane({
        resident: { name: "bookkeeper", docId: "doc_bk", weight: null, designationId: null },
      }),
      NOW,
    );
    expect(row.profile).toBe("bookkeeper");
    expect(row.profileDoc).toBe("doc_bk");
  });

  it("has no document for a resident whose profile has gone, and none for a general one", () => {
    expect(
      laneRow(
        lane({
          resident: { name: "claims-review", docId: null, weight: null, designationId: null },
        }),
        NOW,
      ).profileDoc,
    ).toBe(null);
    expect(
      laneRow(
        lane({ resident: { name: null, docId: null, weight: null, designationId: null } }),
        NOW,
      ).profileDoc,
    ).toBe(null);
  });
});
