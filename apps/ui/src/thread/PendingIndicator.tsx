import { isAgentPresent, ORCHESTRATOR_LANE } from "@corpus/contract";
import { humanizeElapsed, useQueueStatus, type LaneRow } from "@corpus/kit";
import type { ReactElement } from "react";
import { useNowTick } from "./useNowTick";

/**
 * The honest pending indicator of SPEC.md §8: while an agent response is
 * outstanding, a `.working` row that says how long it has been outstanding —
 * and **nothing else**.
 *
 * No progress bar, no percentage, no token stream. The server does not know how
 * far along a job is (SPEC.md §2.2 keeps document content off the wire entirely,
 * and a job's progress is not a thing the queue measures), so any bar drawn here
 * would be an animation pretending to be information. What the UI *does* know is
 * when the requesting turn was written, so that is what it reports.
 *
 * **Elapsed is measured from the turn, not from mount.** Reloading the page in
 * the middle of a fifteen-minute job must not reset the message to "agent is
 * working…" — the wait did not restart, and a page that says it did is lying
 * about the only fact this row carries.
 *
 * **And "working" is a claim, not a synonym for "outstanding"** (SPEC.md §8's
 * rider, signed 2026-08-12; UI-097). A queued event nobody has claimed said
 * "agent is working…" and then escalated to "still working — longer than usual",
 * with increasing urgency, about work that had not started — which is what a
 * person sees whenever they post to an agent that is not running. So the row has
 * two vocabularies, {@link WORKING_TIERS} and {@link WAITING_TIERS}, chosen by
 * who is holding the event, over **one clock**: the wait is the wait, and being
 * claimed after ten minutes does not make it a fresh request.
 */

export type PendingState = "working" | "waiting";

export const WORKING_TIERS = {
  /** Under 45 s. */
  fresh: "agent is working…",
  /** 45 s – 3 m. */
  slow: "still working…",
  /** 3 m – 15 m. */
  longer: "still working — longer than usual",
} as const;

/**
 * The same ladder for an event **nobody has taken**, and it escalates towards a
 * different question.
 *
 * A long-running job is *slow*; an unclaimed one is *stuck*, and the person
 * looking at it wants to know why nothing has started rather than how much
 * longer it will take. So the tiers are not "still working" reworded: they say
 * what has not happened, and past three minutes they name the likeliest reason —
 * because at that point "is anybody there?" is the question, and since
 * CONTRACT-045 the queue status answers it with evidence instead of leaving the
 * row to guess.
 *
 * No ellipsis anywhere in them, deliberately. `agent is working…` trails off
 * because something is ongoing; nothing is ongoing here, and the punctuation is
 * read faster than the words.
 */
export const WAITING_TIERS = {
  /** Under 45 s. */
  fresh: "queued — waiting to be picked up",
  /** 45 s – 3 m. */
  slow: "still waiting to be picked up",
  /** 3 m – 15 m, with an agent connected. */
  longer: "still waiting — nothing has picked this up yet",
  /** 3 m – 15 m, with nobody parked on any lane. */
  absent: "still waiting — no agent is connected",
} as const;

/** The clause the late tiers add when the roster says nobody is listening. */
export const NO_AGENT_CLAUSE = "no agent is connected";

export const SLOW_AFTER_MS = 45_000;
export const LONGER_AFTER_MS = 3 * 60_000;
export const ELAPSED_AFTER_MS = 15 * 60_000;

export function workingLabel(elapsedMs: number): string {
  if (elapsedMs >= ELAPSED_AFTER_MS) return `still working — ${humanizeElapsed(elapsedMs)}`;
  if (elapsedMs >= LONGER_AFTER_MS) return WORKING_TIERS.longer;
  if (elapsedMs >= SLOW_AFTER_MS) return WORKING_TIERS.slow;
  return WORKING_TIERS.fresh;
}

/**
 * The waiting ladder, at the same thresholds as {@link workingLabel}.
 *
 * `agentPresent` is only ever allowed to make the row say *more*, never to make
 * it say a wait is fine: absence is named from three minutes on, and under that
 * an unclaimed event is unremarkable whether or not anyone is parked — a claim
 * takes a moment, and a row that shouted about an empty roster for every request
 * posted a second before the agent picked it up would be the same
 * unevidenced-urgency failure in the other direction.
 *
 * **Unknown counts as present.** The caller passes `true` while the queue status
 * has not answered, because "no agent is connected" is a claim like any other
 * and this row does not make claims it cannot support.
 */
export function waitingLabel(elapsedMs: number, agentPresent: boolean): string {
  if (elapsedMs >= ELAPSED_AFTER_MS) {
    const elapsed = `still waiting — ${humanizeElapsed(elapsedMs)}`;
    return agentPresent ? elapsed : `${elapsed}, ${NO_AGENT_CLAUSE}`;
  }
  if (elapsedMs >= LONGER_AFTER_MS) {
    return agentPresent ? WAITING_TIERS.longer : WAITING_TIERS.absent;
  }
  if (elapsedMs >= SLOW_AFTER_MS) return WAITING_TIERS.slow;
  return WAITING_TIERS.fresh;
}

