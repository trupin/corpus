import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { ThreadIdSchema } from "../schemas/id.js";
import {
  AppendTurnRequestSchema,
  AppendTurnResponseSchema,
  CreateThreadRequestSchema,
  CreateThreadResponseSchema,
  DeleteTurnResultSchema,
  MarkSeenRequestSchema,
  MarkSeenResultSchema,
  MultipartAppendTurnRequestSchema,
  ThreadSchema,
  ThreadSummarySchema,
} from "../schemas/thread.js";
import { IsoDateTimeSchema } from "../schemas/time.js";
import {
  FORBIDDEN_RESPONSE,
  jsonContent,
  LOCKED_RESPONSE,
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

export const createThread = createRoute({
  method: "post",
  path: "/api/threads",
  tags: ["threads"],
  summary: "Create a thread on a selection, a whole document, or standalone",
  description:
    "With a selector, the server writes the anchor entry into the parent's frontmatter and creates the " +
    "thread file atomically (SPEC.md §6). `423` when the parent is held by the other party's edit lock, " +
    "since anchoring mutates the parent.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The thread and its first turn. `body` is mandatory, so the request body is too.",
      content: { "application/json": { schema: CreateThreadRequestSchema } },
    },
  },
  responses: {
    201: jsonContent(
      CreateThreadResponseSchema,
      "The created thread, its anchor, and any enqueued event.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    423: LOCKED_RESPONSE,
  },
});

export const appendTurn = createRoute({
  method: "post",
  path: "/api/threads/{id}/turns",
  tags: ["threads"],
  summary: "Append a turn to a thread",
  description:
    "The server owns the turn format and guarantees timestamps are unique and monotonic within the " +
    "thread (SPEC.md §6). Send `application/json` for a plain turn, or `multipart/form-data` to " +
    "attach files — a turn may be attachment-only, but one carrying neither text nor files is a " +
    "`400`. Multipart bodies are built by `uploadTurn` in `@corpus/contract/client`, since " +
    "`openapi-fetch` serialises JSON only.",
  request: {
    params: ThreadIdParamSchema,
    headers: ActorHeaderSchema,
    // The one body the CONTRACT-004 rule cannot mark mandatory. `required: true`
    // makes `@hono/zod-openapi@1.5.1` register *every* media type's validator
    // unconditionally (`dist/index.mjs`, the `if (route.request?.body?.required)`
    // branches), so a two-media-type body 400s whichever form the caller sends:
    // the JSON request fails the multipart schema's refinement and the multipart
    // request fails the JSON validator's content-type check. `required: false`
    // restores the library's content-type dispatch. The multipart schema is also
    // wholly optional at the JSON-Schema level — its "text or files" rule lives
    // in a `.refine` — so the letter of the rule admits this reading. Escalated
    // with CONTRACT-004; revisit if upstream separates doc `required` from
    // validator registration.
    body: {
      required: false,
      description:
        "The turn, as JSON or as multipart. Omitting it entirely is never a meaningful call — the " +
        "JSON form demands `body` and a multipart part carrying neither `text` nor `files` is a " +
        "`400` — but it is declared optional so the two media types stay independently validated.",
      content: {
        "application/json": { schema: AppendTurnRequestSchema },
        "multipart/form-data": { schema: MultipartAppendTurnRequestSchema },
      },
    },
  },
  responses: {
    201: jsonContent(AppendTurnResponseSchema, "The appended turn and the updated thread summary."),
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
    "highlight is left pointing at an empty conversation. Git retains the deleted turn. Refused with " +
    "`423` when the other party holds the parent document's edit lock, since the cascade may rewrite " +
    "the parent's frontmatter.",
  request: { params: TurnParamsSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(DeleteTurnResultSchema, "What the deletion cascaded to."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    403: FORBIDDEN_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    423: LOCKED_RESPONSE,
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
    "conversation is closed without deleting anything.",
  request: { params: ThreadIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(ThreadSummarySchema, "The updated thread summary."),
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
    "(SPEC.md §8).",
  request: { params: ThreadIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(ThreadSummarySchema, "The updated thread summary."),
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
