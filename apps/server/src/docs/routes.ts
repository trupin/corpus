import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { collectExtraFilters, contractRoutes } from "@corpus/contract";
import { badRequest, toValidationIssues } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import type { SemanticRetrieval } from "../semantic/index.js";
import { queryDocs } from "./query.js";
import { workspaceVocabulary } from "./vocabulary.js";
import type { StalenessThresholds } from "./staleness.js";
import { relatedDocs } from "./related.js";
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
  /**
   * Retrieval's semantic half (SERVER-045), for `related`'s `similar` rows and
   * the `semanticIndex` word its envelope carries.
   */
  readonly semantic?: SemanticRetrieval | undefined;
  /**
   * The workspace's staleness ramp (SPEC.md §5, SERVER-133). Omitted, the
   * shipped 30/90/180 — which is what a fixture with no opinion about the ramp
   * wants, and what a workspace whose config carries no `staleness` block gets.
   */
  readonly staleness?: StalenessThresholds | undefined;
}

/**
 * {@link collectExtraFilters}, with its refusal turned into the `400` the
 * parameter's published description promises.
 *
 * **The conversion is not decoration.** Zod 4's `ZodError` does **not** extend
 * `Error`, so throwing one out of a handler does not reach `app.onError` and
 * does not reach `toHttpError`'s own `ZodError` branch either — Hono answers a
 * bare `500` with an empty body and logs nothing. Found by running the real
 * refusals against a real server: `extra.1bad=x`, `extra.assignee=` and
 * `extra.=x` each answered `500` while the `folderScope` refusal beside them,
 * which the contract's own refinement raises through the validator, answered
 * `400`.
 */
function readExtraFilters(raw: Record<string, string>): Record<string, string> | undefined {
  try {
    return collectExtraFilters(raw);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    throw badRequest(
      "the query names an extra field it cannot filter on",
      toValidationIssues(error),
    );
  }
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

  // `extra.<key>` reaches the handler rather than the validator (SPEC.md §5's
  // **Structured fields**). A zod object cannot restructure sibling keys, and
  // the wrapper that could — `z.preprocess` — destroys `.shape`, which the
  // query editor reads at runtime and which `openapi.test.ts` walks. So the
  // dotted parameters are lifted here by the contract's own function, and a
  // malformed key throws a `ZodError` that `toHttpError` renders as the `400`
  // the parameter's description promises.
  app.openapi(contractRoutes.listDocs, (c) => {
    const extra = readExtraFilters(c.req.query());
    const query = extra === undefined ? c.req.valid("query") : { ...c.req.valid("query"), extra };
    return c.json(queryDocs(projection, query, now(), options.staleness), 200);
  });

  app.openapi(contractRoutes.getTree, (c) => c.json(folderTree(projection), 200));

  // The other cheap aggregate a picker reads (CONTRACT-092): which tags and
  // which invented frontmatter keys this workspace actually uses. A pure
  // projection read, so it mounts here beside the tree.
  app.openapi(contractRoutes.getVocabulary, (c) => c.json(workspaceVocabulary(projection), 200));

  // The third pure projection read (SPEC.md §7 Retrieval discipline, §9.2):
  // expansion from a known document through the `links` graph. Reads `links`
  // and `documents`, and writes nothing — so it mounts here and not
  // with the file-backed surface below.
  app.openapi(contractRoutes.relatedDocs, async (c) =>
    c.json(
      await relatedDocs(projection, c.req.valid("param").id, c.req.valid("query"), {
        semantic: options.semantic,
      }),
      200,
    ),
  );

  if (options.workspace !== undefined) {
    mountDocWriteRoutes(app, options.workspace, options.mutex ?? createDocumentMutex());
  }
}
