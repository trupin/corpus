// Bearer authentication for the workspace API (SPEC.md §2.1, CLAUDE.md
// Architecture Decision 5). The server binds loopback and every route carries
// the token `corpus init` generated, with exactly two documented exceptions:
// the health probe (the CLI polls it before it has read the token) and the
// loopback-only job-log ingest (SERVER-009, guarded by `localhostOnly`).

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { contractRoutes } from "@corpus/contract";
import { errorResponse, unauthorized } from "../errors.js";
import { createContractPathMatcher } from "./route-path.js";

/**
 * The one route under a guarded prefix that is reachable without a token. Taken
 * from the contract rather than spelled out, so a path change there cannot
 * silently turn the exemption into a hole somewhere else.
 */
export const HEALTH_PATH = contractRoutes.getHealth.path;

/**
 * Every route reachable without the workspace token, and **exactly** those
 * (SPEC.md §9.2 — "all routes require the workspace bearer token except the
 * documented exceptions: health probe; loopback job-log ingest").
 *
 * Each entry is method **and** path: the ingest is `POST /api/jobs/{id}/log`,
 * while `GET` on the same path — reading a job's log — stays authenticated.
 * Exempting the path would hand an unauthenticated caller the agent's console
 * output; exempting the prefix would hand it the whole jobs surface.
 */
export const UNAUTHENTICATED_ROUTES = [
  // The CLI polls this before it has read the token (SPEC.md §2.1).
  { method: "GET", path: contractRoutes.getHealth.path },
  // Tokenless by design, guarded instead by loopback + `Origin` refusal (§7).
  { method: "POST", path: contractRoutes.appendJobLog.path },
] as const;

const EXEMPTIONS = UNAUTHENTICATED_ROUTES.map((route) => ({
  method: route.method,
  matches: createContractPathMatcher(route.path),
}));

/** Whether this exact method-and-path pair is one of the documented exceptions. */
export function isUnauthenticatedRoute(method: string, path: string): boolean {
  return EXEMPTIONS.some((route) => route.method === method && route.matches(path));
}

/**
 * Compares two secrets without leaking their common prefix length through
 * timing. `timingSafeEqual` throws on unequal buffer lengths, so the length
 * check has to happen first — a length mismatch is already a failure and
 * short-circuiting it reveals nothing an attacker cannot measure from the
 * request they sent.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Extracts the token from `Authorization: Bearer <token>`, tolerating odd input. */
export function parseBearerHeader(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1];
}

export interface BearerAuthOptions {
  readonly token: string;
  /**
   * Accept `?token=` in addition to the header. Mounted only on `GET /events`:
   * the browser's `EventSource` cannot set request headers, so SPEC.md §2.1
   * authenticates the SSE stream with a query parameter. Allowing it anywhere
   * else would put the workspace token into referrers, proxy logs and browser
   * history for ordinary API calls.
   */
  readonly allowQueryToken?: boolean;
}

export function createBearerAuth(options: BearerAuthOptions): MiddlewareHandler {
  const { token, allowQueryToken = false } = options;

  return async (c, next) => {
    if (isUnauthenticatedRoute(c.req.method, c.req.path)) {
      return next();
    }

    const presented =
      parseBearerHeader(c.req.header("Authorization")) ??
      (allowQueryToken ? (c.req.query("token") ?? undefined) : undefined);

    if (presented === undefined || !timingSafeEqualString(presented, token)) {
      // The presented value is deliberately never logged or echoed back.
      return errorResponse(
        c,
        unauthorized(
          "missing or invalid workspace token — pass `Authorization: Bearer <token>` from .corpus/config.json",
        ),
      );
    }

    return next();
  };
}
