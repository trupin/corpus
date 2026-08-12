import { z } from "@hono/zod-openapi";
import { DocSchema } from "./doc.js";

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
  "stale_key",
  "internal_error",
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
 * (no valid token), or `409` (the right party, and the request is well formed,
 * but the state refuses it). Deletion is user-only (SPEC.md §7 — "the agent
 * archives, never deletes"), so an `x-corpus-author: agent` deletion lands here.
 */
export const ForbiddenErrorSchema = z
  .object({ code: z.literal("forbidden"), message: z.string() })
  .openapi("ForbiddenError");

export const NotFoundErrorSchema = z
  .object({ code: z.literal("not_found"), message: z.string() })
  .openapi("NotFoundError");

/**
 * The request conflicts with state that already exists: a taken skill name,
 * deferring unclaimed work, re-answering an answered form, a re-attach whose
 * range moved. `409` rather than `400` on all of them — the body is well formed
 * and re-sending it cannot help, so a `400` would send the caller in circles.
 *
 * A **stale key** is a `409` too, and gets a code of its own rather than joining
 * this one ({@link StaleKeyErrorSchema}).
 */
export const ConflictErrorSchema = z
  .object({
    code: z.literal("conflict"),
    message: z.string(),
  })
  .openapi("ConflictError");

/**
 * SPEC.md §7's refusal: **the key you presented names a version this document no
 * longer is.**
 *
 * ## Why a code of its own, and not `conflict`
 *
 * `409` already carries `ReattachConflictError`, and two different refusals on
 * one status must stay tellable apart at the place clients actually branch — the
 * `code`. Overloading `conflict` would have meant either a second shape behind
 * one discriminator (which a discriminated union cannot express, so
 * `isApiError` would silently pick one) or a `reason` field that every consumer
 * must remember to check before reading a document that may not be there.
 * `stale_key` costs the union nothing: it takes the seat `locked` vacated when
 * the lock mechanism was removed, so `ERROR_CODES` still has seven members and
 * every `switch` over them is still exhaustive.
 *
 * ## Why it carries a whole document
 *
 * SHARED-041 decision 5: **one round trip, not two.** A refusal is where a
 * writer discovers its picture is out of date, and the only useful next step is
 * to look at what the document now says — so the refusal brings it, rather than
 * telling the caller to go and ask. It makes an error response the largest body
 * this API produces, which is deliberate and is the one thing about it worth
 * knowing: an error path that assumed errors were small would truncate exactly
 * the payload that makes the refusal actionable.
 *
 * ## Why the fresh key is not a field here
 *
 * It is `doc.key` — the same field every read publishes, on the document it
 * describes. A sibling `key` beside `doc` would be a second copy that could
 * disagree with the first, and there is no reading under which the two should
 * differ. So the recovery is exactly the ordinary flow: read the key off the
 * document you were handed, merge, and write again.
 */
export const StaleKeyErrorSchema = z
  .object({
    code: z.literal("stale_key"),
    message: z.string(),
    doc: DocSchema.describe(
      "The document **as it now stands** — the whole of it, not a summary — carrying a fresh " +
        "`key` in the field every read carries it in. Nothing was written: this is what you would " +
        "have overwritten, and the content you tried to save is still yours to resend. Reconcile " +
        "against this and write again presenting its `key`.",
    ),
  })
  .openapi("StaleKeyError");

/**
 * The catch-all body for an unexpected `500` — a bug, not a modelled outcome.
 *
 * Deliberately asymmetric with every other variant: the code exists so that a
 * server's last-resort error handler can emit a body that type-checks as an
 * `ApiError` instead of mislabelling a crash as `bad_request` or `conflict`,
 * but **no route declares a `500` response**. That asymmetry is the invariant.
 * A documented `500` would read as a contract promise that the call can fail
 * that way by design, which is exactly what an unexpected failure is not; the
 * response therefore stays undeclared, and `500` is never a shape a client
 * should branch on beyond "the server broke".
 *
 * Carries no structured detail on purpose — an unexpected failure has nothing
 * trustworthy to say about itself, and internals do not belong on the wire.
 */
export const InternalErrorSchema = z
  .object({ code: z.literal("internal_error"), message: z.string() })
  .openapi("InternalError", {
    description:
      "Catch-all body for an unexpected server failure. Intentionally not declared as a response by any route: the code exists so an unhandled failure can be serialised as an ApiError rather than mislabelled, while a documented 500 would wrongly present a crash as a designed outcome.",
  });

export const ApiErrorSchema = z
  .discriminatedUnion("code", [
    ValidationErrorSchema,
    UnauthorizedErrorSchema,
    ForbiddenErrorSchema,
    NotFoundErrorSchema,
    ConflictErrorSchema,
    StaleKeyErrorSchema,
    InternalErrorSchema,
  ])
  .openapi("ApiError");

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type UnauthorizedError = z.infer<typeof UnauthorizedErrorSchema>;
export type ForbiddenError = z.infer<typeof ForbiddenErrorSchema>;
export type NotFoundError = z.infer<typeof NotFoundErrorSchema>;
export type ConflictError = z.infer<typeof ConflictErrorSchema>;
export type StaleKeyError = z.infer<typeof StaleKeyErrorSchema>;
export type InternalError = z.infer<typeof InternalErrorSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Narrows an unknown value (a caught rejection, a raw response body) to the
 * problem shape.
 *
 * **It classifies a `stale_key` refusal like any other**, and that is worth
 * stating because the variant is unlike its siblings in size: it carries a whole
 * document, so this parses one. Nothing here caps, truncates or samples the
 * value — an error path that treats errors as small would reject the one
 * refusal whose body is the point of the response.
 */
export function isApiError(value: unknown): value is ApiError {
  return ApiErrorSchema.safeParse(value).success;
}
