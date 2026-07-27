// Turning a contract route's path into something a middleware can match on.
//
// The contract spells paths the OpenAPI way (`/api/jobs/{id}/log`); Hono spells
// them `/api/jobs/:id/log`; a request arrives as `/api/jobs/evt_7c1d/log`. Three
// spellings of one path is two chances to drift, so every guard here derives its
// match from `contractRoutes.<name>.path` rather than from a literal — a path
// that moves in the contract moves the guard with it, and cannot quietly leave a
// route unguarded or an exemption pointing at nothing.

import type { MiddlewareHandler } from "hono";

/** Path parameters, as OpenAPI writes them. */
const PARAM_SEGMENT = /\{[^/{}]+\}/g;

/** `/api/jobs/{id}/log` → `/api/jobs/:id/log`, the form `app.use` matches on. */
export function toHonoPath(contractPath: string): string {
  return contractPath.replace(PARAM_SEGMENT, (segment) => `:${segment.slice(1, -1)}`);
}

/** Characters that are regex-significant and legal in a path. */
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * A predicate for "is this request path this contract route?". Anchored, and a
 * parameter matches exactly one segment — so a matcher for
 * `/api/jobs/{id}/log` never matches `/api/jobs/x/log/extra`, which is what
 * makes an auth exemption built on it path-exact rather than a prefix.
 */
export function createContractPathMatcher(contractPath: string): (path: string) => boolean {
  const source = contractPath
    .split("/")
    .map((segment) =>
      /^\{[^/{}]+\}$/.test(segment) ? "[^/]+" : segment.replace(REGEX_SPECIAL, "\\$&"),
    )
    .join("/");
  const pattern = new RegExp(`^${source}$`);
  return (path) => pattern.test(path);
}

/**
 * Scopes a middleware to one HTTP method. Hono's `app.use(path, …)` matches a
 * path for every method, and the guards on the job-log ingest must not touch the
 * authenticated `GET` that shares its path.
 */
export function methodOnly(method: string, handler: MiddlewareHandler): MiddlewareHandler {
  return async (c, next) => (c.req.method === method ? handler(c, next) : next());
}