/**
 * ---
 *
 * **And the row learns lanes** (SPEC.md §7's resident paragraphs, §8's rider of
 * 2026-08-13; UI-109). Where the conversation sits in a designated scope, "the
 * agent" is a resident with a name, and the two tiers above become three cases
 * — because §7 makes *who answers* depend on whether that resident is there.
 *
 * The rule the whole of this section follows: **name the resident for what the
 * resident is actually doing, and for nothing else.**
 *
 * - A **live** lane may be named in either vocabulary. Work claimed on it is
 *   that resident's work — a scoped claim sees only its own lane, so nobody else
 *   could have taken it — and work waiting on it is waiting for them.
 * - A **lapsed or never-parked** lane may be named only while **waiting**. §7's
 *   fallback makes its pending events visible to the orchestrator's unscoped
 *   claim, so the wait is honestly *"they are away, and this gets picked up
 *   anyway"* — the second half being the point, since the cost of a lapse is
 *   that work is slower and never that it is silently not done. But a claimed
 *   event on such a lane may have been taken by the fallback, and saying
 *   "researcher is working" about work the orchestrator picked up is precisely
 *   the unevidenced claim UI-097 removed. So `working` on an away lane falls
 *   back to {@link WORKING_TIERS}, which claims nothing about who.
 * - An **unknown** lane says nothing at all, and the row reads exactly as it did
 *   before this feature. Same rule again: the roster has not answered, so there
 *   is no name to use.
 *
 * The orchestrator's own lane is never named either, and not because it is a
 * special case — `laneName` calls it *"agent"*, which is the word
 * {@link WORKING_TIERS} already uses, so the general rule and the default tiers
 * happen to agree there.
 *
 * **Lane wording replaces the presence clause rather than joining it.**
 * {@link NO_AGENT_CLAUSE} is the workspace-grained fact off `QueueStatus.agent`;
 * a lane's liveness is the roster's per-lane one, and CONTRACT-053 records that
 * the two may legitimately disagree for one grace window. So the row states one
 * or the other and never both in one sentence: on a designated lane the roster
 * answers, everywhere else the queue status does, and the two facts are never
 * merged into a single claim.
 *
 * **Nothing here changes the clock, or the thresholds.** The lane changes what
 * the row says, exactly as being claimed does; the wait is still the wait.
 *
 * ## What it cannot see, and the two cases where that shows
 *
 * The lane is the **scope walk's** answer — where a message posted in this
 * conversation would go — and not the lane the outstanding event was actually
 * stamped with. Those are the same thing for a `comment.created`, which is what
 * this row is nearly always about, and §7 names exactly two events that take a
 * different lane from the scope they fall in: a `resident.designated`, which
 * goes to the orchestrator whoever is designated, and a message that **named a
 * recipient**, which goes to that recipient. On those two the row names the
 * scope's resident for work another lane is holding.
 *
 * It is a display error and never a routing one, and it is not fixable here:
 * `Job` carries no lane (`packages/contract/src/schemas/job.ts`), so the outstanding
 * job the row is counting cannot say which lane it is on. UI-109's issue
 * anticipated reading it off the job's row; the field does not exist, and adding
 * it is contract work. Observed in the UI-109 drill: designating a conversation
 * enqueues `resident.designated` on the orchestrator's lane, and for the few
 * seconds before it settles the card reads "waiting for researcher".
 */

/** What a lapsed lane's absence means for the message waiting on it (SPEC.md §7). */
export const LANE_FALLBACK_CLAUSE = "the agent will pick this up";

/**
 * The lane, reduced to what the wording needs — `LaneRow`'s own fields, so the
 * board and the composer cannot come to spell one resident two ways.
 */
export type PendingLane = Pick<LaneRow, "lane" | "name" | "liveness">;

/**
 * Why this lane cannot answer right now, or `null` when it can.
 *
 * Two absences rather than one, because they are different facts and a person
 * choosing what to do next needs them apart: a resident that has been here and
 * left may come back on its own, while one that has never parked is not running
 * at all. Both fall back the same way, which is the clause they share.
 */
export function laneAwayClause(lane: PendingLane): string | null {
  if (lane.liveness === "lapsed") return `${lane.name} is away, ${LANE_FALLBACK_CLAUSE}`;
  if (lane.liveness === "waiting") return `${lane.name} is not running, ${LANE_FALLBACK_CLAUSE}`;
  return null;
}

/** Whether this lane is one the row may name at all: designated, and heard about. */
function nameable(lane: PendingLane | undefined): lane is PendingLane {
  return lane !== undefined && lane.lane !== ORCHESTRATOR_LANE && lane.liveness !== "unknown";
}

