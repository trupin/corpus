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
 * The two event types that ignore the walk (SPEC.md §7).
 *
 * They live here rather than in `threads/resident.ts` — which re-exports them —
 * because the *reason* the names matter twice is this carve-out: an
 * announcement about who is resident on a lane has to reach the
 * **orchestrator**, which is what launches and relaunches listeners. Routed by
 * the ordinary rule each would land on the lane it announces, so re-designating
 * a live lane would hand the launch instruction to the resident being replaced
 * and the new one would never start, and a release would be readable only by
 * the listener it ends.
 */
export const RESIDENT_DESIGNATED = "resident.designated";

/** The release half (SERVER-128, CONTRACT-069), under the same carve-out. */
export const RESIDENT_RELEASED = "resident.released";

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
 * **It decides what a roster row says, and nothing else.** Until the rider
 * signed 2026-08-25 this predicate also decided what an unscoped claim could
 * see: a lane past the grace window had its work folded into the orchestrator's
 * claim. That fallback is gone — {@link visibleTo} is exact equality now — so
 * liveness routes nothing and is a display fact.
 *
 * That is a narrowing worth stating rather than leaving to be inferred, because
 * it changes what a wrong answer costs. A liveness verdict that flickered used
 * to mean a conversation intermittently answered by the wrong agent. Now it
 * means a roster that blinks, and an orchestrator that launches a second
 * listener for a lane whose first is merely between parks — which is why the
 * grace window still has to outlast a rearm gap.
 *
 * The lane is never *written* anywhere on the strength of it.
 */
export type LaneLiveness = (lane: Lane) => boolean;

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
 * 1. **`resident.designated` and `resident.released` go to the orchestrator,
 *    whoever is designated.** They win over a recipient rather than losing to
 *    one, because the reason for them is not a routing preference a caller may
 *    express: the orchestrator is what launches a listener and what has to learn
 *    a lane came back, so an announcement routed anywhere else launches nothing
 *    and is read by nobody who could act on it. No producer can reach this
 *    branch with a recipient anyway — neither route declares a `recipient` field
 *    — so the order settles a question nothing asks today and keeps it settled
 *    if that changes.
 * 2. **A named recipient wins over the walk**, for the one message it was set
 *    on. This is the summons, and the stamp is what makes it arrive: a scoped
 *    claim sees only its own lane and an unscoped claim never sees a live lane's
 *    events, so a summons stamped with the *host's* lane would be claimable by
 *    nobody.
 *
 * Everything else is the walk.
 */
export function laneFor(input: LaneInput, findScopeRoot: ScopeRootLookup): Lane {
  if (input.type === RESIDENT_DESIGNATED || input.type === RESIDENT_RELEASED) {
    return ORCHESTRATOR_LANE;
  }
  if (input.recipient !== undefined) return input.recipient;
  return findScopeRoot(input.payload);
}

/**
 * May a claim scoped to `scope` see an event stamped `lane`? (SPEC.md §7.)
 *
 * **One clause, and it is exact equality** — for every claim, the
 * orchestrator's included. SPEC.md §7's rider signed 2026-08-25 replaced the
 * lapse fallback: *"A lane's work is done by that lane's agent, and by nobody
 * else… There is no fallback and no timer: an unscoped claim never sees another
 * lane's events, whether that lane is live or not."*
 *
 * ## What this function used to do, and why it stopped
 *
 * The orchestrator's clause used to widen: its claim saw its own lane **plus
 * every lane that was not live**, so a listener that crashed did not strand its
 * conversation. The cost §7 accepted was that the work was done *"slower, and
 * without the conversation's warmth"*, and never that it was silently not done.
 *
 * The rider reverses that trade for a reason measured rather than argued.
 * Answering in the resident's place is not a slower version of the same answer —
 * it is a different agent, with none of the conversation, writing in its name.
 * And the fallback had a second cost nobody had priced: because the orchestrator
 * held a lapsed lane's events in `in-progress/`, its own skill forbade launching
 * that lane's listener in the same pass, so a conversation somebody kept using
 * never had a clear pass and **never got its agent at all**. The busier the
 * conversation, the more certain the starvation. Removing the widening removes
 * the collision, and the deferral rule with it.
 *
 * ## Liveness is not a parameter of this question any more
 *
 * It was the only reason this function needed one. §7's grace window survives
 * with one job instead of two — it decides what a roster row's `live` says — and
 * routes nothing. A claim is now answerable from the two lanes alone, which is
 * also why nothing here can drift out of step with the presence tracker: it no
 * longer consults it.
 *
 * The orchestrator's lane was never subject to liveness anyway: `scope ===
 * orchestrator` *is* the unscoped call (the contract defaults the parameter to
 * it), so asking whether the orchestrator is live in order to decide what the
 * orchestrator may claim would have been asking a question of the caller about
 * itself.
 */
export function visibleTo(scope: Lane, lane: Lane): boolean {
  return lane === scope;
}
