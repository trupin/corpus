import { z } from "zod";
import { DocSchema } from "./doc.js";
import { openapi } from "./openapi-metadata.js";

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
  "unknown_job",
  "unknown_recipient",
  "internal_error",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ValidationIssueSchema = openapi(
  z.object({
    path: z.string().describe("Dotted path to the offending field, e.g. `body.title`."),
    message: z.string(),
  }),
  "ValidationIssue",
);

export const ValidationErrorSchema = openapi(
  z.object({
    code: z.literal("bad_request"),
    message: z.string(),
    issues: z.array(ValidationIssueSchema),
  }),
  "ValidationError",
);

export const UnauthorizedErrorSchema = openapi(
  z.object({ code: z.literal("unauthorized"), message: z.string() }),
  "UnauthorizedError",
);

/**
 * The acting party is not allowed to make this call at all — as opposed to `401`
 * (no valid token), or `409` (the right party, and the request is well formed,
 * but the state refuses it). Deletion is user-only (SPEC.md §7 — "the agent
 * archives, never deletes"), so an `x-corpus-author: agent` deletion lands here.
 */
export const ForbiddenErrorSchema = openapi(
  z.object({ code: z.literal("forbidden"), message: z.string() }),
  "ForbiddenError",
);

export const NotFoundErrorSchema = openapi(
  z.object({ code: z.literal("not_found"), message: z.string() }),
  "NotFoundError",
);

/**
 * The request conflicts with state that already exists: a taken skill name,
 * deferring unclaimed work, re-answering an answered form, a re-attach whose
 * range moved. `409` rather than `400` on all of them — the body is well formed
 * and re-sending it cannot help, so a `400` would send the caller in circles.
 *
 * A **stale key** is a `409` too, and gets a code of its own rather than joining
 * this one ({@link StaleKeyErrorSchema}).
 */
export const ConflictErrorSchema = openapi(
  z.object({
    code: z.literal("conflict"),
    message: z.string(),
  }),
  "ConflictError",
);

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
 * `stale_key` cost the union nothing when it landed: it took the seat `locked`
 * vacated when the lock mechanism was removed, so no `switch` over
 * `ERROR_CODES` grew a branch for it. The set has since grown for refusals with
 * no vacant seat — `unknown_job`, then `unknown_recipient` — which is the price
 * of the rule above and is paid deliberately each time.
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
export const StaleKeyErrorSchema = openapi(
  z.object({
    code: z.literal("stale_key"),
    message: z.string(),
    doc: DocSchema.describe(
      "The document **as it now stands** — the whole of it, not a summary — carrying a fresh " +
        "`key` in the field every read carries it in. Nothing was written: this is what you would " +
        "have overwritten, and the content you tried to save is still yours to resend. Reconcile " +
        "against this and write again presenting its `key`.",
    ),
  }),
  "StaleKeyError",
);

/**
 * **This conversation was released, and the work it left is still being done**
 * (CONTRACT-089; SPEC.md §7's rider signed 2026-08-25).
 *
 * ## `conflict` narrowed by a `reason`, not a code of its own
 *
 * This package has settled that question twice — {@link
 * ReattachConflictErrorSchema} and `PatchConflictError` are both `conflict`,
 * told apart by `reason` vocabularies that do not overlap, so *"one `code` never
 * means two things"* survives without minting one per refusal. A third code here
 * would have been the same fact wearing a new name, which is what
 * `unknown_recipient`'s own test forbids.
 *
 * The vocabulary is one word and does not overlap either neighbour's, so a
 * caller that reaches the wrong route's narrowing gets a failed match rather
 * than a plausible wrong answer.
 *
 * ## Why it carries a count
 *
 * The rule `AgentLane.summary` states and this package keeps: **everything a
 * client needs to decide from is a field of its own.** A person told *"try again
 * later"* cannot tell whether later is a second or an hour, and a client that
 * scraped the number out of `message` would be parsing prose the server is free
 * to reword. `PatchConflictError.matches` is the same idea for the same reason.
 *
 * ## Why the refusal exists at all
 *
 * It is the one seam the no-fallback rule leaves. Release hands a lane's pending
 * events to the orchestrator; designating again before those settle would put a
 * listener on the lane while the orchestrator works them, and the turns get
 * answered twice. SHARED-072 rejected abandoning the drain — work already in
 * flight is still an orchestrator's answer in a resident's conversation, so the
 * seam narrows without closing — and rejected keying lanes by `designationId`,
 * which closes it by construction and rewrites what a lane *is* throughout §7.
 *
 * **Transient and self-clearing.** Nothing is reset, nothing expires on a timer,
 * and the condition is a fact about outstanding work rather than a state of the
 * thread: a thread released long ago whose drain completed is not draining.
 */
export const DESIGNATE_REFUSAL_REASONS = ["has-parent", "draining"] as const;

export const DesignateRefusalReasonSchema = z
  .enum(DESIGNATE_REFUSAL_REASONS)
  .describe(
    "Which refusal this is, and they are opposites. **`has-parent`** — the thread is on a " +
      "document, so it may never have a resident (SPEC.md §7: a resident owns a conversation " +
      "rather than a passage). **`draining`** — the thread's released resident left work the " +
      "orchestrator is still doing, so designating now would hand the same turns to two agents; " +
      "it clears by itself in seconds. Branch on this rather than on the status: one can never " +
      "succeed and the other is about to.",
  );

