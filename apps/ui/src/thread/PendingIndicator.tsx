import { isAgentPresent } from "@corpus/contract";
import { useQueueStatus } from "@corpus/kit";
import { useEffect, useState, type ReactElement } from "react";

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

/** Coarse on purpose: nothing here changes faster than every 45 s. */
const TICK_MS = 15_000;

/** `18m`, `2h 05m`, `1d 03h` — the shape the row already uses for ages. */
export function humanizeElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ${String(hours % 24).padStart(2, "0")}h`;
}

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

export function pendingLabel(
  state: PendingState,
  elapsedMs: number,
  agentPresent: boolean,
): string {
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
}

export function PendingIndicator({ since, state }: PendingIndicatorProps): ReactElement {
  const [now, setNow] = useState(() => Date.now());
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

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

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
    >
      {state === "working" ? (
        <span className="working-dot" aria-hidden="true" />
      ) : (
        <span className="queued-dot" aria-hidden="true" />
      )}
      {pendingLabel(state, elapsed, agentPresent)}
    </div>
  );
}
