// Every failure the server can produce, and the one place they become HTTP
// responses.
//
// Sprint-002 Adjudication 2 (binding): error bodies are `application/json`
// carrying the contract's `ApiError` — `{code, message, …}` discriminated on
// `code`. RFC 9457 / `application/problem+json` is deliberately NOT used: the
// contract declares `ApiErrorSchema` on every route's error responses and the
// CLI renders `<status> <code>: <message>` from those two fields.

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { ApiError, Doc, ValidationIssue } from "@corpus/contract";

/**
 * Base class for every deliberate server failure. Startup failures (workspace
 * resolution, config parsing) are `CorpusError`s with no HTTP status — they
 * never reach a request; `HttpError` is the subclass that does.
 */
export class CorpusError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CorpusError";
  }
}

/** A `.corpus/config.json` or workspace-resolution failure. Fatal at boot. */
export class ConfigError extends CorpusError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

export class HttpError extends CorpusError {
  readonly status: ContentfulStatusCode;
  readonly body: ApiError;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: ContentfulStatusCode,
    body: ApiError,
    options?: ErrorOptions & { headers?: Record<string, string> },
  ) {
    super(body.message, options);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.headers = options?.headers ?? {};
  }
}

export function badRequest(message: string, issues: ValidationIssue[] = []): HttpError {
  return new HttpError(400, { code: "bad_request", message, issues });
}

/**
 * An upload past the workspace's size caps, on the three routes that take files.
 *
 * The body is `bad_request`, not an eighth error code: the contract's `413`
 * declares `ValidationError` (CONTRACT-009), because an over-cap upload is a
 * request-shape problem and `{code, message, issues[]}` already carries the
 * field-level detail — which part was too large, and what the cap is. The status
 * is what distinguishes it, which is what status codes are for.
 */
export function payloadTooLarge(message: string, issues: ValidationIssue[] = []): HttpError {
  return new HttpError(413, { code: "bad_request", message, issues });
}

/**
 * `WWW-Authenticate: Bearer` is part of the contract with the CLI: a 401 that
 * does not carry it is indistinguishable from a route that simply refused.
 */
export function unauthorized(message: string): HttpError {
  return new HttpError(
    401,
    { code: "unauthorized", message },
    { headers: { "WWW-Authenticate": "Bearer" } },
  );
}

/**
 * The acting party is not allowed to make this call at all — as opposed to 401,
 * which is no valid credential. Retrying with a token does not help, so no
 * `WWW-Authenticate` challenge is offered.
 */
export function forbidden(message: string): HttpError {
  return new HttpError(403, { code: "forbidden", message });
}

export function notFound(message: string): HttpError {
  return new HttpError(404, { code: "not_found", message });
}

/**
 * The request conflicts with state that already exists — a thread re-attach whose
 * target moved, a create whose id is taken.
 *
 * The sibling case, a write refused because the version it named is no longer
 * the document's, is {@link staleKey} below: SPEC.md §7's refusal is a 409 too,
 * and the two stay tellable apart at the `code` a client branches on rather than
 * at the status.
 */
export function conflict(message: string): HttpError {
  return new HttpError(409, { code: "conflict", message });
}

/**
 * SPEC.md §7's refusal: the key presented names a version this document no
 * longer is.
 *
 * **Never bare.** It carries the document *as it now stands*, whose own `key` is
 * the fresh one — one exchange rather than two, so the writer can see what
 * changed, reconcile and write again. The fresh key is deliberately not a
 * sibling field: it is `doc.key`, the same field every read publishes, because
 * two copies of one value are two things that can disagree.
 *
 * A code of its own rather than `conflict`, because `409` already carries the
 * re-attach conflict and the two must stay tellable apart at the `code` a client
 * branches on (`StaleKeyErrorSchema`).
 */
