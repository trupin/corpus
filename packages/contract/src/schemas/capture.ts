import { z } from "zod";
import { AttachmentFilesSchema } from "./attachment.js";
import { DocIdSchema, EventIdSchema, ThreadIdSchema } from "./id.js";
import { requestsAgentFormField } from "./thread.js";
import { warningsField } from "./warning.js";
import { requestedWeightField } from "./weight.js";
import { openapi } from "./openapi-metadata.js";

/**
 * Capture is the composer's "this should live on as a document" action (SPEC.md
 * §10): one call creates the inbox document, the whole-document filing thread
 * that asks the agent to retitle/move/expand/tag it, and the event that wakes
 * the agent. It is a thin composition of primitives that already exist — no new
 * machinery — and exists as one endpoint only so the board can show the new
 * document with its pending-agent indicator without a three-call round trip.
 */
/**
 * **A capture carries no designation, and the reason is §7's, not §10's**
 * (CONTRACT-088, corrected during SERVER-154).
 *
 * SPEC.md §10's rider signed 2026-08-25 says Ask and Capture both offer a new
 * resident, reasoning that a capture's lack of a `recipient` is about *routing*
 * rather than *ownership*. That reasoning is sound and its premise was not
 * checked: **the thread a capture creates is not standalone.** It is the
 * document's filing thread, written with `parent: <docId>` — and §7 allows a
 * designation only on a standalone thread, *"because a thread on a document is
 * about that document, and a resident owns a conversation rather than a
 * passage"*.
 *
 * So the field is absent here rather than declared-and-always-refused. A wire
 * field that can never succeed is worse than none: it tells every reader of the
 * contract that something is possible.
 *
 * Closing the gap needs a decision nobody has made — either the filing thread
 * stops being parented, which changes what a capture *is*, or §10's rider is
 * amended. It is filed as SHARED-073 rather than settled here.
 */
export const CaptureRequestSchema = openapi(
  z.strictObject({
    text: z
      .string()
      .min(1)
      .describe(
        "The captured text. Becomes the inbox document's body and its filing thread's first turn.",
      ),
    requestsAgent: requestsAgentFormField(
      "the server requests the agent — filing is the whole point of a capture — unless the text " +
        "carries its own mention or skill invocation, which routes it instead.",
    ),
    weight: requestedWeightField,
    files: AttachmentFilesSchema,
  }),
  "CaptureRequest",
);

export const CaptureResultSchema = openapi(
  z.object({
    docId: DocIdSchema.describe("The created document, filed in `data/docs/inbox/`."),
    threadId: ThreadIdSchema.describe(
      "The whole-document filing thread created alongside it (no anchor).",
    ),
    eventId: EventIdSchema.nullable().describe(
      "Enqueued `comment.created` event, so the UI can show the pending-agent indicator " +
        "immediately and the console can link the job back to this capture. Null when nothing was " +
        "enqueued, which an explicit `requestsAgent: false` always produces.",
    ),
    // A capture is a document write and a thread write in one call, so it has
    // strictly more ways to warn than either — the same `warningsField`, so the
    // composition reports what its parts would have (SPEC.md §11).
    warnings: warningsField,
  }),
  "CaptureResult",
);

export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;
export type CaptureResult = z.infer<typeof CaptureResultSchema>;
