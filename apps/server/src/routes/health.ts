// `GET /api/health` — the only route SERVER-003 implements. It backs
// `corpus server start|status` (SPEC.md §2.1), which polls it while waiting for
// a freshly spawned server, so it must stay cheap: no database, no filesystem,
// no work that can fail while the process is otherwise healthy.

import type { RouteHandler } from "@hono/zod-openapi";
import type { contractRoutes, Health } from "@corpus/contract";

export interface HealthHandlerOptions {
  readonly version: string;
  readonly workspaceRoot: string;
  /** `Date.now()` at process start; injected so uptime is testable. */
  readonly startedAt: number;
  readonly now?: () => number;
}

export function buildHealthPayload(options: HealthHandlerOptions): Health {
  const now = options.now ?? Date.now;
  return {
    status: "ok",
    version: options.version,
    // The contract declares seconds (Sprint-002 Adjudication 1); fractional
    // values are legal and more useful than a floored integer during startup.
    uptimeSeconds: Math.max(0, (now() - options.startedAt) / 1000),
    workspace: options.workspaceRoot,
  };
}

export function createHealthHandler(
  options: HealthHandlerOptions,
): RouteHandler<typeof contractRoutes.getHealth> {
  return (c) => c.json(buildHealthPayload(options), 200);
}
