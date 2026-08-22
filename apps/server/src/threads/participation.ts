// Agent participation: the one place that decides whether a turn enqueues a
// `comment.created`, and what the thread's `agent` and `status` fields become
// (SPEC.md §8).
//
// §8 is a matrix, not a rule, and every cell is reachable from the HTTP surface —
// so it is computed once, here, and both creation and turn-append read the same
// answer. Writing it twice is how the "note only" toggle stops working on one of
// the two paths and nobody notices until a person is woken at 3am by a comment
// they explicitly marked silent.
//
// **`requestsAgent` is a tri-state and is never collapsed.** Omitted, `true` and
// `false` are three different instructions (CONTRACT-002 pins this):
//
//   - `true`  — request the agent. Wins over everything, including `resolved`
//     (sprint-006 Adjudication 5: resolving suppresses the *automatic*
//     re-trigger §8 describes, it is not a mute button on someone deliberately
//     typing `@agent`). Since SHARED-019 Amendment 1 that short-circuit is no
//     longer the only way through a resolved thread — it is simply the way that
//     also wins when §8's automatic clause would have said no — and it needs no
//     special handling here beyond staying where it is, *above* the status
//     question, which is answered against the thread as this turn leaves it.
//   - `false` — "note only". Wins over everything, including an `@agent` in the
//     body: the explicit instruction outranks the parsed one.
//   - omitted — fall through to what the body says and, on an existing thread,
//     to whether the agent is already engaged.
//
// A `??` anywhere near this value would turn `false` into "omitted" and delete
// the toggle §8 exists for.

import type { Actor, ThreadAgent, ThreadStatus } from "@corpus/contract";
import { requestsAgent as parseRequestsAgent, type ParsedMentions } from "./mentions.js";

export interface ParticipationInput {
  /** The tri-state, exactly as it arrived. `undefined` means *omitted*. */
  readonly requestsAgent: boolean | undefined;
  /** Who wrote the turn — the `x-corpus-author` party, not the enqueue signal. */
  readonly author: Actor;
  readonly parsed: ParsedMentions;
  /**
   * The thread as it stands **before** this turn, or `null` when the turn is
   * creating the thread. A new thread cannot be `engaged`, so creation's omitted
   * behaviour is mention-only — which is exactly what the contract's
   * `THREAD_CREATE_OMITTED_BEHAVIOUR` promises.
   */
  readonly thread: { readonly agent: ThreadAgent; readonly status: ThreadStatus } | null;
}

export interface ParticipationDecision {
  readonly enqueue: boolean;
  /** The thread's `agent` field after this turn; equal to the current one when nothing moves. */
  readonly agent: ThreadAgent;
  /** The thread's `status` after this turn; equal to the current one when nothing moves. */
  readonly status: ThreadStatus;
}

export function decideParticipation(input: ParticipationInput): ParticipationDecision {
  const current = input.thread?.agent ?? "none";
  // Status first, and the enqueue question is then asked against it: §8's reopen
  // is not a second rule beside the matrix, it is what the matrix reads.
  const status = nextStatus(input);
  const enqueue = shouldEnqueue(input, status);
  return { enqueue, agent: nextAgentState(current, input.author, enqueue), status };
}

/**
 * §8's reopen (SHARED-019 Amendment 1): "a turn written by a person on a
 * `resolved` thread sets the thread back to `open`", and "a turn written by the
 * **agent** never reopens a thread, so a conversation the agent closes stays
 * closed".
 *
 * It is a fact about the **author**, checked here and nowhere else, so no
 * ordering elsewhere can accidentally grant it: the agent's own turn is refused
 * the reopen even when it enqueues, and the person's turn gets it even when it
 * does not.
 *
 * The value returned is the status the turn *leaves* the thread in, which is
 * what {@link shouldEnqueue} then reasons about — so "reply on a resolved
 * engaged thread wakes the agent" needs no clause of its own: by the time §8's
 * automatic re-trigger is evaluated, the thread is open.
 */
function nextStatus(input: ParticipationInput): ThreadStatus {
  // Creating a thread creates it open; there is no earlier status to preserve.
  const thread = input.thread;
  if (thread === null) return "open";
  return thread.status === "resolved" && input.author === "user" ? "open" : thread.status;
}

function shouldEnqueue(input: ParticipationInput, status: ThreadStatus): boolean {
  // "Note only" first, and unconditionally: nothing below may override an
  // explicit instruction not to wake the agent.
  if (input.requestsAgent === false) return false;
  if (input.requestsAgent === true) return true;
  if (parseRequestsAgent(input.parsed)) return true;

  const thread = input.thread;
  if (thread === null) return false;
  // §8: "Every later turn in a thread where the agent is engaged re-triggers the
  // agent unless the user marks the thread resolved or posts with the 'note
  // only' toggle." Read against the status this turn *leaves*, not the stored
  // one: a person's reply has already reopened the thread by here, so the only
  // turn this clause still refuses on `resolved` is the agent's own — which is
  // precisely the conversation §8 says stays closed.
  if (thread.agent !== "engaged" || status === "resolved") return false;
  // ...and unless the agent is the one talking. §8's sentence is about the
  // person replying to the agent ("once you've pulled the agent into a
  // conversation, replying to it should just work"); an agent turn that
  // auto-enqueued would hand the agent its own reply to answer, forever, and
  // `apps/cli` posts every agent turn with `x-corpus-author: agent`. An agent
  // that genuinely wants waking back — a subagent handing off — says so with an
  // explicit `requestsAgent: true`, which is handled above.
  return input.author === "user";
}

/**
 * The `agent` field's transitions (SPEC.md §6, §8), in the order they can fire:
 *
 *   - `requested → engaged` on the **agent's first turn** in a thread that asked
 *     for it. §7 tells the comment skill to "close the loop by setting
 *     `agent: engaged` on first reply"; the server does it mechanically instead,
 *     because it is the sole writer and because a skill that forgets would leave
 *     the thread unable to re-trigger for the rest of its life.
 *   - `none → requested` on the first turn that asks for the agent, which is
 *     what makes the pending-agent indicator honest before any reply exists.
 *
 * `engaged` is terminal: resolving a thread stops the re-trigger without
 * unwinding the fact that the agent took part.
 *
 * **The field only ever climbs, and that is intentional** (SERVER-054, after
 * UI-058 found it reads like a bug). Nothing lowers it: not the agent's reply,
 * not a resolve, not a `requestsAgent: false` turn. It records that the agent is
 * *in* this conversation, which is what §8's automatic re-trigger reads — a
 * field that came back down would make a thread stop working the moment its last
 * exchange settled, and the person would have to say `@agent` again in a
 * conversation the agent is plainly part of.
 *
 * So it answers "has the agent been drawn in", and it **cannot** answer "is a
 * reply outstanding now". The second question is the queue's: an unsettled event
 * naming the thread (`docs/needs.ts`'s `AWAITING_AGENT_SQL`). Two surfaces built
 * the second answer out of this field and both were wrong the same way — a
 * "note only" turn, which enqueues nothing, lit a pending-agent indicator.
 */
function nextAgentState(current: ThreadAgent, author: Actor, enqueue: boolean): ThreadAgent {
  if (author === "agent" && current === "requested") return "engaged";
  if (enqueue && current === "none") return "requested";
  return current;
}
