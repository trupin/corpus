// Every failure the server can produce, and the one place they become HTTP
// responses.
//
// Sprint-002 Adjudication 2 (binding): error bodies are `application/json`
// carrying the contract's `ApiError` — `{code, message, …}` discriminated on
// `code`. RFC 9457 / `application/problem+json` is deliberately NOT used: the
// contract declares `ApiErrorSchema` on every route's error responses and the
// CLI renders `<status> <code>: <message>` from those two fields.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { ApiError, Lock, ValidationIssue } from "@corpus/contract";

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
 * The acting party is not allowed to make this call at all — as opposed to 401
 * (no valid credential) or 423 (right party, wrong moment). Retrying with a
 * token does not help, so no `WWW-Authenticate` challenge is offered.
 */
export function forbidden(message: string): HttpError {
  return new HttpError(403, { code: "forbidden", message });
}

export function notFound(message: string): HttpError {
  return new HttpError(404, { code: "not_found", message });
}

export function locked(message: string, lock: Lock): HttpError {
  return new HttpError(423, { code: "locked", message, lock });
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
 * Maps anything thrown inside a handler or middleware to a response. Unexpected
 * errors never leak their message or stack to the client — the full error,
 * including `cause`, goes to the log instead.
 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof z.ZodError) {
    return badRequest("request failed validation", toValidationIssues(error));
  }
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