/**
 * A `job` that names no event this server can serve work for (SPEC.md §9.2,
 * SERVER-110).
 *
 * `422` rather than `400`, and rather than silence. The body is well-formed —
 * `evt_…` is a valid id, it simply resolves to nothing, or to work that is over
 * — so it is not a malformed request; and it is not ignored because a caller
 * that got the id wrong **wanted the attribution**. Dropping it quietly would
 * leave that caller believing its document had been filed into a conversation
 * when it had not, which is the failure provenance exists to prevent. An
 * **omitted** job stays free: forgetting is not the same as naming the wrong
 * thing.
 */
export function unknownJob(job: string, status?: string): HttpError {
  const because =
    status === undefined
      ? "no event has that id"
      : `that event is \`${status}\` — settled work cannot acquire a scope, and a write claiming to serve it is either a stale job id or a loop that never settled its own event`;
  return new HttpError(422, {
    code: "unknown_job",
    message: `the job \`${job}\` names no work this write can serve: ${because}. Nothing was written — retry without \`job\`, or with the id of the event you are actually holding.`,
    job,
  });
}

/**
 * A `recipient` that names no lane (SPEC.md §7, CONTRACT-051).
 *
 * A sibling of {@link unknownJob} and deliberately not the same refusal: a job
 * names *work*, a recipient names *who should do it*, and the remedies differ —
 * retry without the job, versus pick someone else or post where you meant to.
 * Merging them would hand a client one code and two recoveries.
 *
 * Carries the offending value for the reason `unknownJob` carries its id: a
 * composer that offered a roster needs to know which entry went stale so it can
 * drop that row rather than reload everything.
 */
export function unknownRecipient(recipient: string): HttpError {
  return new HttpError(422, {
    code: "unknown_recipient",
    message:
      `\`${recipient}\` names no lane: either this workspace holds no such thread, or that thread ` +
      "holds no resident and is therefore not a lane at all (SPEC.md §7). Nothing was written — " +
      "post without a recipient to reach whoever owns the conversation you are posting in, or " +
      "pick a live agent from the roster.",
    recipient,
  });
}

/**
 * A `scope` that names no lane, on a queue verb that would otherwise park on it
 * (SPEC.md §7, SERVER-118).
 *
 * **The same `422` and the same code as {@link unknownRecipient}, deliberately.**
 * `unknown_recipient` is the contract's name for *"the lane you named does not
 * exist"* — its own published field description reads "the value that named no
 * lane", with no mention of which parameter carried it — and the two refusals
 * have one recovery between them: name a lane that exists, or name none. Minting
 * a second code for the same fact would hand a client two branches for one
 * remedy, which is the mistake `unknownJob` and `unknownRecipient` are kept
 * apart to avoid making in the other direction (they have *different*
 * remedies).
 *
 * The message says what a park is, because that is the fix a caller needs and it
 * is not guessable from the refusal: a lane exists because somebody designated a
 * resident on a standalone thread, so parking on a thread that has none is not a
 * park that will ever be given work — and, before this refusal, it was a park
 * that made the whole workspace report an agent listening when none was.
 */
export function unknownLaneScope(scope: string): HttpError {
  return new HttpError(422, {
    code: "unknown_recipient",
    message:
      `\`${scope}\` names no lane to consume: either this workspace holds no such thread, or that ` +
      "thread holds no resident and is therefore not a lane at all (SPEC.md §7). Nothing was " +
      "parked and no work was claimed — omit `scope` to take the orchestrator's lane, designate a " +
      "resident on that thread first, or pick a lane from `GET /api/agents`.",
    recipient: scope,
  });
}

export function staleKey(message: string, doc: Doc): HttpError {
  return new HttpError(409, { code: "stale_key", message, doc });
}

/**
 * The last-resort body for an unexpected failure. `internal_error` is a full
 * member of the contract's `ApiError` union, so a crash serializes as a contract
 * error instead of being mislabelled `bad_request` — but no route *declares* a
 * 500 response, because a documented 500 would read as a designed outcome. That
 * asymmetry is the contract's invariant, not a gap: this body is typed as the
 * whole `ApiError`, never as some route's inferred response union.
 */
export function internalError(message = "internal error"): HttpError {
  return new HttpError(500, { code: "internal_error", message });
}

