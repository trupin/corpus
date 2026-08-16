import { z } from "@hono/zod-openapi";
import { ActorSchema } from "./actor.js";
import { residentField } from "./agents.js";
import { TextQuoteSelectorRequestSchema } from "./anchor.js";
import { AttachmentFilesSchema } from "./attachment.js";
import { AnchorIdSchema, DocumentIdSchema, EventIdSchema, ThreadIdSchema } from "./id.js";
import { recipientField } from "./lane.js";
import { IsoDateTimeSchema } from "./time.js";
import { turnModelRequestField, turnModelResponseField } from "./turn-model.js";
import { warningsField } from "./warning.js";
import { jobField } from "./provenance.js";
import { requestedWeightField } from "./weight.js";

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
 *
 * `model` is the one field with no counterpart in the turn's own bytes: it is
 * stored in the thread document's frontmatter, keyed by this `ts`, and surfaces
 * here so the API reads with the locality the file gives up. `./turn-model.ts`
 * carries the decision and what it cost.
 */
export const TurnSchema = z
  .object({
    author: ActorSchema,
    ts: IsoDateTimeSchema,
    body: z.string().describe("Markdown body of the turn, without its `## author · ts` heading."),
    model: turnModelResponseField,
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
    resident: residentField,
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
    resident: residentField,
    created: IsoDateTimeSchema,
    updated: IsoDateTimeSchema,
    turnCount: z.number().int().min(0),
    lastAuthor: ActorSchema,
    lastTs: IsoDateTimeSchema,
  })
  .openapi("ThreadSummary");

/**
 * The response of a thread mutation that changes nothing but the thread itself —
 * `resolve` and `reopen`.
 *
 * **Warnings ride a wrapper, never the resource.** {@link ThreadSummarySchema}
 * is a *resource*: it is every list row of `GET /api/docs?type=thread`, and
 * bolting §14's warnings onto it would put an always-empty array on every row of
 * every listing and make "did this mutation warn?" unanswerable from a read. So
 * the mutation gets its own envelope — `{thread, warnings}`, exactly mirroring
 * `DocMutationResponse`'s `{doc, warnings}` — and the resource stays untouched.
 *
 * Both routes need it for a real reason rather than for symmetry: resolving
 * rewrites the thread file's frontmatter and auto-commits it, so a workspace git
 * hook that rejects the commit leaves the change on disk and uncommitted. The
 * server already computes those warnings and, before this shape existed, could
 * only log them (SPEC.md §14: "surfaces loudly — a warning on the API response").
 */
export const ThreadMutationResponseSchema = z
  .object({ thread: ThreadSummarySchema, warnings: warningsField })
  .openapi("ThreadMutationResponse");

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

/**
 * Strict, like every request body (CONTRACT-017; the policy note is in
 * `./index.ts`). The eval that filed the issue sent `anchor: {quote: …}` where
 * `selector: {exact: …}` was meant and got a `200` with a silently unanchored
 * thread — the typo class strictness turns into a `400` naming the key.
 */
export const CreateThreadRequestSchema = z
  .strictObject({
    job: jobField,
    recipient: recipientField,
    parent: DocumentIdSchema.nullable()
      .optional()
      .describe("Document being commented on. Omitted or null creates a standalone thread."),
    selector: TextQuoteSelectorRequestSchema.nullable()
      .optional()
      .describe(
        "Text-quote selector captured from the user's selection. The server writes the anchor entry " +
          "into the parent's frontmatter and creates the thread file atomically. Omitted or null " +
          "anchors the thread to the whole document, or to nothing when `parent` is null.",
      ),
    title: z.string().min(1).optional().describe("Defaults to the anchor quote or the first turn."),
    body: z.string().min(1).describe("Body of the thread's first turn."),
    requestsAgent: requestsAgentField(THREAD_CREATE_OMITTED_BEHAVIOUR),
    model: turnModelRequestField,
    weight: requestedWeightField,
  })
  .openapi("CreateThreadRequest");

/**
 * The selector, carried through a `multipart/form-data` body where every part
 * arrives as text: a JSON object encoded into one part.
 *
 * The alternative — flattening it into `selector.exact` / `selector.prefix` /
 * `selector.suffix` parts — would invent a second wire spelling of a shape the
 * JSON branch already has, and the two would drift. One encoded part keeps a
 * single definition of what a selector is; the published shape is a string,
 * because that is what is on the wire.
 */
const MultipartSelectorSchema = z
  .preprocess((value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Left as the string it is: the object schema below reports it, rather
      // than this throwing out of a preprocess where no path is attached.
      return value;
    }
  }, TextQuoteSelectorRequestSchema)
  .optional()
  .openapi({
    type: "string",
    description:
      "Text-quote selector as a JSON object encoded into one part, e.g. " +
      '`{"exact":"assume a 30-year fixed at 6.1%","prefix":"the model we "}`. Same fields and same ' +
      "meaning as the JSON body's `selector`. Omit it to anchor the thread to the whole document, " +
      "or to nothing when `parent` is absent.",
  });

/**
 * The attachment form of thread creation (SPEC.md §6, §8) — the composer's *Ask*
 * with a screenshot, and a selection comment that carries a file.
 *
 * Mirrors {@link CaptureRequestSchema}'s multipart shape part for part: `text`
 * for the prose, the same `requestsAgent` string-boolean, and the same repeated
 * `files` part. The first turn may be attachment-only, so `text` is optional —
 * but a request carrying neither text nor files creates a thread with an empty
 * first turn, which is nothing at all, and is rejected.
 */
