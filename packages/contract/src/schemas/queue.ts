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
      .describe(
        "Type-specific payload; plugins own the shape of their own event types, which is why this " +
          "stays open rather than becoming a union keyed on `type` (SPEC.md §7). The core payloads " +
          "are declared beside their features: `form.respond` carries " +
          "`{threadId, formTs, option, note}` (SPEC.md §6).",
      ),
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
 * agent skill's ~8 minute rearm, and the same value bounds the ask: a longer
 * timeout is rejected with a 400 validation error rather than silently clamped,
 * so a client cannot park past the window the loop is built around (SPEC.md §7).
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
        `Seconds to hold the request open, 1–${MAX_IDLE_TIMEOUT_SECONDS} (${MAX_IDLE_TIMEOUT_SECONDS} ` +
        "is also the default; a longer ask is rejected with a 400 validation error, not clamped). " +
        "Parking costs the agent zero tokens: it is blocked on a response, not looping.",
    }),
});

/**
 * Both halves of a reap. The server already computes them — an event whose
 * recovery attempts have run out is *given up on* rather than returned to
 * `pending/` — and reporting only the recovered half left the CLI unable to say
 * that anything had been abandoned, which is the one outcome an operator running
 * `corpus queue reap-stale` needs to hear about.
 */
export const ReapStaleResultSchema = z
  .object({
    reaped: z
      .array(EventIdSchema)
      .describe("Events recovered from `in-progress/` back to `pending/` after a crashed run."),
    failed: z
      .array(EventIdSchema)
      .describe(
        "Events the reap gave up on rather than recovering, having exhausted their attempts. They " +
          "are **not** in `reaped`: the two arrays are disjoint, and an empty one is the normal case.",
      ),
  })
  .openapi("ReapStaleResult");

/**
 * Body of `POST /api/queue/halt`, and optional in both directions: the whole
 * body may be omitted (halting is a kill switch first — `corpus queue halt`
 * with no argument must stay a bare POST), and when it is sent the reason is
 * still optional. A supplied reason is recorded beside the timestamp in the
 * `.corpus/HALT` sentinel, so whoever finds the queue stopped can see why.
 */
export const HaltQueueRequestSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .optional()
      .describe("Human-readable halt reason, recorded in the `.corpus/HALT` sentinel."),
  })
  .openapi("HaltQueueRequest");

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
export type HaltQueueRequest = z.infer<typeof HaltQueueRequestSchema>;
