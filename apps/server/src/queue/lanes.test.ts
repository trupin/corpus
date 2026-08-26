// SPEC.md §7's lane rule and its two carve-outs, at the level they are a pure
// function (SERVER-111). The walk they defer to is a stub here and has its own
// test in `scope.test.ts` — which is what makes it visible, for each case,
// whether the walk's answer is what gets stamped or is overruled.

import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
import {
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
    expect(visibleTo(RESIDENT, RESIDENT)).toBe(true);
  });

  it("hides every other lane from a scoped claim, the orchestrator's included", () => {
    expect(visibleTo(RESIDENT, OTHER)).toBe(false);
    expect(visibleTo(RESIDENT, ORCHESTRATOR_LANE)).toBe(false);
  });

  it("always shows the orchestrator its own lane", () => {
    expect(visibleTo(ORCHESTRATOR_LANE, ORCHESTRATOR_LANE)).toBe(true);
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
    expect(visibleTo(ORCHESTRATOR_LANE, RESIDENT)).toBe(false);
    expect(visibleTo(ORCHESTRATOR_LANE, OTHER)).toBe(false);
  });

  /**
   * The converse, and it is not optional. "Nothing was returned" is what a
   * wholly broken queue also produces, so the absence above is worth nothing
   * without a case proving the same lane is claimable by its owner.
   */
  it("still shows that same lane to a claim scoped to it", () => {
    expect(visibleTo(RESIDENT, RESIDENT)).toBe(true);
    expect(visibleTo(OTHER, OTHER)).toBe(true);
  });

  /**
   * Nothing about presence reaches this function any more. The signature is the
   * guarantee — there is no argument to pass — and this states it as a fact
   * about behaviour rather than about the type, so a later change that threaded
   * liveness back in through a module-level lookup would have to break it.
   */
  it("answers from the two lanes alone, whatever a listener is doing", () => {
    const answers = new Set([
      visibleTo(ORCHESTRATOR_LANE, RESIDENT),
      visibleTo(ORCHESTRATOR_LANE, RESIDENT),
      visibleTo(ORCHESTRATOR_LANE, RESIDENT),
    ]);
    expect([...answers]).toEqual([false]);
  });
});
