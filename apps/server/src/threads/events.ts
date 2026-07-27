// The one `comment.created` producer in the server (SPEC.md §7, §8).
//
// Thread creation, turn append and capture all wake the agent the same way, and
// the payload they write is a **contract with AGENT-002's orchestrator skill**:
// it reads `mentions` and `skills` to dispatch, and `threadId` / `parentId` to
// find the conversation. So the shape is built in exactly one place — three
// call sites composing their own object literal is how one of them ends up
// spelling `parent` instead of `parentId` and the orchestrator silently stops
// routing.
//
// Nothing here decides *whether* to enqueue; that is `participation.ts`.

import type { ParsedMentions, ResolvedTarget } from "./mentions.js";
import { COMMENT_CREATED, EVENT_SOURCE, type ThreadsWorkspace } from "./workspace.js";

export interface CommentEventInput {
  readonly threadId: string;
  /** Null for a standalone thread — the conversation is its own context (§6). */
  readonly parentId: string | null;
  /** The turn that asked for the agent; its `ts` is the turn's identity (§6). */
  readonly turnTs: string;
  readonly parsed: ParsedMentions;
  /** Which surface produced it; defaults to the thread endpoints. */
  readonly source?: string | undefined;
}

/** Copied out of the readonly parse so the payload is a plain, serializable value. */
const targets = (values: readonly ResolvedTarget[]): Record<string, unknown>[] =>
  values.map((target) => ({ name: target.name, docId: target.docId, status: target.status }));

/**
 * The `payload` of a `comment.created` event.
 *
 * `unresolved` is carried even though it never *causes* an enqueue (see
 * `mentions.ts`): when the agent is woken for another reason, "you wrote
 * `@nobody` and there is no such subagent" is exactly the "missing or archived"
 * case §8 asks the orchestrator to answer in its reply.
 */
export const commentPayload = (input: CommentEventInput): Record<string, unknown> => ({
  threadId: input.threadId,
  parentId: input.parentId,
  turnTs: input.turnTs,
  mentions: targets(input.parsed.mentions),
  skills: targets(input.parsed.skills),
  unresolved: [...input.parsed.unresolved],
});

/**
 * Enqueue the event and answer with its id. Goes through the workspace's
 * `enqueue` seam, which in production is `QueueService.enqueue` — the only path
 * that notifies a parked `queue idle` long-poll. A file drop into
 * `.corpus/queue/pending/` would land the same bytes and leave the agent asleep
 * for the rest of its window.
 */
export async function enqueueComment(
  workspace: ThreadsWorkspace,
  input: CommentEventInput,
): Promise<string> {
  const event = await workspace.enqueue({
    type: COMMENT_CREATED,
    source: input.source ?? EVENT_SOURCE.thread,
    payload: commentPayload(input),
  });
  return event.id;
}
