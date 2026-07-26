import { z } from "@hono/zod-openapi";
import { EventIdSchema } from "./id.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * Event types the product itself handles (SPEC.md §7). The wire type stays an
 * open string because plugins define their own event types; consumers that only
 * handle core types narrow with {@link CoreQueueEventTypeSchema}.
 */
export const CORE_QUEUE_EVENT_TYPES = ["comment.created", "form.respond", "agent.done"] as const;

export const CoreQueueEventTypeSchema = z.enum(CORE_QUEUE_EVENT_TYPES);

export const QUEUE_EVENT_STATUSES = [
  "pending",
  "in-progress",
  "processed",
  "failed",
  "abandoned",
] as const;

export const QueueEventStatusSchema = z.enum(QUEUE_EVENT_STATUSES).openapi({
  description: "Mirrors the `.corpus/queue/<status>/` directory the event file currently lives in.",
});

/** One event file in `.corpus/queue/<status>/<id>.json`, written and moved only by the server. */
export const QueueEventSchema = z
  .object({
    id: EventIdSchema,
    type: z
      .string()
      .min(1)
      .describe(
        `Event type. Core values: ${CORE_QUEUE_EVENT_TYPES.join(", ")}. Plugins define their own.`,
      ),
    created: IsoDateTimeSchema,
    source: z.string().min(1).describe("What produced the event, e.g. `ui` or `cli`."),
    payload: z
      .record(z.string(), z.unknown())
      .describe("Type-specific payload; plugins own the shape of their own event types."),
  })
  .openapi("QueueEvent");

/** Result of an atomic batch claim: every `pending/*` event moved to `in-progress/`. */
export const ClaimBatchSchema = z
  .object({ events: z.array(QueueEventSchema) })
  .openapi("ClaimBatch");

export const QueueStatusSchema = z
  .object({
    halted: z
      .boolean()
      .describe("True while the `.corpus/HALT` sentinel exists; claims return empty."),
    pending: z.number().int().min(0),
    inProgress: z.number().int().min(0),
    processed: z.number().int().min(0),
    failed: z.number().int().min(0),
    abandoned: z.number().int().min(0),
  })
  .openapi("QueueStatus");

/**
 * Events available to claim right now, returned by the long-poll idle endpoint.
 * Structurally identical to {@link ClaimBatchSchema} but a distinct resource:
 * idle *reports* availability and never claims (SPEC.md §7).
 */
export const IdleResultSchema = z
  .object({
    events: z
      .array(QueueEventSchema)
      .min(1)
      .describe(
        "Pending events, still in `pending/`. Claim them with `POST /api/queue/claim-all`.",
      ),
  })
  .openapi("IdleResult");

/**
 * Long-poll window (CLAUDE.md Architecture Decision 4). The default matches the
 * agent skill's ~8 minute rearm; the server clamps anything longer so a client
 * cannot park past the window the loop is built around.
 */
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 480;
export const MAX_IDLE_TIMEOUT_SECONDS = 480;

export const IdleQuerySchema = z.object({
  timeout: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_IDLE_TIMEOUT_SECONDS)
    .default(DEFAULT_IDLE_TIMEOUT_SECONDS)
    .openapi({
      param: { name: "timeout", in: "query", required: false },
      type: "integer",
      minimum: 1,
      maximum: MAX_IDLE_TIMEOUT_SECONDS,
      default: DEFAULT_IDLE_TIMEOUT_SECONDS,
      description:
        `Seconds to hold the request open, 1–${MAX_IDLE_TIMEOUT_SECONDS} (the server clamps ` +
        "anything longer). Parking costs the agent zero tokens: it is blocked on a response, not " +
        "looping.",
    }),
});

export const ReapStaleResultSchema = z
  .object({
    reaped: z
      .array(EventIdSchema)
      .describe("Events recovered from `in-progress/` back to `pending/` after a crashed run."),
  })
  .openapi("ReapStaleResult");

export const FailEventRequestSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .optional()
      .describe("Human-readable failure reason, shown in the console."),
  })
  .openapi("FailEventRequest");

export type CoreQueueEventType = z.infer<typeof CoreQueueEventTypeSchema>;
export type IdleResult = z.infer<typeof IdleResultSchema>;
export type IdleQuery = z.infer<typeof IdleQuerySchema>;
export type ReapStaleResult = z.infer<typeof ReapStaleResultSchema>;
export type QueueEventStatus = z.infer<typeof QueueEventStatusSchema>;
export type QueueEvent = z.infer<typeof QueueEventSchema>;
export type ClaimBatch = z.infer<typeof ClaimBatchSchema>;
export type QueueStatus = z.infer<typeof QueueStatusSchema>;
export type FailEventRequest = z.infer<typeof FailEventRequestSchema>;
