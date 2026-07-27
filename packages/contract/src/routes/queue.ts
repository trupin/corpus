import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { EventIdSchema } from "../schemas/id.js";
import {
  ClaimBatchSchema,
  FailEventRequestSchema,
  HaltQueueRequestSchema,
  IdleQuerySchema,
  IdleResultSchema,
  MAX_IDLE_TIMEOUT_SECONDS,
  QueueEventSchema,
  QueueStatusSchema,
  ReapStaleResultSchema,
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

/**
 * The parking primitive behind `corpus queue idle` (CLAUDE.md Architecture
 * Decision 4). It replaces the spec's `fs.watch` with a long poll: same
 * zero-token parking, but it works against a server the agent may not share a
 * filesystem with.
 */
export const idleQueue = createRoute({
  method: "get",
  path: "/api/queue/idle",
  tags: ["queue"],
  summary: "Long-poll until work is available",
  description:
    "Returns `200` the instant pending work exists or arrives, and `204` with no body when the " +
    `window expires (default and maximum ${MAX_IDLE_TIMEOUT_SECONDS} s) so the skill loop re-invokes ` +
    "it. Both outcomes are normal; `204` is not an error. **Idle reports availability and never " +
    "claims** — follow a `200` with `POST /api/queue/claim-all`. While the queue is halted, idle " +
    "parks for the full window and never returns events (SPEC.md §7).",
  request: { query: IdleQuerySchema },
  responses: {
    200: jsonContent(IdleResultSchema, "Pending events exist; claim them next."),
    204: { description: "The window expired with nothing pending. Re-invoke to park again." },
    400: VALIDATION_RESPONSE,
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

export const reapStale = createRoute({
  method: "post",
  path: "/api/queue/reap-stale",
  tags: ["queue"],
  summary: "Recover stuck in-progress events",
  description:
    "Moves events left in `in-progress/` by a crashed run back to `pending/`, so a dead agent session " +
    "cannot strand work (SPEC.md §7).",
  request: { headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(ReapStaleResultSchema, "The events returned to `pending/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const haltQueue = createRoute({
  method: "post",
  path: "/api/queue/halt",
  tags: ["queue"],
  summary: "Halt the queue",
  description:
    "Writes the `.corpus/HALT` sentinel. While halted, `claim-all` returns empty and `idle` parks for " +
    "its full window (SPEC.md §7). The console strip's HALT toggle and `corpus queue halt` both land " +
    "here. The body is optional in full: a bare `POST` halts, and a `reason`, when given, is recorded " +
    "in the sentinel beside the halt timestamp. Halting an already-halted queue is not an error — it " +
    "re-records the sentinel, so a second call may replace or add the reason.",
  request: {
    headers: ActorHeaderSchema,
    body: {
      required: false,
      description: "Optional halt annotation; omit the body entirely to halt without a reason.",
      content: { "application/json": { schema: HaltQueueRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(QueueStatusSchema, "The queue status, now halted."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const resumeQueue = createRoute({
  method: "post",
  path: "/api/queue/resume",
  tags: ["queue"],
  summary: "Resume the queue",
  description: "Removes the `.corpus/HALT` sentinel; parked `idle` calls become live again.",
  request: { headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(QueueStatusSchema, "The queue status, no longer halted."),
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
    body: {
      required: false,
      description: "Optional failure annotation; omit the body entirely to fail without a reason.",
      content: { "application/json": { schema: FailEventRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `failed/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});

export const abandonEvent = createRoute({
  method: "delete",
  path: "/api/queue/{id}",
  tags: ["queue"],
  summary: "Abandon an event",
  description:
    "Moves the event to `abandoned/` — the give-up terminal state, distinct from `failed/` which a " +
    "retry can pick up again (SPEC.md §7). The event file is kept; nothing is deleted.",
  request: { params: EventIdParamSchema, headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(QueueEventSchema, "The event, now in `abandoned/`."),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
