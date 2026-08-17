// SPEC.md §7's lanes (SHARED-043 signed 2026-08-13, amended 2026-08-15 and
// 2026-08-16; SERVER-111): which agent an event belongs to, and who may see it.
//
// ## The rule, quoted, because it took three attempts to state
//
// > Every event is stamped with its **lane** when it is enqueued. **Two kinds of
// > event do not take the lane of the scope they fall in**: a message that
// > **named a recipient** takes that recipient's lane, and a
// > `resident.designated` takes the **orchestrator's** lane whoever is
// > designated. Everything else takes the scope's root thread where it falls in
// > a designated scope, and the **orchestrator's lane** where it falls in none.
//
// Everything in this module is that sentence: {@link laneFor} is the rule and
// its two carve-outs, `./scope.ts` is the walk it defers to, and
// {@link visibleTo} is the reading half — "a scoped claim sees only its own
// lane's events, and an unscoped claim never sees a live lane's events".
//
// ## The lane is not the origin
//
// They are read off different inputs and answer different questions: the lane
// **routes** the work, the origin **files** it (`core/provenance.ts`). They come
// apart exactly on a summons — a message posted in one conversation naming
// another conversation's resident — which is stamped with the *recipient's*
// lane (nothing else could reach them) while what the summoned agent writes
// still files into the host conversation. Routing follows the recipient; filing
// follows the conversation.
//
// ## The stamp is made once and never rewritten
//
// Designating a thread does not move work already queued, and releasing a
// resident does not strand it. Every transition below `enqueue` therefore
// carries the lane through untouched, and the *only* thing that reacts to a
// designation changing is {@link visibleTo}, which is evaluated when a claim is
// made rather than written into a file.

import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
import type { StoredEvent } from "./store.js";

/**
 * The one event type that ignores the walk (SPEC.md §7).
 *
 * It lives here rather than in `threads/resident.ts` — which re-exports it —
 * because the *reason* the name matters twice is this carve-out: the
 * announcement that a thread was designated has to reach the **orchestrator**,
 * which is what launches the listener. Routed by the ordinary rule it would land
 * on the lane it announces, so re-designating a live lane would hand the launch
 * instruction to the resident being replaced and the new one would never start.
 */
export const RESIDENT_DESIGNATED = "resident.designated";

/**
 * The lane an event was stamped with.
 *
 * An absent field reads as the orchestrator's lane, which is what makes every
 * event written before lanes existed — and every file a hand dropped into
 * `pending/` — claimable by exactly the caller that could always claim it. No
 * migration, and no third state: the orchestrator's lane is a lane like any
 * other, spelled `"orchestrator"` and never `null`.
 */
export const laneOf = (event: StoredEvent): Lane => event.lane ?? ORCHESTRATOR_LANE;

/**
 * The walk: the lane the scope containing this event's own conversation belongs
 * to, or {@link ORCHESTRATOR_LANE} where it falls in no designated scope.
 *
 * Injected rather than imported because it needs the projection and this module
 * must not: `createServer` builds the queue before it opens a database, and a
 * queue with no projection routes everything to the orchestrator — which is the
 * honest answer for a server that can see no designation at all. The production
 * implementation is `./scope.ts`.
 */
export type ScopeRootLookup = (payload: Record<string, unknown>) => Lane;

/** The lookup for a queue with no projection: nothing is designated. */
export const NO_SCOPE_LOOKUP: ScopeRootLookup = () => ORCHESTRATOR_LANE;

/**
 * Is this lane's listener present right now? (SPEC.md §7's "presence is the
 * parked request, and nothing else".)
 *
 * **SERVER-112 supplies this.** It is a seam and not an implementation because
 * liveness is an observation over time — a lane is live while a scoped `idle` is
 * parked on it, and stays live across the rearm gap between one park and the
 * next — and that tracker is its own issue. What plugs in here is the tracker's
 * `isLive(lane)`, bound through {@link QueueService.attachLaneLiveness}; nothing
 * else in the claim path changes when it does.
 *
 * The lane is never *written* anywhere on the strength of this: it is asked at
 * claim time and only at claim time, so a resident that comes back finds its
 * lane exactly as it left it.
 */
