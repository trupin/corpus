import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { ThreadIdSchema } from "../schemas/id.js";
import {
  AppendTurnRequestSchema,
  AppendTurnResponseSchema,
  CreateThreadRequestSchema,
  CreateThreadResponseSchema,
  ThreadSchema,
} from "../schemas/thread.js";
import {
  jsonContent,
  LOCKED_RESPONSE,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

const ThreadIdParamSchema = z.object({
  id: ThreadIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
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
    body: { content: { "application/json": { schema: CreateThreadRequestSchema } } },
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
    "thread (SPEC.md §6). Multipart attachment uploads arrive with CONTRACT-002.",
  request: {
    params: ThreadIdParamSchema,
    headers: ActorHeaderSchema,
    body: { content: { "application/json": { schema: AppendTurnRequestSchema } } },
  },
  responses: {
    201: jsonContent(AppendTurnResponseSchema, "The appended turn and the updated thread summary."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
