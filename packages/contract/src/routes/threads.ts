import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { ContextPackSchema } from "../schemas/context.js";
import { ThreadIdSchema } from "../schemas/id.js";
import {
  DeleteTurnResultSchema,
  MarkSeenRequestSchema,
  MarkSeenResultSchema,
  ThreadMutationResponseSchema,
  ThreadSchema,
} from "../schemas/thread.js";
import { IsoDateTimeSchema } from "../schemas/time.js";
import {
  FORBIDDEN_RESPONSE,
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

const ThreadIdParamSchema = z.object({
  id: ThreadIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

const TurnParamsSchema = z.object({
  id: ThreadIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
  ts: IsoDateTimeSchema.openapi({
    param: { name: "ts", in: "path", required: true },
    description:
      "The turn's timestamp, which is its identity within the thread (SPEC.md §6). An ISO 8601 " +
      "instant contains `:`, so clients must URL-encode it — `2026-07-19T10%3A05%3A00Z`.",
  }),
});

export const getThread = createRoute({
  method: "get",
  path: "/api/threads/{id}",
  tags: ["threads"],
  summary: "Read a thread with its turns",
  description: "Thread *lists* go through `GET /api/docs` with `type=thread` (SPEC.md §9.2).",
  request: { params: ThreadIdParamSchema },
  responses: {
    200: jsonContent(ThreadSchema, "The thread and every turn, oldest first."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

/**
 * The thread's **context pack** (SPEC.md §7 Retrieval discipline, §9.2 —
 * Retrieval Phase C). The endpoint behind `corpus thread context <id>`, and from
 * Phase C the first thing the product's comment skill reads about a
 * conversation.
 *
 * **Why this is not two calls the caller makes itself.** An agent handed a
 * thread id can already reach every ingredient — `GET /api/threads/{id}` for the
 * turns, `GET /api/docs/{id}` for the parent's body, `GET /api/docs/{id}/related`
 * for neighbours — and assembling them costs a whole parent body to read one
 * section, plus a related list whose rows are the document's *opening* line
 * rather than the passage that matched. This route exists for the frugality
 * contract: one call, bounded output, the passage rather than the body, and the
 * matching passage rather than the opening one.
 *
 * The shape of the answer is `ContextPackSchema`'s five-way discrimination, and
 * the caps are its named constants — including the parent-deleted case, which is
 * a `200` about a thread that exists rather than a `404` inherited from a
 * document that does not.
 */
export const getThreadContext = createRoute({
  method: "get",
  path: "/api/threads/{id}/context",
  tags: ["threads"],
  summary: "The thread's bounded context pack",
  description:
    "A **briefing** for one conversation: the parent-side passage the thread is about, plus the " +
    "most-related excerpts from across the corpus — each an id, a heading path and a short " +
    "excerpt, ranked by relatedness to the thread's anchor *and* its text. **Bounded by " +
    "contract**: reading a pack costs roughly the same however large the corpus grows " +
    "(SPEC.md §7), so the response caps the excerpt count, each excerpt's length and the " +
    "parent-side prose, and never carries a body. `shape` discriminates the five thread cases in " +
    "one field — `anchored` (the quote plus the whole enclosing section), `whole-document` (the " +
    "parent's title and opening content), `orphaned-anchor` (the preserved quote, no resolved " +
    "passage, SPEC.md §6), `standalone` (no parent block at all) and `parent-deleted` (the parent " +
    "was deleted out from under the thread: **still a `200`**, with the id that no longer " +
    "resolves named, because the conversation is real and a `404` here would make the verb " +
    "unusable on exactly the threads hardest to reconstruct). A section past the cap is truncated " +
    "around the anchor and the parent block says so, so an agent knows to escalate to " +
    "`GET /api/docs/{id}` rather than assume it saw everything. `semanticIndex` reports when the " +
    "semantic half of ranking is not caught up, the same word `/api/search` and " +
    "`/api/docs/{id}/related` report for the same workspace (SPEC.md §9.1); a semantic provider " +
    "that fails degrades the ranking, never the status code. **No query parameters**: the bounds " +
    "live in the contract, not in a flag. A document that exists but is not a thread is a `404` " +
    "on this surface rather than a `400`, matching `GET /api/threads/{id}`. Read-only; no acting " +
    "party.",
  request: { params: ThreadIdParamSchema },
  responses: {
    200: jsonContent(
      ContextPackSchema,
      "The pack, in whichever of the five shapes the thread has. Always within every cap the " +
        "schema publishes.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const deleteTurn = createRoute({
  method: "delete",
  path: "/api/threads/{id}/turns/{ts}",
  tags: ["threads"],
  summary: "Delete a turn (user-only)",
  description:
    "**User-only**: a request carrying `x-corpus-author: agent` is rejected with `403` — the agent " +
    "never deletes turns (SPEC.md §6). Cascade: deleting a thread's **last** turn deletes the thread " +
    "itself, and deleting a thread removes its anchor entry from the parent's frontmatter, so no " +
    "highlight is left pointing at an empty conversation. Git retains the deleted turn. It presents " +
    "no key (SPEC.md §7): deleting a named turn states its own change, and the cascade rewrites one " +
    "`anchors` entry rather than replacing anything a reader was holding.",
  request: { params: TurnParamsSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(DeleteTurnResultSchema, "What the deletion cascaded to."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const resolveThread = createRoute({
  method: "post",
  path: "/api/threads/{id}/resolve",
  tags: ["threads"],
  summary: "Resolve a thread",
  description:
    "Sets `status: resolved`. The thread collapses in the document view and **later turns stop " +
    "re-triggering the agent** even while it is `engaged` (SPEC.md §8) — resolving is how a " +
    "conversation is closed without deleting anything. Resolving rewrites the thread file and " +
    "auto-commits it, so the response carries §14's warnings — a workspace hook that rejects the " +
    "commit leaves the status change on disk and uncommitted, and that has to be visible.\n\n" +
    "**Resolving releases the thread's resident with it** (SPEC.md §7): a settled conversation " +
    "has nobody to keep resident, so the response's `resident` is null whenever there was one. " +
    "Nothing already queued moves — a lane is stamped once, at enqueue time — and everything " +
    "enqueued afterwards routes as it did before there was a resident.",
  request: { params: ThreadIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      ThreadMutationResponseSchema,
      "The updated thread summary, and any warnings raised while writing it.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const reopenThread = createRoute({
  method: "post",
  path: "/api/threads/{id}/reopen",
  tags: ["threads"],
  summary: "Reopen a resolved thread",
  description:
    "Sets `status: open` again. An `engaged` thread resumes re-triggering the agent on later turns " +
    "(SPEC.md §8). Like `resolve`, it rewrites and auto-commits the thread file, so the response " +
    "carries §14's warnings.\n\n" +
    "**Reopening does not restore a resident** (SPEC.md §8): resolving released it, and the " +
    "conversation resumes on the orchestrator's lane. Designating again is a deliberate act, as " +
    "the first designation was — the alternative would make releasing conditional on nobody ever " +
    "replying.",
  request: { params: ThreadIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      ThreadMutationResponseSchema,
      "The updated thread summary, and any warnings raised while writing it.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const markThreadSeen = createRoute({
  method: "post",
  path: "/api/threads/{id}/seen",
  tags: ["threads"],
  summary: "Mark a thread read",
  description:
    "Records the last-seen mark in `.corpus/seen.json` and broadcasts an invalidation, so unread " +
    "badges clear everywhere at once (SPEC.md §7). What counts as read is displayed content only — " +
    "opening a parent document does not mark its collapsed-chip threads seen. The body is optional in " +
    "full: a bare `POST` marks the thread read up to its last turn, which is what opening a thread " +
    "means, and `lastSeenTs`, when given, records a partial read instead.",
  request: {
    params: ThreadIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description:
        "Optional partial-read mark; omit the body entirely to mark the whole thread read.",
      content: { "application/json": { schema: MarkSeenRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(MarkSeenResultSchema, "The mark now recorded."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
