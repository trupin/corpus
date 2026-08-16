// SPEC.md §7's lane rule and its two carve-outs, at the level they are a pure
// function (SERVER-111). The walk they defer to is a stub here and has its own
// test in `scope.test.ts` — which is what makes it visible, for each case,
// whether the walk's answer is what gets stamped or is overruled.

import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
import {
  NOTHING_LIVE,
  NO_SCOPE_LOOKUP,
  RESIDENT_DESIGNATED,
  laneFor,
  laneOf,
  visibleTo,
  type ScopeRootLookup,
} from "./lanes.js";
import type { StoredEvent } from "./store.js";

const RESIDENT: Lane = "th_resident";
const OTHER: Lane = "th_other";

/** A walk that always answers "this event falls in the resident's scope". */
const inResidentScope: ScopeRootLookup = () => RESIDENT;

const event = (lane?: Lane): StoredEvent => ({
  id: "evt_test",
  type: "comment.created",
  created: "2026-08-16T10:00:00Z",
  source: "test",
  payload: {},
  status: "pending",
  ...(lane === undefined ? {} : { lane }),
});

describe("laneOf", () => {
  it("reads the stamp the enqueue wrote", () => {
    expect(laneOf(event(RESIDENT))).toBe(RESIDENT);
  });

  // The whole of the migration: an event written before lanes existed, or
  // dropped into `pending/` by hand, stays claimable by the caller that could
  // always claim it.
  it("reads an unstamped legacy event as the orchestrator's lane", () => {
    expect(laneOf(event())).toBe(ORCHESTRATOR_LANE);
  });
});

describe("laneFor", () => {
  it("takes the scope's root thread where the event falls in a designated scope", () => {
    expect(laneFor({ type: "comment.created", payload: {} }, inResidentScope)).toBe(RESIDENT);
  });

  it("takes the orchestrator's lane where it falls in none", () => {
    expect(laneFor({ type: "comment.created", payload: {} }, NO_SCOPE_LOOKUP)).toBe(
      ORCHESTRATOR_LANE,
    );
  });

  // §7's first carve-out. A summons: posted inside the host conversation, which
  // the walk would route to the host's lane, but addressed elsewhere.
  it("takes a named recipient's lane over the scope it was posted in", () => {
    expect(
      laneFor({ type: "comment.created", payload: {}, recipient: OTHER }, inResidentScope),
    ).toBe(OTHER);
  });

  it("lets a recipient name the orchestrator from inside a designated scope", () => {
    expect(
      laneFor(
        { type: "comment.created", payload: {}, recipient: ORCHESTRATOR_LANE },
        inResidentScope,
      ),
    ).toBe(ORCHESTRATOR_LANE);
  });

  // §7's second carve-out, and the one with teeth: routed by the walk, the
  // announcement of a designation would land on the lane it announces, so
  // re-designating a live lane would hand the launch instruction to the resident
  // being replaced and the new one would never start.
  it("sends a resident.designated to the orchestrator whoever is designated", () => {
    expect(laneFor({ type: RESIDENT_DESIGNATED, payload: {} }, inResidentScope)).toBe(
      ORCHESTRATOR_LANE,
    );
  });

  it("does not let a recipient redirect a resident.designated", () => {
    expect(
      laneFor({ type: RESIDENT_DESIGNATED, payload: {}, recipient: OTHER }, inResidentScope),
    ).toBe(ORCHESTRATOR_LANE);
  });

  it("spells the type the way the designation route produces it", () => {
    expect(RESIDENT_DESIGNATED).toBe("resident.designated");
  });
});

describe("visibleTo", () => {
  const live = (lane: Lane): boolean => lane === RESIDENT;

  it("shows a scoped claim its own lane", () => {
    expect(visibleTo(RESIDENT, RESIDENT, live)).toBe(true);
  });

  it("hides every other lane from a scoped claim, the orchestrator's included", () => {
    expect(visibleTo(RESIDENT, OTHER, live)).toBe(false);
    expect(visibleTo(RESIDENT, ORCHESTRATOR_LANE, live)).toBe(false);
  });

  // The guarantee that makes two agents safe: disjoint sets, not a race.
  it("hides a live lane's events from the orchestrator's unscoped claim", () => {
    expect(visibleTo(ORCHESTRATOR_LANE, RESIDENT, live)).toBe(false);
  });

  it("shows the orchestrator a lapsed lane's events", () => {
    expect(visibleTo(ORCHESTRATOR_LANE, OTHER, live)).toBe(true);
  });

  it("always shows the orchestrator its own lane", () => {
    expect(visibleTo(ORCHESTRATOR_LANE, ORCHESTRATOR_LANE, live)).toBe(true);
  });

  // A returning resident is not narrowed by the fallback: the scoped branch
  // never consults liveness at all.
  it("shows a lapsed resident its own lane regardless", () => {
    expect(visibleTo(OTHER, OTHER, live)).toBe(true);
  });

  // The shipped default, until SERVER-112 binds a tracker: with nothing live the
  // orchestrator sees the whole queue, exactly as it did before lanes existed.
  it("hides nothing from the orchestrator while nothing is live", () => {
    expect(visibleTo(ORCHESTRATOR_LANE, RESIDENT, NOTHING_LIVE)).toBe(true);
  });
});
