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

import { requestedWeightPayload, type Lane } from "@corpus/contract";
import type { ParsedMentions, ResolvedTarget } from "./mentions.js";
import { COMMENT_CREATED, EVENT_SOURCE, type ThreadsWorkspace } from "./workspace.js";

export interface CommentEventInput {
  readonly threadId: string;
  /** Null for a standalone thread — the conversation is its own context (§6). */
  readonly parentId: string | null;
  /** The turn that asked for the agent; its `ts` is the turn's identity (§6). */
  readonly turnTs: string;
  readonly parsed: ParsedMentions;
  /**
   * The weight the request stated (SPEC.md §7, rider signed 2026-08-06), or
   * `undefined` when it stated none — which means the orchestrator decides, and
   * is the ordinary case.
   *
   * Not optional on this type, deliberately. Every composer that can reach the
   * agent may state one (§10), so every producer here has to say what its
   * request carried; a `?` would let a surface added later ship silently
   * dropping the field, which is SHARED-012's lesson about attachments told
   * once more.
   */
  readonly weight: string | undefined;
  /**
   * The lane the message named (SPEC.md §7), or `undefined` when it named none
   * — which means the lane is computed from where it was posted, and is the
   * ordinary case.
   *
   * Not optional on this type, for the reason `weight` is not: every producer
   * has to say what its request carried, so a surface added later cannot ship
   * silently dropping the field. Capture is the one producer that always passes
   * `undefined`, and that is a decision the contract makes — a capture creates a
   * standalone thread that is in no scope by construction, so there is no
   * conversation yet to route away from.
   */
  readonly recipient: Lane | undefined;
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
 *
 * The stated weight is **spread in** through `requestedWeightPayload` rather
 * than written as a key here, and that is the whole of the server's part in it:
 * the level arrives verbatim and leaves verbatim, and a request that stated none
 * produces a payload with no such key at all. Absence is the instruction "the
 * orchestrator decides" (§7), so it has exactly one spelling and the fragment is
 * what makes that structural — a hand-written `weight: input.weight` would put
 * an explicit `undefined` there and a JSON round trip would turn it into a
 * second one. Nothing here reads the value: which model a level maps to is the
 * skill's business (§7 keeps model names out of the spec, and a workspace edits
 * its own guidance under §2.4), so a server that checked it against a list would
 * reject a level its own workspace defines.
 */
export const commentPayload = (input: CommentEventInput): Record<string, unknown> => ({
  threadId: input.threadId,
  parentId: input.parentId,
  turnTs: input.turnTs,
  mentions: targets(input.parsed.mentions),
  skills: targets(input.parsed.skills),
  unresolved: [...input.parsed.unresolved],
  ...requestedWeightPayload(input.weight),
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
    // Beside the payload, never inside it (SPEC.md §7): the recipient decides
    // the lane the event is stamped with, while the payload's `threadId` is what
    // files whatever the answering agent writes. A summons is exactly where the
    // two differ, and merging them would make a reply annex the thread it was
    // asked in.
    recipient: input.recipient,
  });
  return event.id;
}
