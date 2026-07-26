import { z } from "@hono/zod-openapi";
import { LockSchema } from "./lock.js";

/**
 * The uniform problem shape every error response uses (SPEC.md §2.3). Flat and
 * discriminated on `code` so a client can narrow with a single check, and so the
 * CLI can render server errors without a per-route mapping table.
 */
export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "locked",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ValidationIssueSchema = z
  .object({
    path: z.string().describe("Dotted path to the offending field, e.g. `body.title`."),
    message: z.string(),
  })
  .openapi("ValidationIssue");

export const ValidationErrorSchema = z
  .object({
    code: z.literal("bad_request"),
    message: z.string(),
    issues: z.array(ValidationIssueSchema),
  })
  .openapi("ValidationError");

export const UnauthorizedErrorSchema = z
  .object({ code: z.literal("unauthorized"), message: z.string() })
  .openapi("UnauthorizedError");

/**
 * The acting party is not allowed to make this call at all — as opposed to `401`
 * (no valid token) or `423` (right party, wrong moment). Deletion is user-only
 * (SPEC.md §7 — "the agent archives, never deletes"), so an `x-corpus-author:
 * agent` deletion lands here.
 */
export const ForbiddenErrorSchema = z
  .object({ code: z.literal("forbidden"), message: z.string() })
  .openapi("ForbiddenError");

export const NotFoundErrorSchema = z
  .object({ code: z.literal("not_found"), message: z.string() })
  .openapi("NotFoundError");

/**
 * The request conflicts with state that already exists — distinct from `423`,
 * which refuses an unrelated *write* because a document is locked. Acquiring a
 * lock somebody else holds is the canonical `409`, and it carries that lock.
 */
export const ConflictErrorSchema = z
  .object({
    code: z.literal("conflict"),
    message: z.string(),
    lock: LockSchema.optional().describe(
      "Present when the conflict is a lock acquisition; identifies the existing holder.",
    ),
  })
  .openapi("ConflictError");

/**
 * The `409` shape of the lock-acquire route specifically, where the blocking
 * lock is always known. A narrowing of {@link ConflictErrorSchema}, so it still
 * parses as an `ApiError` — the union stays one variant per code.
 */
export const LockConflictErrorSchema = z
  .object({
    code: z.literal("conflict"),
    message: z.string(),
    lock: LockSchema.describe("The lock already held, and by whom."),
  })
  .openapi("LockConflictError");

export const LockedErrorSchema = z
  .object({
    code: z.literal("locked"),
    message: z.string(),
    lock: LockSchema,
  })
  .openapi("LockedError");

export const ApiErrorSchema = z
  .discriminatedUnion("code", [
    ValidationErrorSchema,
    UnauthorizedErrorSchema,
    ForbiddenErrorSchema,
    NotFoundErrorSchema,
    ConflictErrorSchema,
    LockedErrorSchema,
  ])
  .openapi("ApiError");

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type UnauthorizedError = z.infer<typeof UnauthorizedErrorSchema>;
export type ForbiddenError = z.infer<typeof ForbiddenErrorSchema>;
export type NotFoundError = z.infer<typeof NotFoundErrorSchema>;
export type ConflictError = z.infer<typeof ConflictErrorSchema>;
export type LockConflictError = z.infer<typeof LockConflictErrorSchema>;
export type LockedError = z.infer<typeof LockedErrorSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Narrows an unknown value (a caught rejection, a raw response body) to the problem shape. */
export function isApiError(value: unknown): value is ApiError {
  return ApiErrorSchema.safeParse(value).success;
}
