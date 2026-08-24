import type { AgentLane } from "@corpus/contract";

/**
 * A workspace with one designated conversation, as the composers' suites meet
 * it (SPEC.md §7's roster; UI-108).
 *
 * Shared from here rather than restated per suite for the reason the feature
 * exists at all: five surfaces read one roster, and a per-suite copy is how one
 * of them ends up testing a lane the others do not offer.
 *
 * **The default is a workspace with nothing designated**, which is why no suite
 * written before UI-108 needed changing: with one lane there is nothing to
 * choose between and the recipient control draws nothing at all.
 */

/** The conversation `residentLane` is the lane of. */
export const RESIDENT_THREAD_ID = "th_a";

/** The name the picker shows for it — the resident's, never a document id. */
export const RESIDENT_NAME = "claims-review";

/**
 * The weight it was designated at — a level **key** from the workspace's tier
 * table (SPEC.md §7, rider signed 2026-08-19), which is what a composer
 * addressing this lane names instead of offering a choice (UI-126).
 */
export const RESIDENT_WEIGHT = "heavy";

/**
 * A designated lane with a listener parked on it.
 *
 * `since` is computed rather than written down: `isAgentPresent` expires a
 * `live: true` whose evidence is older than the grace window, so a hard-coded
 * instant would make a "live" fixture quietly lapse as the clock passed it.
 */
export function residentLane(overrides: Partial<AgentLane> = {}): AgentLane {
  return {
    lane: RESIDENT_THREAD_ID,
    resident: {
      name: RESIDENT_NAME,
      docId: "doc_agent",
      weight: RESIDENT_WEIGHT,
      designationId: null,
    },
    live: true,
    since: new Date().toISOString(),
    summary: "reviewing the draft",
    origin: { id: RESIDENT_THREAD_ID, title: "The claims conversation" },
    ...overrides,
  };
}
