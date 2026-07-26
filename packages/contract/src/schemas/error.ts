import { z } from "@hono/zod-openapi";
import { LockSchema } from "./lock.js";

/**
 * The uniform problem shape every error response uses (SPEC.md §2.3). Flat and
 * discriminated on `code` so a client can narrow with a single check, and so the
 * CLI can render server errors without a per-route mapping table.
 */
export const ERROR_CODES = ["bad_request", "unauthorized", "not_found", "locked"] as const;

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

export const NotFoundErrorSchema = z
  .object({ code: z.literal("not_found"), message: z.string() })
  .openapi("NotFoundError");

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
    NotFoundErrorSchema,
    LockedErrorSchema,
  ])
  .openapi("ApiError");

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type UnauthorizedError = z.infer<typeof UnauthorizedErrorSchema>;
export type NotFoundError = z.infer<typeof NotFoundErrorSchema>;
export type LockedError = z.infer<typeof LockedErrorSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Narrows an unknown value (a caught rejection, a raw response body) to the problem shape. */
export function isApiError(value: unknown): value is ApiError {
  return ApiErrorSchema.safeParse(value).success;
}
