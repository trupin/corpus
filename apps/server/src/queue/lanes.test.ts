// SPEC.md §7's lane rule and its two carve-outs, at the level they are a pure
// function (SERVER-111). The walk they defer to is a stub here and has its own
// test in `scope.test.ts` — which is what makes it visible, for each case,
// whether the walk's answer is what gets stamped or is overruled.

import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
import {
  NO_SCOPE_LOOKUP,
  NOTHING_RELEASED,
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

/**
 * SPEC.md §7's visibility rule after the rider signed 2026-08-25 (SERVER-152):
 * **exact equality, for every claim**.
 *
 * The suite is written as a pair of halves that used to differ and no longer
 * do. That shape is deliberate: the thing worth pinning is not that a claim sees
 * its own lane — it always did — but that the orchestrator's claim has stopped
 * being the exception, and that no argument about liveness can make it one
 * again.
 */
describe("visibleTo", () => {
  it("shows a scoped claim its own lane", () => {
    expect(visibleTo(RESIDENT, RESIDENT, NOTHING_RELEASED)).toBe(true);
  });

  it("hides every other lane from a scoped claim, the orchestrator's included", () => {
    expect(visibleTo(RESIDENT, OTHER, NOTHING_RELEASED)).toBe(false);
    expect(visibleTo(RESIDENT, ORCHESTRATOR_LANE, NOTHING_RELEASED)).toBe(false);
  });

  it("always shows the orchestrator its own lane", () => {
    expect(visibleTo(ORCHESTRATOR_LANE, ORCHESTRATOR_LANE, NOTHING_RELEASED)).toBe(true);
  });

  /**
   * The reproduction, at the level where it is provable.
   *
   * A listener that is absent — crashed, killed, or never started — does not
   * surrender its pending events. Before the rider this returned `true` for a
   * lapsed lane, and the orchestrator's holding that work is what made its own
   * skill defer launching the listener: a conversation somebody kept using never
   * had a clear pass, so it never got its agent.
   */
  it("hides another lane's events from the orchestrator, absent listener or not", () => {
    expect(visibleTo(ORCHESTRATOR_LANE, RESIDENT, NOTHING_RELEASED)).toBe(false);
    expect(visibleTo(ORCHESTRATOR_LANE, OTHER, NOTHING_RELEASED)).toBe(false);
  });

  /**
   * The converse, and it is not optional. "Nothing was returned" is what a
   * wholly broken queue also produces, so the absence above is worth nothing
   * without a case proving the same lane is claimable by its owner.
   */
  it("still shows that same lane to a claim scoped to it", () => {
    expect(visibleTo(RESIDENT, RESIDENT, NOTHING_RELEASED)).toBe(true);
    expect(visibleTo(OTHER, OTHER, NOTHING_RELEASED)).toBe(true);
  });

  /**
   * Nothing about presence reaches this function any more. The only third
   * argument is release, which is a person's act rather than an observation, so
   * this states as behaviour what the signature states as a type: a listener
   * doing anything at all cannot change the answer.
   */
  it("answers the same however long a listener has been away", () => {
    const answers = new Set([
      visibleTo(ORCHESTRATOR_LANE, RESIDENT, NOTHING_RELEASED),
      visibleTo(ORCHESTRATOR_LANE, RESIDENT, NOTHING_RELEASED),
      visibleTo(ORCHESTRATOR_LANE, RESIDENT, NOTHING_RELEASED),
    ]);
    expect([...answers]).toEqual([false]);
  });

  /**
   * The one deliberate widening (SERVER-153). A person released the resident, so
   * the messages stopped being a resident's — which is why this is not the
   * fallback under another name: it needs an act, and no amount of absence
   * produces one.
   */
  it("shows the orchestrator a released lane's events", () => {
    const released = (lane: Lane): boolean => lane === RESIDENT;
    expect(visibleTo(ORCHESTRATOR_LANE, RESIDENT, released)).toBe(true);
    // …and only that one. `OTHER` still has its resident.
    expect(visibleTo(ORCHESTRATOR_LANE, OTHER, released)).toBe(false);
  });

  /**
   * A resident is never handed another conversation's work, released or not.
   * The widening is the orchestrator's alone, which is what keeps two agents
   * reading disjoint sets.
   */
  it("never widens a scoped claim, whatever has been released", () => {
    const everythingReleased = (): boolean => true;
    expect(visibleTo(RESIDENT, OTHER, everythingReleased)).toBe(false);
    expect(visibleTo(RESIDENT, ORCHESTRATOR_LANE, everythingReleased)).toBe(false);
    // Its own lane, always — a released thread's resident that is still running
    // finishes what it already had.
    expect(visibleTo(RESIDENT, RESIDENT, everythingReleased)).toBe(true);
  });
});