export const DesignateConflictErrorSchema = openapi(
  z.object({
    code: z.literal("conflict"),
    message: z.string(),
    reason: DesignateRefusalReasonSchema,
    outstanding: z
      .number()
      .int()
      .min(0)
      .describe(
        "**How many of the released resident's events the orchestrator is still working.** " +
          "At least one under `draining`, and `0` under `has-parent`, where nothing is " +
          "outstanding and nothing ever will be. A field rather than a number inside `message` " +
          "for the reason this package keeps everywhere — a client must never parse prose to " +
          "decide anything — and it is what tells a person whether waiting means a moment or a " +
          "while.",
      ),
  }),
  "DesignateConflictError",
);

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
export const InternalErrorSchema = openapi(
  z.object({ code: z.literal("internal_error"), message: z.string() }),
  "InternalError",
  {
    description:
      "Catch-all body for an unexpected server failure. Intentionally not declared as a response by any route: the code exists so an unhandled failure can be serialised as an ApiError rather than mislabelled, while a documented 500 would wrongly present a crash as a designed outcome.",
  },
);

/**
 * A `job` that names no work a write can serve (SPEC.md §9.2, CONTRACT-050).
 *
 * A full member of the union rather than a route-local shape, for the reason
 * every other member is one: a client that narrows on `code` must be able to
 * reach it, and a `422` that serialized as something outside `ApiError` would be
 * the one refusal a caller could not handle generically.
 */
export const UnknownJobErrorSchema = openapi(
  z.object({
    code: z.literal("unknown_job"),
    message: z.string(),
    job: z.string().describe("The id that resolved to no event, or to work already settled."),
  }),
  "UnknownJobError",
);

/**
 * **The value you named is not a lane** (SPEC.md §7; CONTRACT-051 introduced it
 * for `recipient`, CONTRACT-058 settled its name once `scope` reached it too).
 *
 * ## Why one code for two parameters
 *
 * The code is spelled `recipient` because a `recipient` is what first produced
 * it, but the fact it reports has never mentioned a parameter: a thread this
 * workspace does not hold, or one that holds no resident and is therefore not a
 * lane at all. Two requests now reach it — the `recipient` of a post, and the
 * `scope` of a queue park (`GET /api/queue/idle`, SERVER-118) — and they are
 * **one refusal with one remedy**: name a lane that exists, or name none.
 *
 * A second code would hand a client two branches for one recovery, which is the
 * mistake the split from `unknown_job` exists to avoid making in the *other*
 * direction: `job` and `recipient` are two codes precisely because their
 * remedies differ (a bad `job` costs the write its provenance, a bad lane costs
 * it its routing, and they are not the same call). Sameness of remedy is the
 * test, and these two pass it.
 *
 * **Renaming it to `unknown_lane` was considered and declined.** `ERROR_CODES`
 * is a published discriminant: the rename would touch the CLI's renderer, the
 * kit's composer recovery, the UI's fixtures and every server test that asserts
 * the code — a breaking change across four domains to correct a name that one
 * sentence of published prose corrects instead. The prose is that sentence, and
 * it is in the component description below rather than only here, because the
 * reader who is confused by the name is the one reading `openapi.json` and not
 * this file. If a breaking window opens for another reason, `unknown_lane` with
 * a `lane` field is the shape to take.
 *
 * ## Why it carries the value
 *
 * The same reason `UnknownJobError` carries `job` — a client that offered a
 * picker needs to know *which* entry went stale so it can drop that row rather
 * than reload the world. The field keeps the `recipient` spelling because the
 * code does; one name for one fact beats two spellings a consumer has to check
 * for.
 */
export const UnknownRecipientErrorSchema = openapi(
  z.object({
    code: z.literal("unknown_recipient"),
    message: z.string(),
    recipient: z
      .string()
      .describe(
        "The value that named no lane — a thread this workspace does not hold, or one that holds " +
          "no resident and is therefore not a lane at all. **Whichever parameter carried it**: " +
          "the `recipient` of a post, or the `scope` of a queue park. The field is spelled " +
          "`recipient` because the code is; which parameter was at fault is the operation you " +
          "called.",
      ),
  }),
  "UnknownRecipientError",
  {
    description:
      "The value you named is not a lane: this workspace holds no such thread, or that thread " +
      "holds no resident and is therefore not a lane at all (SPEC.md §7). **`unknown_recipient` " +
      "is the one code for that fact whatever named it** — the `recipient` of a post, or the " +
      "`scope` of a queue park — because the two are one refusal with one remedy: name a lane " +
      "that exists, or name none. It is spelled for the parameter that first produced it, not " +
      "for the only one that can; a second code would hand a client two branches for one " +
      "recovery. Nothing was written or parked, and `recipient` carries the offending value " +
      "either way.",
  },
);

export const ApiErrorSchema = openapi(
  z.discriminatedUnion("code", [
    ValidationErrorSchema,
    UnauthorizedErrorSchema,
    ForbiddenErrorSchema,
    NotFoundErrorSchema,
    ConflictErrorSchema,
    StaleKeyErrorSchema,
    UnknownJobErrorSchema,
    UnknownRecipientErrorSchema,
    InternalErrorSchema,
  ]),
  "ApiError",
);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type UnauthorizedError = z.infer<typeof UnauthorizedErrorSchema>;
export type ForbiddenError = z.infer<typeof ForbiddenErrorSchema>;
export type NotFoundError = z.infer<typeof NotFoundErrorSchema>;
export type ConflictError = z.infer<typeof ConflictErrorSchema>;
export type StaleKeyError = z.infer<typeof StaleKeyErrorSchema>;
export type UnknownJobError = z.infer<typeof UnknownJobErrorSchema>;
export type UnknownRecipientError = z.infer<typeof UnknownRecipientErrorSchema>;
export type DesignateConflictError = z.infer<typeof DesignateConflictErrorSchema>;
export type DesignateRefusalReason = z.infer<typeof DesignateRefusalReasonSchema>;
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
