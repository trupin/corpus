import { z } from "@hono/zod-openapi";
import { AttachmentFilesSchema } from "./attachment.js";
import { DocIdSchema, EventIdSchema, ThreadIdSchema } from "./id.js";
import { requestsAgentFormField } from "./thread.js";
import { warningsField } from "./warning.js";
import { requestedWeightField } from "./weight.js";

/**
 * Capture is the composer's "this should live on as a document" action (SPEC.md
 * §11): one call creates the inbox document, the whole-document filing thread
 * that asks the agent to retitle/move/expand/tag it, and the event that wakes
 * the agent. It is a thin composition of primitives that already exist — no new
 * machinery — and exists as one endpoint only so the board can show the new
 * document with its pending-agent indicator without a three-call round trip.
 */
export const CaptureRequestSchema = z
  .strictObject({
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
  })
  .openapi("CaptureRequest");

export const CaptureResultSchema = z
  .object({
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
    // composition reports what its parts would have (SPEC.md §14).
    warnings: warningsField,
  })
  .openapi("CaptureResult");

export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;
export type CaptureResult = z.infer<typeof CaptureResultSchema>;