export const MultipartCreateThreadRequestSchema = z
  .strictObject({
    job: jobField,
    recipient: recipientField,
    parent: DocumentIdSchema.optional().describe(
      "Document being commented on. Omitted creates a standalone thread.",
    ),
    selector: MultipartSelectorSchema,
    title: z.string().min(1).optional().describe("Defaults to the anchor quote or the first turn."),
    text: z
      .string()
      .min(1)
      .optional()
      .describe("Body of the thread's first turn. Optional: a first turn may be attachment-only."),
    requestsAgent: requestsAgentFormField(THREAD_CREATE_OMITTED_BEHAVIOUR),
    model: turnModelRequestField,
    weight: requestedWeightField,
    files: AttachmentFilesSchema,
  })
  .refine((value) => value.text !== undefined || value.files.length > 0, {
    message: "A thread's first turn needs `text`, at least one file, or both.",
    path: ["text"],
  })
  .openapi("MultipartCreateThreadRequest");

/**
 * Every thread mutation carries §14's warnings, exactly as the document
 * mutations do — the same `warningsField`, so there is one definition of what a
 * warning is and one shape it arrives in.
 *
 * Threads need it as sharply as documents: **anchored creation writes the parent
 * document's frontmatter**, so a workspace git hook that rejects the auto-commit
 * leaves the parent's anchors map on disk and uncommitted. Without the field the
 * person who just posted a comment is told nothing at all, and §14's "surfaces
 * loudly — a warning on the API response" would be true of document writes and
 * silently false of thread writes, though both go through one pipeline.
 */
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
    warnings: warningsField,
  })
  .openapi("CreateThreadResponse");

export const AppendTurnRequestSchema = z
  .strictObject({
    job: jobField,
    recipient: recipientField,
    body: z.string().min(1),
    requestsAgent: requestsAgentField(TURN_APPEND_OMITTED_BEHAVIOUR),
    model: turnModelRequestField,
    weight: requestedWeightField,
  })
  .openapi("AppendTurnRequest");

/**
 * The attachment form of the same request (SPEC.md §6). A turn may be
 * attachment-only, so `text` is optional — but a request carrying neither text
 * nor files is nothing at all and is rejected as a validation error.
 */
export const MultipartAppendTurnRequestSchema = z
  .strictObject({
    job: jobField,
    recipient: recipientField,
    text: z
      .string()
      .min(1)
      .optional()
      .describe("Markdown body of the turn. Optional: a turn may be attachment-only."),
    requestsAgent: requestsAgentFormField(TURN_APPEND_OMITTED_BEHAVIOUR),
    model: turnModelRequestField,
    weight: requestedWeightField,
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
    warnings: warningsField,
  })
  .openapi("AppendTurnResponse");

/**
 * Read state (SPEC.md §7). Marks live server-side in `.corpus/seen.json` and are
 * broadcast over SSE, so unread badges clear everywhere at once rather than only
 * in the tab that did the reading.
 */
export const MarkSeenRequestSchema = z
  .strictObject({
    lastSeenTs: IsoDateTimeSchema.optional().describe(
      "Turn timestamp to mark seen up to. Defaults to the thread's last turn, which is what " +
        "opening a thread means; pass it explicitly only to record a partial read.",
    ),
  })
  .openapi("MarkSeenRequest");

/**
 * `unread` is a genuine boolean rather than `literal(false)`, because a mark can
 * legitimately land short of the thread's end: {@link MarkSeenRequestSchema}
 * accepts a `lastSeenTs` before the last turn to record a partial read, and by
 * this contract's own definition of unread — turns after the mark — the thread
 * is then still unread. A literal `false` would have the mutation response
 * assert a cleared badge that the next `GET /api/docs` immediately re-raises, so
 * a client trusting it would flicker. This field reports the state the mark
 * actually leaves behind.
 */
export const MarkSeenResultSchema = z
  .object({
    threadId: ThreadIdSchema,
    lastSeenTs: IsoDateTimeSchema.describe("The mark now recorded for this thread."),
    unread: z
      .boolean()
      .describe(
        "Whether the thread is *still* unread after this mark — that is, whether any turn is newer " +
          "than `lastSeenTs` (SPEC.md §7). False for the ordinary case of a bare `POST`, which marks " +
          "the thread read up to its last turn. **True when `lastSeenTs` names an earlier turn**: a " +
          "partial read leaves later turns unseen, and the badge stays lit. A client updates its " +
          "unread state from this flag, not from the fact that the call succeeded.",
      ),
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
    warnings: warningsField,
  })
  .openapi("DeleteTurnResult");

export type ThreadAgent = z.infer<typeof ThreadAgentSchema>;
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type Thread = z.infer<typeof ThreadSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type ThreadMutationResponse = z.infer<typeof ThreadMutationResponseSchema>;
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;
export type MultipartCreateThreadRequest = z.infer<typeof MultipartCreateThreadRequestSchema>;
export type CreateThreadResponse = z.infer<typeof CreateThreadResponseSchema>;
export type AppendTurnRequest = z.infer<typeof AppendTurnRequestSchema>;
export type MultipartAppendTurnRequest = z.infer<typeof MultipartAppendTurnRequestSchema>;
export type AppendTurnResponse = z.infer<typeof AppendTurnResponseSchema>;
export type MarkSeenRequest = z.infer<typeof MarkSeenRequestSchema>;
export type MarkSeenResult = z.infer<typeof MarkSeenResultSchema>;
export type DeleteTurnResult = z.infer<typeof DeleteTurnResultSchema>;
