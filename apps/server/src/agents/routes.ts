import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { buildRoster, type RosterDeps } from "./roster.js";

/**
 * `GET /api/agents` (SPEC.md §7, CONTRACT-051): read-only, no parameters, and
 * behind the ordinary bearer guard like every other `/api/*` route.
 *
 * Mounted with the projection-backed surface rather than beside the queue, and
 * that is the honest placement even though liveness itself needs no database:
 * the lanes come from `threads`, so a server built without a projection could
 * only ever answer with the orchestrator's row — a roster that names no
 * designated lane on a workspace that has them would be worse than no route.
 */
export function mountAgentRoutes(app: OpenAPIHono, deps: RosterDeps): void {
  app.openapi(contractRoutes.getAgentRoster, (c) => c.json(buildRoster(deps), 200));
}
