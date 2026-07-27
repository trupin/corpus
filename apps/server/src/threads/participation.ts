// Agent participation: the one place that decides whether a turn enqueues a
// `comment.created`, and what the thread's `agent` field becomes (SPEC.md §8).
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
//     typing `@agent`).
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
}

export function decideParticipation(input: ParticipationInput): ParticipationDecision {
  const current = input.thread?.agent ?? "none";
  const enqueue = shouldEnqueue(input);
  return { enqueue, agent: nextAgentState(current, input.author, enqueue) };
}

function shouldEnqueue(input: ParticipationInput): boolean {
  // "Note only" first, and unconditionally: nothing below may override an
  // explicit instruction not to wake the agent.
  if (input.requestsAgent === false) return false;
  if (input.requestsAgent === true) return true;
  if (parseRequestsAgent(input.parsed)) return true;

  const thread = input.thread;
  if (thread === null) return false;
  // §8: "Every later turn in a thread where the agent is engaged re-triggers the
  // agent unless the user marks the thread resolved or posts with the 'note
  // only' toggle."
  if (thread.agent !== "engaged" || thread.status === "resolved") return false;
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
 */
function nextAgentState(current: ThreadAgent, author: Actor, enqueue: boolean): ThreadAgent {
  if (author === "agent" && current === "requested") return "engaged";
  if (enqueue && current === "none") return "requested";
  return current;
}
