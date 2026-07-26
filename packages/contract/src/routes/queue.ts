import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { EventIdSchema } from "../schemas/id.js";
import {
  ClaimBatchSchema,
  FailEventRequestSchema,
  QueueEventSchema,
  QueueStatusSchema,
} from "../schemas/queue.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

const EventIdParamSchema = z.object({
  id: EventIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

/**
 * Read on load by the console strip: SSE only announces invalidation, so the
 * halted dot and the queue depth need a plain fetch (SPEC.md §2.2 rule 3).
 */
export const getQueueStatus = createRoute({
  method: "get",
  path: "/api/queue/status",
  tags: ["queue"],
  summary: "Halted state and per-status event counts",
  responses: {
    200: jsonContent(QueueStatusSchema, "Current queue depth and halt state."),
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const claimAll = createRoute({
  method: "post",
  path: "/api/queue/claim-all",
  tags: ["queue"],
  summary: "Atomically claim every pending event",
  description:
    "Moves all `pending/*` events to `in-progress/` in one call and returns them as a batch; concurrent " +
    "claims never hand the same event to two callers. Returns an empty batch while halted (SPEC.md §7).",
  request: { headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      ClaimBatchSchema,
      "The claimed events; empty while halted or when nothing is pending.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const completeEvent = createRoute({
  method: "post",
  path: "/api/queue/{id}/complete",
  tags: ["queue"],
  summary: "Mark a claimed event processed",
  request: { params: EventIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `processed/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const failEvent = createRoute({
  method: "post",
  path: "/api/queue/{id}/fail",
  tags: ["queue"],
  summary: "Mark a claimed event failed",
  request: {
    params: EventIdParamSchema,
    headers: ActorHeaderSchema,
    body: { content: { "application/json": { schema: FailEventRequestSchema } } },
  },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `failed/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
