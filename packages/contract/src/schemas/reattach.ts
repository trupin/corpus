import { z } from "@hono/zod-openapi";
import { BodyRangeSchema } from "./anchor.js";
import { ResolvedAnchorSchema } from "./doc.js";
import { ThreadSummarySchema } from "./thread.js";
import { warningsField } from "./warning.js";

/**
 * Re-attaching a thread to a range **a person chose** (SPEC.md §6; SERVER-059).
 *
 * ## Why this shape, and not a candidate index
 *
 * SERVER-059 established, as a construction rather than as a measurement, that
 * no reader-side similarity measure can decide where an orphaned comment
 * belongs: deleting a line from a parallel list, and renaming that line while
 * deleting its sibling, produce the **same** after-state from the same
 * before-state and demand opposite correct answers. A reader sees only the
 * after-state, so the evidence that would separate the two does not exist at
 * read time. It is trivial for the person who wrote the comment.
 *
 * Everything below follows from that:
 *
 * - **The request carries the range, never a candidate index or a score.** If
 *   it named a candidate, the server would have to regenerate the same
 *   candidate list the UI showed and count into it — and the moment the two
 *   lists differ, index *n* silently means a different passage. That is exactly
 *   the misattachment this whole phase exists to prevent, re-introduced through
 *   the door built to fix it. A range denotes its own meaning.
 * - **The server recomputes the selector from the document's bytes**, the rule
 *   SERVER-071 set for creation. Nothing the caller sends is stored.
 * - **The caller's range is guarded, not trusted.** See `expectedText` below.
 */
const RANGE_DESCRIPTION =
  "The range of the parent document's **current** body the thread should attach to, in the same " +
  "coordinate space `ResolvedAnchor.range` reports — offsets into `Doc.body` (the markdown " +
  "without the frontmatter block), measured in UTF-16 code units, `[start, end)`. Must be " +
  "non-empty: an anchor quotes text.";

/**
 * The guard that makes a raw offset pair safe to act on.
 *
 * A range is a coordinate into a document that is **live** — the agent may have
 * saved it between the person seeing the candidate sites and choosing one, and
 * offsets computed against yesterday's bytes designate today's bytes silently
 * and wrongly. So the request also says what the caller believes is *at* that
 * range, and the server refuses (`409`, `range-changed`) when the parent's
 * bytes disagree.
 *
 * **It is a guard, never the stored selector** — precisely the role
 * `prefix`/`suffix` play on `POST /api/threads` (SERVER-071): consulted to
 * establish which passage is meant, then discarded. What is written into the
 * parent's frontmatter is read off the parent's own bytes.
 *
 * **Why not a document revision instead.** A whole-document version token would
 * refuse a repair because an unrelated paragraph moved, which on a corpus an
 * agent is actively editing means the person's correction fails for no reason
 * they can see. The guard is scoped to exactly the text the decision was about,
 * so it refuses when — and only when — that text changed.
 *
 * **The residual, stated rather than hidden.** An edit that shifts the range and
 * leaves byte-identical text at the new offsets passes the guard. The thread
 * then attaches to text the person chose, character for character, which is the
 * outcome they asked for; it is the one case the guard cannot distinguish and
 * the one case where not distinguishing it is harmless.
 */
const EXPECTED_TEXT_DESCRIPTION =
  "The bytes the caller believes the range currently holds — a **guard, not the stored " +
  "selector**. The server compares it against the parent's live body and refuses with `409` " +
  "(`range-changed`) if they differ, because a document edited between the person seeing the " +
  "range and choosing it would otherwise re-attach the thread to whatever slid into those " +
  "offsets. Its length must equal `end - start`, which is checked at validation time. Never " +
  "written: the selector is read off the document's own bytes (SERVER-071).";

/**
 * Strict, like every request body (CONTRACT-017). The two fields are
 * deliberately redundant, and the redundancy is checked here rather than at the
 * server: a body whose `expectedText` is not `end - start` long is incoherent
 * about its own intent, and `400` naming the field is a better answer than a
 * state check that would attribute the caller's arithmetic bug to the document.
 */
