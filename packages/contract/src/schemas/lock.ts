import { z } from "@hono/zod-openapi";
import { ActorSchema } from "./actor.js";
import { DocumentIdSchema } from "./id.js";
import { IsoDateTimeSchema } from "./time.js";

/**
 * A per-document edit lock, file-backed at `.corpus/locks/<docId>.json`
 * (SPEC.md §7). One holder at a time; document write paths refuse edits from the
 * other party and identify the holder through the `423 Locked` response.
 */
export const LockSchema = z
  .object({
    docId: DocumentIdSchema,
    holder: ActorSchema,
    acquired: IsoDateTimeSchema,
    ttl: z
      .number()
      .int()
      .min(1)
      .describe("Seconds from `acquired` after which `lock reap` may clear it."),
  })
  .openapi("Lock");

export type Lock = z.infer<typeof LockSchema>;
