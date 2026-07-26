import { z } from "@hono/zod-openapi";
import { ActorSchema } from "./actor.js";
import { TextQuoteSelectorSchema } from "./anchor.js";
import { AnchorIdSchema, DocumentIdSchema, EventIdSchema, ThreadIdSchema } from "./id.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * Whether the agent participates in a thread (SPEC.md §6, §8). `requested` is
 * set by the first agent-requesting turn; `engaged` by the agent's first reply,
 * after which later turns re-trigger it until the thread is resolved.
 */
export const THREAD_AGENT_STATES = ["none", "requested", "engaged"] as const;

export const ThreadAgentSchema = z.enum(THREAD_AGENT_STATES);

export const THREAD_STATUSES = ["open", "resolved"] as const;

export const ThreadStatusSchema = z.enum(THREAD_STATUSES).openapi({
  description:
    "Resolved threads collapse in the document view and stop re-triggering the agent (SPEC.md §8).",
});

/**
 * One turn of a thread. `ts` is the turn's identity — the server guarantees
 * timestamps are unique and monotonic within a thread (SPEC.md §6).
 */
export const TurnSchema = z
  .object({
    author: ActorSchema,
    ts: IsoDateTimeSchema,
    body: z.string().describe("Markdown body of the turn, without its `## author · ts` heading."),
  })
  .openapi("Turn");

export const ThreadSchema = z
  .object({
    id: ThreadIdSchema,
    title: z.string(),
    created: IsoDateTimeSchema,
    updated: IsoDateTimeSchema,
    status: ThreadStatusSchema,
    tags: z.array(z.string()),
    parent: DocumentIdSchema.nullable().describe(
      "The commented document, which may itself be a thread; null for a standalone thread.",
    ),
    anchor: AnchorIdSchema.nullable().describe(
      "Anchor entry in the parent's frontmatter; null for a whole-document or standalone thread.",
    ),
    agent: ThreadAgentSchema,
    turns: z.array(TurnSchema),
  })
  .openapi("Thread");

/** Thread list row — the projection's `threads` columns (SPEC.md §9.1). */
export const ThreadSummarySchema = z
  .object({
    id: ThreadIdSchema,
    title: z.string(),
    status: ThreadStatusSchema,
    parent: DocumentIdSchema.nullable(),
    anchor: AnchorIdSchema.nullable(),
    agent: ThreadAgentSchema,
    created: IsoDateTimeSchema,
    updated: IsoDateTimeSchema,
    turnCount: z.number().int().min(0),
    lastAuthor: ActorSchema,
    lastTs: IsoDateTimeSchema,
  })
  .openapi("ThreadSummary");

/**
 * `requestsAgent` is the *enqueue* signal (SPEC.md §8) — it decides whether a
 * `comment.created` event is written — and is deliberately distinct from
 * authorship, which travels in the `x-corpus-author` header.
 *
 * Tri-state, with **no default**: omitted, `true` and `false` are three
 * different instructions and a default would collapse two of them at parse time.
 * §8's "note only" toggle is exactly the ability to post into an *engaged*
 * thread without re-triggering the agent, which is only expressible if an
 * explicit `false` survives validation distinguishably from silence.
 */
const requestsAgentField = (whenOmitted: string) =>
  z
    .boolean()
    .optional()
    .describe(
      "Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. " +
        `Omitted: ${whenOmitted} ` +
        "`true`: request the agent. " +
        '`false`: "note only" — suppress the enqueue even when the thread is engaged.',
    );

export const CreateThreadRequestSchema = z
  .object({
    parent: DocumentIdSchema.nullable()
      .default(null)
      .describe("Document being commented on; null creates a standalone thread."),
    selector: TextQuoteSelectorSchema.nullable()
      .default(null)
      .describe(
        "Text-quote selector captured from the user's selection. The server writes the anchor entry " +
          "into the parent's frontmatter and creates the thread file atomically. Null anchors the " +
          "thread to the whole document, or to nothing when `parent` is null.",
      ),
    title: z.string().min(1).optional().describe("Defaults to the anchor quote or the first turn."),
    body: z.string().min(1).describe("Body of the thread's first turn."),
    requestsAgent: requestsAgentField(
      "the server enqueues only when the body carries an explicit `@agent` mention, a targeted " +
        "`@<subagent>` mention or a `/<skill>` invocation.",
    ),
  })
  .openapi("CreateThreadRequest");

export const CreateThreadResponseSchema = z
  .object({
    thread: ThreadSchema,
    anchorId: AnchorIdSchema.nullable().describe(
      "Anchor written into the parent, when a selector was given.",
    ),
    eventId: EventIdSchema.nullable().describe(
      "Enqueued `comment.created` event; null when nothing was enqueued. Non-null when " +
        "`requestsAgent` was true, or when it was omitted and the first turn carries a mention or " +
        'skill invocation; always null when `requestsAgent` was explicitly false ("note only").',
    ),
  })
  .openapi("CreateThreadResponse");

export const AppendTurnRequestSchema = z
  .object({
    body: z.string().min(1),
    requestsAgent: requestsAgentField(
      "the server enqueues when the thread is already `engaged`, and otherwise only on an explicit " +
        "mention or skill invocation.",
    ),
  })
  .openapi("AppendTurnRequest");

export const AppendTurnResponseSchema = z
  .object({
    thread: ThreadSummarySchema,
    turn: TurnSchema,
    eventId: EventIdSchema.nullable().describe(
      "Enqueued `comment.created` event; null when nothing was enqueued. Non-null when " +
        "`requestsAgent` was true, or when it was omitted and the thread is already engaged; " +
        'always null when `requestsAgent` was explicitly false ("note only", SPEC.md §8).',
    ),
  })
  .openapi("AppendTurnResponse");

export type ThreadAgent = z.infer<typeof ThreadAgentSchema>;
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;
export type CreateThreadResponse = z.infer<typeof CreateThreadResponseSchema>;
export type AppendTurnRequest = z.infer<typeof AppendTurnRequestSchema>;
export type AppendTurnResponse = z.infer<typeof AppendTurnResponseSchema>;
