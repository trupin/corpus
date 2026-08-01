/**
 * The semantic index's two maintenance endpoints (SPEC.md §9.2's index bullet),
 * bound to the contract's own route definitions.
 *
 * Both are thin: everything they answer with comes from `maintenance.ts`, which
 * is where the facts are gathered and where the rebuild's ordering decisions
 * live. Neither declares a header, a body or a query, so neither validates
 * request input at all — which is why neither carries a `400` and why there is
 * no acting party to read (`packages/contract`'s `routes/index-maintenance.ts`:
 * both touch only derived runtime state, so there is no commit to attribute).
 *
 * Authentication is not wired here and must not be: `app.use("/api/*", …)` in
 * `app.ts` covers every route under the prefix, so a new endpoint is protected
 * by mounting rather than by remembering.
 */

import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import type { IndexMaintenance } from "./maintenance.js";

export function mountIndexRoutes(app: OpenAPIHono, maintenance: IndexMaintenance): void {
  // Read-only in the strictest sense: it starts no indexing, queues nothing and
  // writes no row. It does share `/api/search`'s provider resolution — cached,
  // single-flight and cooled down — because the alternative is two surfaces
  // answering the same question about one workspace differently.
  app.openapi(contractRoutes.getIndexStatus, async (c) => c.json(await maintenance.status(), 200));

  // `202`, and the body is the post-queue snapshot rather than an outcome: the
  // work has not happened yet, so the only honest thing to report is what is
  // already true — everything queued, `rebuilding` raised, `state` `indexing`.
  app.openapi(contractRoutes.rebuildIndex, (c) => c.json(maintenance.rebuild(), 202));
}
