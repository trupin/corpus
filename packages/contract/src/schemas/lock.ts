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

/** Default lease for an acquired lock, long enough for a typing session and short enough to reap. */
export const DEFAULT_LOCK_TTL_SECONDS = 300;

export const AcquireLockRequestSchema = z
  .object({
    ttl: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        `Lease in seconds; defaults to ${DEFAULT_LOCK_TTL_SECONDS}. A TTL is what keeps a crashed ` +
          "editor from wedging a document — `POST /api/locks/reap` clears expired leases.",
      ),
  })
  .openapi("AcquireLockRequest");

export const LockListSchema = z.object({ locks: z.array(LockSchema) }).openapi("LockList", {
  description: "Every active lock, for hydrating lock banners on load (SPEC.md §7).",
});

export const ReleaseLockResultSchema = z
  .object({
    docId: DocumentIdSchema,
    released: z.literal(true),
    holder: ActorSchema.describe("The party whose lock this call cleared."),
  })
  .openapi("ReleaseLockResult");

export const LockReapResultSchema = z
  .object({
    reaped: z.array(DocumentIdSchema).describe("Documents whose expired locks were cleared."),
  })
  .openapi("LockReapResult");

export type Lock = z.infer<typeof LockSchema>;
export type AcquireLockRequest = z.infer<typeof AcquireLockRequestSchema>;
export type LockList = z.infer<typeof LockListSchema>;
export type ReleaseLockResult = z.infer<typeof ReleaseLockResultSchema>;
export type LockReapResult = z.infer<typeof LockReapResultSchema>;
