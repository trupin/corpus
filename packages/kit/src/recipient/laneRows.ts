import { isAgentPresent, ORCHESTRATOR_LANE, type AgentLane, type Lane } from "@corpus/contract";
import { humanizeElapsed } from "../time/elapsed.js";

/**
 * How a roster row reads in a composer — SPEC.md §7's *"the composer offers the
 * live roster"*, turned into the words on the screen.
 *
 * Pure, and separated from the control for the reason every liveness rule in
 * this repo now is: the honesty is in the wording, and wording that is derived
 * inside a component is wording no test reaches without rendering one.
 *
 * ## Four states, and the fourth is the absence of an answer
 *
 * `live`, `lapsed` and `waiting` are things the server observed. `unknown` is
 * what a lane reads as when the roster has no row for it — which happens when
 * the scope walk names a lane the roster does not list, in the window between a
 * designation landing and `["agents"]` being refetched. It is UI-098's rule at
 * this grain: **a lane we have not heard about is not a lane with nobody on it**,
 * so `unknown` says nothing about liveness rather than saying "waiting".
 *
 * ## This reads the roster and only the roster
 *
 * CONTRACT-053 records that `QueueStatus.agent` and `GET /api/agents` may
 * legitimately disagree for one grace window. Nothing here reads the queue
 * status, so the picker never presents the two as one fact; the console strip's
 * pill is the workspace-grained answer and this is the per-lane one.
 */

export type LaneLiveness = "live" | "lapsed" | "waiting" | "unknown";

export interface LaneRow {
  readonly lane: Lane;
  /** The name a person reads: the resident's, or {@link ORCHESTRATOR_LABEL}. */
  readonly name: string;
  readonly liveness: LaneLiveness;
  /** The one line beside the name. Empty only for `unknown`, which has nothing to say. */
  readonly line: string;
  /** The conversation this lane is, or null for the orchestrator's. */
  readonly conversation: string | null;
}

/**
 * What the orchestrator's lane is called in a composer.
 *
 * "agent" rather than "orchestrator": §11 keeps the product's vocabulary out of
 * the surface — the person asking has one agent unless they designated another,
 * and the lane's wire name is `orchestrator` for the queue's benefit, not
 * theirs.
 */
export const ORCHESTRATOR_LABEL = "agent";

/** A designated lane whose frontmatter names no resident still names a conversation. */
export const UNNAMED_RESIDENT_LABEL = "this conversation";

/** A live lane the server had nothing else to say about. */
export const LIVE_WITHOUT_SUMMARY = "listening";

/** A lane nothing has ever parked on (SPEC.md §7 — presence is the parked idle, and nothing else). */
export const NEVER_SEEN_LINE = "no listener yet";

/**
 * What a lapsed *designated* lane says — §7's fallback, stated as the
 * consequence rather than as an error: past the grace window its pending events
 * become visible to the orchestrator's unscoped claim, so the work is done more
 * slowly and never silently not done.
 */
export const LAPSED_FALLBACK = "the orchestrator will answer until it returns";

/** …and what a lapsed orchestrator says, which has nothing to fall back to. */
export const LAPSED_ORCHESTRATOR = "nobody is listening";

export function laneLiveness(row: AgentLane, now: Date): LaneLiveness {
  if (isAgentPresent(row, now)) return "live";
  return row.since === null ? "waiting" : "lapsed";
}

/** The name to render for a lane: its resident's, or the orchestrator's label. */
export function laneName(row: AgentLane): string {
  if (row.lane === ORCHESTRATOR_LANE) return ORCHESTRATOR_LABEL;
  return row.resident?.name ?? row.origin?.title ?? UNNAMED_RESIDENT_LABEL;
}

function lastSeen(since: string, now: Date): string | null {
  const seen = Date.parse(since);
  if (Number.isNaN(seen)) return null;
  return humanizeElapsed(Math.max(0, now.getTime() - seen));
}

/**
 * The line beside the name.
 *
 * A live lane shows what the server says it is doing, because that is the most
 * useful true thing available; a lapsed one shows how long it has been gone and
 * what happens meanwhile, because a lapsed pick is legal and the person needs to
 * know what they are choosing.
 */
export function laneLine(row: AgentLane, liveness: LaneLiveness, now: Date): string {
  if (liveness === "live") return row.summary ?? LIVE_WITHOUT_SUMMARY;
  if (liveness === "waiting") return NEVER_SEEN_LINE;
  const fallback = row.lane === ORCHESTRATOR_LANE ? LAPSED_ORCHESTRATOR : LAPSED_FALLBACK;
  const age = row.since === null ? null : lastSeen(row.since, now);
  return age === null ? fallback : `last seen ${age} ago — ${fallback}`;
}

export function laneRow(row: AgentLane, now: Date): LaneRow {
  const liveness = laneLiveness(row, now);
  return {
    lane: row.lane,
    name: laneName(row),
    liveness,
    line: laneLine(row, liveness, now),
    conversation: row.origin?.title ?? null,
  };
}

/**
 * A lane the walk named but the roster does not list.
 *
 * It is offered rather than dropped: it is the computed default, so the composer
 * that hid it would be showing a list that does not contain the answer.
 */
export function unknownLaneRow(lane: Lane): LaneRow {
  return {
    lane,
    name: lane === ORCHESTRATOR_LANE ? ORCHESTRATOR_LABEL : UNNAMED_RESIDENT_LABEL,
    liveness: "unknown",
    line: "",
    conversation: null,
  };
}

/** Every roster row as the composer reads it, the orchestrator's first (the server's order). */
export function laneRows(lanes: readonly AgentLane[], now: Date): readonly LaneRow[] {
  return lanes.map((row) => laneRow(row, now));
}
