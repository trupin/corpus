import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import type { SemanticRetrieval } from "../semantic/index.js";
import { searchCorpus } from "./search.js";

export interface SearchRoutesOptions {
  /** Injected so staleness and `due` keywords are testable against a fixed clock. */
  readonly now?: () => number;
  /**
   * Retrieval's semantic half (SERVER-045). Handed over at mount time and read
   * per request, so the embedded engine `lifecycle.ts` binds *after* the routes
   * are mounted still reaches this handler.
   */
  readonly semantic?: SemanticRetrieval | undefined;
}

/**
 * Binds `GET /api/search` (SPEC.md §7 Retrieval discipline, §9.2).
 *
 * A pure projection read, like the collection query and the folder tree: it
 * needs nothing from the request beyond its validated query, touches no file,
 * has no acting party. Parameters are parsed by
 * `SearchQuerySchema` in the zod-openapi hook, which is what makes a missing
 * `q` a 400 rather than an unranked everything.
 */
export function mountSearchRoutes(
  app: OpenAPIHono,
  projection: ProjectionDb,
  options: SearchRoutesOptions = {},
): void {
  const now = options.now ?? Date.now;
  app.openapi(contractRoutes.searchCorpus, async (c) =>
    c.json(
      await searchCorpus(projection, c.req.valid("query"), now(), { semantic: options.semantic }),
      200,
    ),
  );
}