export type LaneLiveness = (lane: Lane) => boolean;

/**
 * The liveness of a server that has no liveness tracker yet: **nothing is live**.
 *
 * That is the safe half of the fallback, not a neutral one, and the direction
 * matters. With nothing live, every thread lane counts as lapsed and its pending
 * events are visible to the orchestrator's unscoped claim — which is precisely
 * how the queue behaved before lanes existed, so no event can be stranded by
 * shipping the partition before the tracker. The opposite default would hide a
 * designated lane's events from the only agent actually running, and §7 is
 * explicit that the cost of a lapse is "that the work is done by the
 * orchestrator instead … and never that it is silently not done".
 *
 * A scoped claim is unaffected either way: the fallback widens the
 * orchestrator's view and never narrows the owner's.
 */
export const NOTHING_LIVE: LaneLiveness = () => false;

/** What {@link laneFor} needs to know about an event being enqueued. */
export interface LaneInput {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  /**
   * The lane this one message named, from a posting request's `recipient`
   * (SPEC.md §7). `undefined` is the ordinary case and means "compute it from
   * where the message was posted" — absence is never a guess the caller has to
   * check.
   */
  readonly recipient?: Lane | undefined;
}

/**
 * The lane to stamp on an event, once, at enqueue time.
 *
 * The two carve-outs are checked before the walk because that is what a carve-out
 * is, and in this order:
 *
 * 1. **`resident.designated` goes to the orchestrator, whoever is designated.**
 *    It wins over a recipient rather than losing to one, because the reason for
 *    it is not a routing preference a caller may express: the orchestrator is
 *    what launches a listener, so an announcement routed anywhere else launches
 *    nothing. No producer can reach this branch with a recipient anyway — the
 *    designation route declares no `recipient` field — so the order settles a
 *    question nothing asks today and keeps it settled if that changes.
 * 2. **A named recipient wins over the walk**, for the one message it was set
 *    on. This is the summons, and the stamp is what makes it arrive: a scoped
 *    claim sees only its own lane and an unscoped claim never sees a live lane's
 *    events, so a summons stamped with the *host's* lane would be claimable by
 *    nobody.
 *
 * Everything else is the walk.
 */
export function laneFor(input: LaneInput, findScopeRoot: ScopeRootLookup): Lane {
  if (input.type === RESIDENT_DESIGNATED) return ORCHESTRATOR_LANE;
  if (input.recipient !== undefined) return input.recipient;
  return findScopeRoot(input.payload);
}

/**
 * May a claim scoped to `scope` see an event stamped `lane`? (SPEC.md §7.)
 *
 * Two clauses, and they are not symmetric:
 *
 * - **A scoped claim sees only its own lane.** Exact equality, with no fallback
 *   of any kind — the fallback widens the orchestrator's view, it never narrows
 *   or widens an owner's. A resident that comes back mid-lapse still sees
 *   everything it left.
 * - **The orchestrator's claim sees its own lane, plus every lane that is not
 *   live.** That is the whole of §7's "an unscoped claim never sees a live
 *   lane's events": what makes two agents safe is disjoint sets, and the sets
 *   are disjoint precisely while the other lane has a listener. When it does
 *   not, the work falls to the orchestrator rather than waiting for an agent
 *   that is not there.
 *
 * The orchestrator's lane is never subject to liveness: `scope === orchestrator`
 * *is* the unscoped call (the contract defaults the parameter to it), so asking
 * whether the orchestrator is live in order to decide what the orchestrator may
 * claim would be asking a question of the caller about itself.
 */
export function visibleTo(scope: Lane, lane: Lane, isLive: LaneLiveness): boolean {
  if (scope !== ORCHESTRATOR_LANE) return lane === scope;
  return lane === ORCHESTRATOR_LANE || !isLive(lane);
}