/** {@link workingLabel}, with the resident named — live lanes only. */
export function laneWorkingLabel(elapsedMs: number, lane: PendingLane): string {
  if (elapsedMs >= ELAPSED_AFTER_MS) {
    return `${lane.name} is still working — ${humanizeElapsed(elapsedMs)}`;
  }
  if (elapsedMs >= LONGER_AFTER_MS) return `${lane.name} is still working — longer than usual`;
  if (elapsedMs >= SLOW_AFTER_MS) return `${lane.name} is still working…`;
  return `${lane.name} is working…`;
}

/**
 * {@link waitingLabel}, per lane.
 *
 * A live lane's wait is *for someone*, which is the useful thing to say — the
 * agent is there and has not taken this yet. An away lane's wait is *for the
 * fallback*, and the clause says so from the first tier rather than from the
 * third: the workspace-grained row waits three minutes before mentioning
 * absence, because a claim takes a moment and nobody knows who would take it,
 * but here the roster has already said this lane's listener is gone, and
 * withholding a fact we hold would be its own kind of dishonesty.
 */
export function laneWaitingLabel(elapsedMs: number, lane: PendingLane): string {
  const away = laneAwayClause(lane);
  if (away !== null) {
    if (elapsedMs >= ELAPSED_AFTER_MS) {
      return `still waiting — ${humanizeElapsed(elapsedMs)}, ${away}`;
    }
    return elapsedMs >= SLOW_AFTER_MS ? `still waiting — ${away}` : `waiting — ${away}`;
  }
  if (elapsedMs >= ELAPSED_AFTER_MS) {
    return `still waiting for ${lane.name} — ${humanizeElapsed(elapsedMs)}`;
  }
  if (elapsedMs >= LONGER_AFTER_MS) {
    return `still waiting — ${lane.name} has not picked this up yet`;
  }
  if (elapsedMs >= SLOW_AFTER_MS) return `still waiting for ${lane.name}`;
  return `queued — waiting for ${lane.name}`;
}

export function pendingLabel(
  state: PendingState,
  elapsedMs: number,
  agentPresent: boolean,
  lane?: PendingLane,
): string {
  if (nameable(lane)) {
    if (state === "waiting") return laneWaitingLabel(elapsedMs, lane);
    // A claimed event on an away lane may have been taken by the fallback, so
    // the resident is named only where the claim is certainly theirs.
    if (lane.liveness === "live") return laneWorkingLabel(elapsedMs, lane);
  }
  return state === "working" ? workingLabel(elapsedMs) : waitingLabel(elapsedMs, agentPresent);
}

export interface PendingIndicatorProps {
  /** Timestamp of the turn that asked for the agent. */
  readonly since: string;
  /**
   * Whether the outstanding event has actually been claimed. It changes the
   * wording and nothing else — never the clock, which counts from `since` in
   * both states.
   */
  readonly state: PendingState;
  /**
   * The lane this conversation's messages are addressed to, from the shared
   * roster vocabulary (`useResidentLane`), or `undefined` while nothing can be
   * said about it.
   *
   * **An enhancement over the roster query, never a dependency of the row.**
   * Absent, unknown or orchestrator, the tiers above are what render — which is
   * what makes this safe against a roster that is slow, a workspace with no
   * residents, and a server that answers `GET /api/agents` with nothing useful.
   */
  readonly lane?: PendingLane | undefined;
}

export function PendingIndicator({ since, state, lane }: PendingIndicatorProps): ReactElement {
  const now = useNowTick();
  /*
   * The roster's own verdict, aggregated over every lane (`QueueStatus.agent`,
   * CONTRACT-045) — read here rather than derived from the queue counts beside
   * it, which is what that field exists to stop.
   *
   * It costs no request: `QUEUE_KEY` is one cache entry for the whole app, the
   * console strip already holds it, and the server invalidates it over SSE on
   * every queue transition. And it is re-evaluated on this row's own tick rather
   * than only when data arrives, because `isAgentPresent` expires a `live: true`
   * whose evidence has aged past the grace window — a verdict fetched before the
   * agent walked away must not sit here forever.
   */
  const queue = useQueueStatus();
  const agent = queue.data?.agent;
  const agentPresent = agent === undefined || isAgentPresent(agent, new Date(now));

  const started = new Date(since).getTime();
  // An unparseable timestamp is not a reason to claim a duration.
  const elapsed = Number.isNaN(started) ? 0 : Math.max(0, now - started);

  return (
    <div
      /*
       * One class, because it is one row: the hairline, the gap and the ink are
       * the same in both states and only the dot and the sentence differ. What
       * it is *saying* is on `data-pending-state`, which is where a stylesheet
       * or a spec asks — a second class would be a second thing to keep in step
       * with the state that already decides both.
       */
      className="working"
      role="status"
      data-working-since={since}
      data-pending-state={state}
      /* The lane the row is speaking about, or absent when it is speaking about none. */
      {...(nameable(lane) ? { "data-pending-lane": lane.lane } : {})}
    >
      {state === "working" ? (
        <span className="working-dot" aria-hidden="true" />
      ) : (
        <span className="queued-dot" aria-hidden="true" />
      )}
      {pendingLabel(state, elapsed, agentPresent, lane)}
    </div>
  );
}
