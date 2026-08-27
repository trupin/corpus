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

import { LANE_WAITING_EVENT_TYPE, ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
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
 * The third event under the carve-out (SERVER-161; SPEC.md §7's rider signed
 * 2026-08-27): a lane with work and nobody to do it, announced to the
 * orchestrator so it launches a listener.
 *
 * **It is here rather than resolved through the walk, and that is a safety
 * property rather than a shortcut.** The notice is *about* a lane, so a routing
 * rule that read its payload could route it back to the lane it names — and a
 * notice on the lane nobody is listening to is a notice nobody reads, which
 * would announce again, and again. The type deciding the lane makes that
 * impossible however the scope lookup behaves.
 *
 * `service.test.ts` proved the point before this line existed: a test whose
 * scope lookup answered one lane for every payload sent the notice to the
 * resident's lane, where it announced itself, until the test timed out.
 */
export const LANE_WAITING = LANE_WAITING_EVENT_TYPE;

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
  if (
    input.type === RESIDENT_DESIGNATED ||
    input.type === RESIDENT_RELEASED ||
    input.type === LANE_WAITING
  ) {
    return ORCHESTRATOR_LANE;
  }
  if (input.recipient !== undefined) return input.recipient;
  return findScopeRoot(input.payload);
}

/**
 * Has this lane's conversation been **released** by a person? (SPEC.md §7's
 * rider signed 2026-08-25, SERVER-153.)
 *
 * **This is not the fallback under another name, and the difference is the
 * whole of what the rider decided.** A lapse is a listener that is absent —
 * crashed, killed, or never started — and it now surrenders nothing, however
 * long it lasts. A release is a person removing the resident, which is a
 * deliberate act with a visible cause, and it is the *only* thing that returns
 * work: the messages stop being a resident's because the person removed the
 * resident.
 *
 * Read from the projection at claim time and never written into an event, for
 * the reason the fallback was: §7 says the stamp is made once and never
 * rewritten. So a thread designated again finds its lane exactly as it was —
 * which is also why designating into an unfinished drain has to be refused
 * rather than merely discouraged (CONTRACT-089).
 */
export type LaneReleased = (lane: Lane) => boolean;

/**
 * The lookup for a queue with no projection: nothing has been released.
 *
 * The safe direction, and unlike {@link NOTHING_LIVE} — which this replaces —
 * safe now means *narrow*. Answering "released" for an unknown lane would hand
 * a resident's conversation to the orchestrator on the strength of a lookup that
 * had not been bound yet, which is the one outcome the rider rules out. Under
 * the fallback the safe direction was the opposite, because the cost of guessing
 * wrong was work done slowly rather than work done by the wrong agent.
 */
export const NOTHING_RELEASED: LaneReleased = () => false;

/**
 * May a claim scoped to `scope` see an event stamped `lane`? (SPEC.md §7.)
 *
 * **Equality, plus the one thing a person does on purpose.** SPEC.md §7's rider
 * signed 2026-08-25 replaced the lapse fallback: *"A lane's work is done by that
 * lane's agent, and by nobody else… There is no fallback and no timer: an
 * unscoped claim never sees another lane's events, whether that lane is live or
 * not."* And in the same rider: *"Release is the one thing that returns work,
 * and a person does it on purpose."*
 *
 * So the orchestrator's claim sees its own lane, plus any lane whose
 * conversation **no longer has a resident**. Nothing about absence, presence or
 * duration reaches this function — see {@link LaneReleased} for why that is a
 * different question and not a softer version of the same one.
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
export function visibleTo(scope: Lane, lane: Lane, isReleased: LaneReleased): boolean {
  if (lane === scope) return true;
  // A scoped claim sees its own lane and nothing else, in either direction: a
  // resident is never handed another conversation's work, released or not.
  if (scope !== ORCHESTRATOR_LANE) return false;
  return isReleased(lane);
}
