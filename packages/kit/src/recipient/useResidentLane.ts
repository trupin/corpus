import type { Lane } from "@corpus/contract";
import { useAgentsRoster } from "../query/useAgentsRoster.js";
import { laneRow, type LaneRow } from "./laneRows.js";
import { laneOf } from "./scopeWalk.js";
import { useScopeWalk } from "./useScopeWalk.js";

/**
 * The roster, read the way a **board surface** reads it — SPEC.md §7's *"who is
 * running is a read, never a push"*, and §10's board showing who is resident.
 *
 * ## Why this is here and not in `apps/ui`
 *
 * Because the composer already says these words. UI-108 built `laneName`,
 * `laneLiveness` and `laneLine` for the recipient picker, and a board badge that
 * derived its own name-and-dot from `AgentLane` would be a second description of
 * one lane sitting a few centimetres from the first — the drift
 * `docs/TS_GUIDELINES.md` names. So the badge, the pending row and the
 * provenance line all come through here, and there is exactly one place where a
 * lane turns into words.
 *
 * ## Two questions, because two surfaces ask different ones
 *
 * - {@link useLaneRow} asks *"is **this** id a lane, and what does it say?"* —
 *   the thread card's question, since §7 makes a lane's name the id of the
 *   designated root thread itself. It costs no walk and no request beyond the
 *   one shared roster query.
 * - {@link useResidentLane} asks *"which lane answers something posted **here**,
 *   and what does it say?"* — the pending row's and the provenance line's
 *   question, which is §7's scope walk and therefore the composer's own
 *   `useScopeWalk`, reused rather than re-derived.
 *
 * ## Absence is not emptiness, one level further down
 *
 * Both answer `undefined` for *"the roster has not said"*, never a row that
 * quietly means nobody. `useAgentsRoster` keeps `lanes` `undefined` until the
 * server answers, `useScopeWalk` answers `unread` until its reads land, and both
 * propagate here — so a board that has not heard yet renders no badge rather
 * than a badge asserting there is no resident. That is UI-098's rule at the
 * board's grain: never assert an absence from a status you have not received.
 *
 * ## The roster only, never `QueueStatus.agent`
 *
 * CONTRACT-053 records that the two may legitimately disagree for one grace
 * window; UI-108 reads the roster alone so the picker never presents them as one
 * fact, and every surface built on this inherits that. A lane's liveness is the
 * roster's answer about that lane, and the console strip's pill remains the
 * workspace-grained one.
 */

/**
 * The roster's row for one lane, as words — or `undefined` when the roster has
 * not answered, or has answered and does not carry it.
 *
 * For a thread id, a row existing **is** the designation: §7 names a lane after
 * its designated root thread, so `useLaneRow(threadId) !== undefined` is exactly
 * *"this conversation has a resident"*, read from the roster rather than from a
 * second field a caller would have to keep in step with it.
 *
 * `now` is a parameter so a caller that ticks — a badge whose whole job is
 * saying whether somebody is there — can re-evaluate `isAgentPresent`'s grace
 * window without a refetch, exactly as the console pill does. Callers that do
 * not tick pass nothing and get render time, which is what the composer does.
 */
export function useLaneRow(lane: Lane | undefined, now?: Date): LaneRow | undefined {
  const roster = useAgentsRoster();
  if (lane === undefined || roster.lanes === undefined) return undefined;
  const row = roster.lanes.find((candidate) => candidate.lane === lane);
  return row === undefined ? undefined : laneRow(row, now ?? new Date());
}

/** Which lane answers a message posted at `start`, and what that lane says. */
export interface ResidentLane {
  /**
   * The lane §7's walk lands on, or `undefined` while it cannot be said — the
   * roster still in flight, or a node of the chain not read yet. Never
   * `orchestrator` as a stand-in for "do not know" (`useScopeWalk`).
   */
  readonly lane: Lane | undefined;
  /** That lane's roster row as words, or `undefined` while the roster cannot say. */
  readonly row: LaneRow | undefined;
}

export function useResidentLane(start: string | null, now?: Date): ResidentLane {
  const roster = useAgentsRoster();
  const walk = useScopeWalk({ start, lanes: roster.lanes });
  const lane = laneOf(walk);
  const row = useLaneRow(lane, now);
  return { lane, row };
}
