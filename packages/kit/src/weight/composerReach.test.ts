import { describe, expect, it } from "vitest";
import { composerReachesAgent } from "./composerReach.js";

/**
 * The one derivation of "will sending reach the agent" (SPEC.md §8, §10).
 *
 * Pinned on its own because two features consume it — the weight control's
 * liveness today, the reach statement (§10's rider signed 2026-08-05) when it is
 * built — and the failure this exists to prevent is the two of them answering
 * one sentence differently.
 */
describe("whether a composer says sending reaches the agent", () => {
  it("yes when it asks explicitly", () => {
    expect(composerReachesAgent({ requestsAgent: true })).toBe(true);
    // The thread's own state does not overrule an explicit ask.
    expect(composerReachesAgent({ requestsAgent: true, engaged: false })).toBe(true);
  });

  it("no when it says note only — even in an engaged conversation", () => {
    expect(composerReachesAgent({ requestsAgent: false })).toBe(false);
    expect(composerReachesAgent({ requestsAgent: false, engaged: true })).toBe(false);
  });

  it("defers to the conversation when the flag is omitted (SPEC.md §8)", () => {
    // Omitted is the wire's third state: "enqueue if this thread is already
    // engaged". Every composer sends an explicit flag today, but the derivation
    // is total over the wire — answering `false` here would call a live control
    // dead.
    expect(composerReachesAgent({ engaged: true })).toBe(true);
    expect(composerReachesAgent({ engaged: false })).toBe(false);
  });

  it("no when nothing is known — a thread that does not exist enqueues nothing", () => {
    expect(composerReachesAgent({})).toBe(false);
  });
});
