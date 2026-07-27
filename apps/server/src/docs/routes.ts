import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import { queryDocs } from "./query.js";
import { folderTree } from "./tree.js";

export interface DocsRoutesOptions {
  /** Injected so staleness and `due` keywords are testable against a fixed clock. */
  readonly now?: () => number;
}

/**
 * Binds the collection query and the folder tree to the contract's route
 * definitions. Both are pure reads of the projection, so they need nothing from
 * the request beyond its validated query — parameters are parsed by
 * `DocsQuerySchema` in the zod-openapi hook, which is what makes an unknown
 * filter *value* a 400 rather than a silently empty list (SPEC.md §9.3).
 */
export function mountDocsRoutes(
  app: OpenAPIHono,
  projection: ProjectionDb,
  options: DocsRoutesOptions = {},
): void {
  const now = options.now ?? Date.now;

  app.openapi(contractRoutes.listDocs, (c) =>
    c.json(queryDocs(projection, c.req.valid("query"), now()), 200),
  );

  app.openapi(contractRoutes.getTree, (c) => c.json(folderTree(projection), 200));
}
