import { z } from "@hono/zod-openapi";
import { ActorSchema } from "./actor.js";
import { TextQuoteSelectorSchema } from "./anchor.js";
import { AttachmentFilesSchema } from "./attachment.js";
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
const requestsAgentDescription = (whenOmitted: string) =>
  "Enqueue signal for the agent (SPEC.md §8), independent of who authored the turn. " +
  `Omitted: ${whenOmitted} ` +
  "`true`: request the agent. " +
  '`false`: "note only" — suppress the enqueue even when the thread is engaged.';

export const requestsAgentField = (whenOmitted: string) =>
  z.boolean().optional().describe(requestsAgentDescription(whenOmitted));

/**
 * The same tri-state carried by a `multipart/form-data` body, where every part
 * arrives as text. `z.stringbool` keeps `"false"` distinguishable from silence —
 * `z.coerce.boolean()` would collapse it to `true` and destroy the "note only"
 * toggle.
 */
export const requestsAgentFormField = (whenOmitted: string) =>
  z
    .stringbool()
    .optional()
    .openapi({ type: "boolean", description: requestsAgentDescription(whenOmitted) });

export const TURN_APPEND_OMITTED_BEHAVIOUR =
  "the server enqueues when the thread is already `engaged`, and otherwise only on an explicit " +
  "mention or skill invocation.";

export const THREAD_CREATE_OMITTED_BEHAVIOUR =
  "the server enqueues only when the body carries an explicit `@agent` mention, a targeted " +
  "`@<subagent>` mention or a `/<skill>` invocation.";

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
    requestsAgent: requestsAgentField(THREAD_CREATE_OMITTED_BEHAVIOUR),
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
    requestsAgent: requestsAgentField(TURN_APPEND_OMITTED_BEHAVIOUR),
  })
  .openapi("AppendTurnRequest");

/**
 * The attachment form of the same request (SPEC.md §6). A turn may be
 * attachment-only, so `text` is optional — but a request carrying neither text
 * nor files is nothing at all and is rejected as a validation error.
 */
export const MultipartAppendTurnRequestSchema = z
  .object({
    text: z
      .string()
      .min(1)
      .optional()
      .describe("Markdown body of the turn. Optional: a turn may be attachment-only."),
    requestsAgent: requestsAgentFormField(TURN_APPEND_OMITTED_BEHAVIOUR),
    files: AttachmentFilesSchema,
  })
  .refine((value) => value.text !== undefined || value.files.length > 0, {
    message: "A turn needs `text`, at least one file, or both.",
    path: ["text"],
  })
  .openapi("MultipartAppendTurnRequest");

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

/**
 * Read state (SPEC.md §7). Marks live server-side in `.corpus/seen.json` and are
 * broadcast over SSE, so unread badges clear everywhere at once rather than only
 * in the tab that did the reading.
 */
export const MarkSeenRequestSchema = z
  .object({
    lastSeenTs: IsoDateTimeSchema.optional().describe(
      "Turn timestamp to mark seen up to. Defaults to the thread's last turn, which is what " +
        "opening a thread means; pass it explicitly only to record a partial read.",
    ),
  })
  .openapi("MarkSeenRequest");

export const MarkSeenResultSchema = z
  .object({
    threadId: ThreadIdSchema,
    lastSeenTs: IsoDateTimeSchema.describe("The mark now recorded for this thread."),
    unread: z
      .literal(false)
      .describe("Always false: the mark is at or beyond the last turn the caller has seen."),
  })
  .openapi("MarkSeenResult");

/**
 * Turn deletion is user-only (SPEC.md §6) and cascades: deleting a thread's last
 * turn deletes the thread, and deleting a thread removes its anchor entry from
 * the parent's frontmatter. The response names every consequence so the client
 * knows which caches to drop.
 */
export const DeleteTurnResultSchema = z
  .object({
    deletedTurn: z.literal(true),
    deletedThread: z
      .boolean()
      .describe("True when the deleted turn was the thread's last, taking the thread with it."),
    removedAnchor: AnchorIdSchema.nullable().describe(
      "Anchor entry removed from the parent's frontmatter, when the cascade reached that far.",
    ),
    parentId: DocumentIdSchema.nullable().describe(
      "The thread's parent, whose frontmatter and anchor list may now differ. Null for a " +
        "standalone thread.",
    ),
  })
  .openapi("DeleteTurnResult");

export type ThreadAgent = z.infer<typeof ThreadAgentSchema>;
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;
export type CreateThreadResponse = z.infer<typeof CreateThreadResponseSchema>;
export type AppendTurnRequest = z.infer<typeof AppendTurnRequestSchema>;
export type MultipartAppendTurnRequest = z.infer<typeof MultipartAppendTurnRequestSchema>;
export type AppendTurnResponse = z.infer<typeof AppendTurnResponseSchema>;
export type MarkSeenRequest = z.infer<typeof MarkSeenRequestSchema>;
export type MarkSeenResult = z.infer<typeof MarkSeenResultSchema>;
export type DeleteTurnResult = z.infer<typeof DeleteTurnResultSchema>;
