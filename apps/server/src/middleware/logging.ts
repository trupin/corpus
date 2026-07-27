// One structured line per request. The workspace token can arrive as a query
// parameter on the SSE path (SPEC.md §2.1), so the query string is redacted
// before it reaches the log — `.corpus/server.log` is a plain file the operator
// may paste into an issue.

import type { MiddlewareHandler } from "hono";
import type { Logger } from "../logger.js";

/** Query keys whose values never appear in a log line. */
const SECRET_QUERY_KEYS = new Set(["token", "access_token"]);

/** Percent-encoding-safe, so the log line stays readable after re-serialization. */
export const REDACTED = "redacted";

export function redactQuery(queryString: string): string {
  if (queryString === "") return "";
  const params = new URLSearchParams(queryString);
  for (const key of params.keys()) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) params.set(key, REDACTED);
  }
  return params.toString();
}

/** Splits a request URL into its path and its redacted query string. */
export function describeRequestTarget(rawUrl: string): { path: string; query: string } {
  const queryStart = rawUrl.indexOf("?");
  if (queryStart === -1) return { path: rawUrl, query: "" };
  return { path: rawUrl.slice(0, queryStart), query: redactQuery(rawUrl.slice(queryStart + 1)) };
}

export function createRequestLogger(
  logger: Logger,
  now: () => number = () => Date.now(),
): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = now();
    await next();
    const fields: Record<string, unknown> = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: now() - startedAt,
    };
    const { query } = describeRequestTarget(c.req.url);
    if (query !== "") fields.query = query;
    logger.info("request", fields);
  };
}
