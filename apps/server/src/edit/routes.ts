import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import { readDocDiff, type DocDiffDeps } from "./diff.js";

/**
 * `GET /api/docs/{id}/diff` (SPEC.md §4's edit-acknowledgment rider,
 * CONTRACT-028) — the escalation a `doc.edited` event deliberately does not
 * carry, and the read behind `corpus doc diff <id>` (CLI-026).
 *
 * Mounted from `edit/` rather than from `docs/routes.ts` even though its path
 * sits under `/api/docs`: it is one half of the acknowledgment feature and
 * shares its whole implementation with the other half (`edit/diff.ts` computes
 * the stats a `doc.edited` carries *and* the body this route bounds). It also
 * needs the raw `Git` command builder, which `DocsWorkspace` deliberately does
 * not carry — that surface exposes only the committer and its lock, and the
 * skill rollback already had to be handed `gitCommands` separately for exactly
 * this reason.
 *
 * The route is a pure read: no acting party, no lock guard, no write.
 */
export function mountDocDiffRoutes(app: OpenAPIHono, deps: DocDiffDeps): void {
  app.openapi(contractRoutes.getDocDiff, async (c) =>
    c.json(await readDocDiff(deps, c.req.valid("param").id, c.req.valid("query")), 200),
  );
}