export const ReattachThreadRequestSchema = z
  .strictObject({
    range: BodyRangeSchema.describe(RANGE_DESCRIPTION),
    expectedText: z.string().min(1).describe(EXPECTED_TEXT_DESCRIPTION),
  })
  .refine(({ range }) => range.end > range.start, {
    message: "`range.end` must be greater than `range.start`; an anchor cannot quote nothing",
    path: ["range", "end"],
  })
  .refine(({ range, expectedText }) => expectedText.length === range.end - range.start, {
    message:
      "`expectedText` must be exactly `range.end - range.start` characters long — the two " +
      "describe the same passage",
    path: ["expectedText"],
  })
  .openapi("ReattachThreadRequest");

/**
 * Why a well-formed re-attach was refused by the document's state. Machine
 * readable, because the three refusals want three different things from the
 * person — re-read and pick again, pick somewhere else, or nothing at all — and
 * a UI that had to match on prose would get it wrong the first time the prose
 * was improved.
 */
export const REATTACH_REFUSAL_REASONS = [
  "range-changed",
  "range-overlaps",
  "not-anchored",
] as const;

export const ReattachRefusalReasonSchema = z.enum(REATTACH_REFUSAL_REASONS).openapi({
  description:
    "Which state refused the request: the status code says a state did, this says which. " +
    "`range-changed`: the parent's body no longer holds `expectedText` at that range — it was " +
    "edited between the person seeing the range and choosing it (a range running past the end of " +
    "the body is the same fact, reported the same way). Re-read the document and choose again. " +
    "`range-overlaps`: the range overlaps text another thread's anchor already resolves over, " +
    "and SPEC.md §6 forbids two threads on disjoint text ending up claiming overlapping text; " +
    "choose a range that does not. `not-anchored`: the thread has no anchor to repair — it is " +
    "standalone or a whole-document comment — and giving one an anchor is a change of scope " +
    "rather than a repair, which this route does not perform.",
});

/**
 * The `409` body of `POST /api/threads/{id}/reattach`.
 *
 * A **narrowing** of `ConflictError`, exactly as `LockConflictError` is: it adds
 * a field to `{code, message}` rather than adding a member to `ERROR_CODES`, so
 * it still parses as an `ApiError` and no consumer that switches on `code` has
 * to grow a branch. The status carries "the state
 * refused this"; `reason` carries which state.
 *
 * `409` rather than `400` on all three: the body is well formed and re-sending
 * it cannot help — the caller has to go back and look at the document again, or
 * has asked for something this route never does. The repo's existing `409`s
 * (a taken skill name, deferring unclaimed work, re-answering an answered form)
 * are the same shape of refusal.
 */
export const ReattachConflictErrorSchema = z
  .object({
    code: z.literal("conflict"),
    message: z.string(),
    reason: ReattachRefusalReasonSchema,
  })
  .openapi("ReattachConflictError");

/**
 * What a successful repair answers with.
 *
 * `anchor` is the ordinary `ResolvedAnchor` the document read already publishes,
 * and carrying it here is the caller's **proof that nothing was guessed**: on a
 * `200` its `orphaned` is `false` and its `range` is byte-for-byte the range the
 * request named, so a client can assert the thread landed where the person
 * pointed rather than re-fetching the document and hoping. Its `selector` is the
 * one the server computed off the document's bytes — not the one the caller
 * sent, because the caller sent none.
 *
 * `warnings` because re-attaching rewrites the parent's frontmatter and
 * auto-commits it, so §11's commit warnings apply exactly as they do to
 * `resolve` and `reopen`. `thread` mirrors `ThreadMutationResponse`'s summary so
 * a board row can be updated from the same response.
 */
export const ReattachThreadResponseSchema = z
  .object({
    thread: ThreadSummarySchema,
    anchor: ResolvedAnchorSchema,
    warnings: warningsField,
  })
  .openapi("ReattachThreadResponse");

export type ReattachThreadRequest = z.infer<typeof ReattachThreadRequestSchema>;
export type ReattachRefusalReason = z.infer<typeof ReattachRefusalReasonSchema>;
export type ReattachConflictError = z.infer<typeof ReattachConflictErrorSchema>;
export type ReattachThreadResponse = z.infer<typeof ReattachThreadResponseSchema>;
