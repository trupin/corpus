import { z } from "@hono/zod-openapi";
import { DocumentIdSchema, EventIdSchema } from "./id.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * Event types the product itself handles (SPEC.md §7). The wire type stays an
 * open string because plugins define their own event types; consumers that only
 * handle core types narrow with {@link CoreQueueEventTypeSchema}.
 *
 * Ordered by producer, with the one type nothing produces yet last:
 * `comment.created` (a turn that requests the agent), `form.respond` (a form
 * answer, §6), `doc.edited` (a user edit session that ended, §4's
 * edit-acknowledgment rider — payload and dedupe rule in `./edit.ts`), and
 * `agent.done`, which §7 marks reserved.
 *
 * **`doc.edited` is a core type rather than a plugin one** because the core loop
 * owns both ends of it: the server emits it, and the shipped orchestrate skill
 * handles it. §7's own "Core event types" sentence predates the rider and does
 * not yet name it — a SPEC amendment is drafted and held for sign-off
 * (CONTRACT-028); this constant is what the shipped surfaces read, and the
 * generated document publishes the whole set wherever an event type appears.
 */
export const CORE_QUEUE_EVENT_TYPES = [
  "comment.created",
  "form.respond",
  "doc.edited",
  "agent.done",
] as const;

export const CoreQueueEventTypeSchema = z.enum(CORE_QUEUE_EVENT_TYPES);

/**
 * The status set SPEC.md §7 pins — `pending → in-progress → processed | failed`,
 * plus `abandoned` — and the one state §7 names as its own successor.
 *
 * **`deferred` is the queue state §7's lock bullet promises** (CONTRACT-021,
 * the wire half of SERVER-030). The interim protocol it retires is written into
 * §7 as a transitional clause: the orchestrator "fails the event with a
 * `deferred:`-prefixed reason, and the work re-enters the queue via `corpus job
 * retry`… A dedicated defer/requeue queue state that re-enters automatically on
 * lock release is planned (SERVER-030); until then the deferral is visible as an
 * actionable failed job, never silently dropped." That sentence is the whole
 * specification of this value, and nothing here goes beyond it:
 *
 * - **Non-terminal, and not `pending`.** A deferred event is waiting for a lock
 *   it has already tried to take, so it is neither finished nor claimable —
 *   `claim-all` must not hand it out, or the agent spins against the same lock.
 * - **Not a failure.** The distinction is the point: today a deferral renders
 *   in the console as a broken job, and §7 asks for *waiting*.
 * - **It leaves on its own.** Release, force-break and reap of the blocking
 *   lock each return the event to `pending`. Which document it waits on is
 *   supplied at defer time (`DeferEventRequest.blockedOn`), because the event
 *   payload does not always carry it: `comment.created` has `parentId`,
 *   `form.respond` has no document at all.
 *
 * Ordered as the lifecycle runs, non-terminal states first: the constant is
 * what the server iterates to create `.corpus/queue/<status>/` and to count
 * queue depth, so the order is read by humans in more places than this file.
 */
export const QUEUE_EVENT_STATUSES = [
  "pending",
  "in-progress",
  "deferred",
  "processed",
  "failed",
  "abandoned",
] as const;

export const QueueEventStatusSchema = z.enum(QUEUE_EVENT_STATUSES).openapi({
  description:
    "Mirrors the `.corpus/queue/<status>/` directory the event file currently lives in. " +
    "`pending` and `in-progress` are the live states; `processed`, `failed` and `abandoned` are " +
    "terminal. **`deferred` is neither** (SPEC.md §7): the event was claimed and could not " +
    "proceed because the user holds the edit lock on the document it needs, so it waits — not " +
    "claimable, not failed — and returns to `pending` automatically when that lock is released, " +
    "broken or reaped.",
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
    deferred: z
      .number()
      .int()
      .min(0)
      .describe(
        "Events waiting on a user-held edit lock (SPEC.md §7). Counted separately from `failed` " +
          "because a deferral is not a failure — a non-zero count here is work that will resume " +
          "by itself, and the console strip must not read it as breakage.",
      ),
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
  .strictObject({
    reason: z
      .string()
      .min(1)
      .optional()
      .describe("Human-readable halt reason, recorded in the `.corpus/HALT` sentinel."),
  })
  .openapi("HaltQueueRequest");

/**
 * Body of `POST /api/queue/{id}/defer` (CONTRACT-021).
 *
 * **`blockedOn` is mandatory, and it is the whole reason this is not a bodiless
 * verb.** §7 asks for a state that "re-enters automatically on lock release",
 * which is only implementable if the deferral says *which* lock — and the event
 * cannot always be asked: `comment.created` carries `parentId` in its payload,
 * `form.respond` carries `{threadId, formTs, option, note}` and names no
 * document. The defer call is made by the party that just tried the edit and
 * knows exactly what it was blocked on, so the document is supplied here rather
 * than inferred from a payload shape that plugins are free to define.
 *
 * `reason` is the deferral's human sentence, and it replaces the `deferred:`
 * prefix the interim protocol smuggled into a failure reason: the status now
 * carries that meaning, so the text is free to say something useful.
 */
export const DeferEventRequestSchema = z
  .strictObject({
    blockedOn: DocumentIdSchema.describe(
      "The document whose edit lock the work is waiting for. Releasing, breaking or reaping that " +
        "lock returns this event to `pending` automatically (SPEC.md §7), so a deferral that " +
        "named the wrong document would wait forever.",
    ),
    reason: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Human-readable deferral note, shown in the console beside the blocking document. No " +
          "`deferred:` prefix is needed or wanted — the status says that now.",
      ),
  })
  .openapi("DeferEventRequest");

export const FailEventRequestSchema = z
  .strictObject({
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
export type DeferEventRequest = z.infer<typeof DeferEventRequestSchema>;
export type FailEventRequest = z.infer<typeof FailEventRequestSchema>;
export type HaltQueueRequest = z.infer<typeof HaltQueueRequestSchema>;
