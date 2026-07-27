import type { OpenAPIHono } from "@hono/zod-openapi";
import { contractRoutes } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import { queryDocs } from "./query.js";
import { folderTree } from "./tree.js";
import { mountDocWriteRoutes } from "./write-routes.js";
import { createDocumentMutex, type DocsWorkspace, type DocumentMutex } from "./write.js";

export interface DocsRoutesOptions {
  /** Injected so staleness and `due` keywords are testable against a fixed clock. */
  readonly now?: () => number;
  /**
   * Everything the file-backed half of the surface needs — read-one, and every
   * mutation. Omitted, only the two pure projection reads mount, which is what
   * a unit test that needs no workspace on disk wants.
   */
  readonly workspace?: DocsWorkspace | undefined;
  /**
   * The per-document write lane, shared with the thread surface so a thread
   * write and a document write to the same file queue rather than race
   * (SERVER-006). Omitted, the document surface gets a private one.
   */
  readonly mutex?: DocumentMutex | undefined;
}

/**
 * Binds the document surface to the contract's route definitions.
 *
 * The two collection reads are pure queries of the projection, so they need
 * nothing from the request beyond its validated query — parameters are parsed
 * by `DocsQuerySchema` in the zod-openapi hook, which is what makes an unknown
 * filter *value* a 400 rather than a silently empty list (SPEC.md §9.3).
 * Read-one and the mutations additionally touch the workspace, and mount only
 * when one is supplied.
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

  if (options.workspace !== undefined) {
    mountDocWriteRoutes(app, options.workspace, options.mutex ?? createDocumentMutex());
  }
}