/** Flattens a `ZodError` into the contract's `{path, message}` issue list. */
export function toValidationIssues(error: z.ZodError, target?: string): ValidationIssue[] {
  return error.issues.map((issue) => {
    const segments = issue.path.map((segment) => String(segment));
    const path = [target, ...segments]
      .filter((segment) => segment !== undefined && segment !== "")
      .join(".");
    return { path, message: issue.message };
  });
}

/** Writes an `ApiError` body as the response, with any error-specific headers. */
export function errorResponse(c: Context, error: HttpError): Response {
  for (const [name, value] of Object.entries(error.headers)) {
    c.header(name, value);
  }
  // `c.json` sets `content-type: application/json`, which Adjudication 2 pins.
  return c.json(error.body, error.status);
}

/**
 * Hono's own way of refusing a request, re-expressed in the contract's envelope
 * (SERVER-031).
 *
 * The framework throws `HTTPException` from places no route handler can reach:
 * the body validator throws `400 Malformed JSON in request body` when a request
 * declares `content-type: application/json` and its body is empty or not JSON,
 * and `400 Malformed FormData request.` for the multipart equivalent. Both
 * happen **before** `defaultHook` — the validation function never runs on a body
 * that could not be read — so the only shared seam that can see them is this
 * one. Left unrecognised they fell through to {@link internalError}, and an
 * empty `POST` body answered `500 internal_error` on every JSON route in the
 * API: the caller's mistake reported as the server's crash.
 *
 * The status is the framework's; the body is always ours. A custom `res` on the
 * exception is deliberately not honoured — sprint-002 Adjudication 2 pins every
 * error body to `ApiError`, and the CLI renders `<status> <code>: <message>`
 * from it. `5xx` collapses to the generic internal error for the usual reason:
 * a message written for an operator must not travel to a client.
 */
function fromHttpException(error: HTTPException): HttpError {
  if (error.status >= 500) return internalError();
  const message = error.message === "" ? "request refused" : error.message;
  switch (error.status) {
    case 401:
      return unauthorized(message);
    case 403:
      return forbidden(message);
    case 404:
      return notFound(message);
    case 409:
      return conflict(message);
    case 413:
      return payloadTooLarge(message);
    default:
      return new HttpError(error.status, { code: "bad_request", message, issues: [] });
  }
}

/**
 * Maps anything thrown inside a handler or middleware to a response. Unexpected
 * errors never leak their message or stack to the client — the full error,
 * including `cause`, goes to the log instead.
 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  // **Reachable only from a `try`/`catch`, never from a handler that throws.**
  // Zod 4's `ZodError` does not extend `Error`, and Hono routes a non-`Error`
  // throw to neither `app.onError` nor here — the client gets a bare `500` with
  // an empty body and the request never reaches the log. A handler that parses
  // with Zod must therefore catch its own `ZodError` and raise an `HttpError`
  // (`docs/routes.ts`'s `readExtraFilters` is the worked example, and the
  // defect that taught it). This branch stays because the surfaces that *do*
  // call `toHttpError` directly still hand it one.
  if (error instanceof z.ZodError) {
    return badRequest("request failed validation", toValidationIssues(error));
  }
  if (error instanceof HTTPException) return fromHttpException(error);
  return internalError();
}

/**
 * How deep `describeThrown` follows `cause`. A self-referencing or mutually
 * referencing cause chain is legal JavaScript, and an error path that hangs is
 * worse than a truncated one.
 */
export const MAX_CAUSE_DEPTH = 8;

/** Serializes an arbitrary thrown value for the error log, following `cause`. */
export function describeThrown(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };

  const described: Record<string, unknown> = { error: `${error.name}: ${error.message}` };
  if (error.stack !== undefined) described.stack = error.stack;
  if (error.cause !== undefined) {
    described.cause =
      depth >= MAX_CAUSE_DEPTH
        ? { error: `<cause chain truncated at depth ${MAX_CAUSE_DEPTH}>` }
        : describeThrown(error.cause, depth + 1);
  }
  return described;
}
