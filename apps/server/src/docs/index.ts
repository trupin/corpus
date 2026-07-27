/**
 * The collection query (SPEC.md §9.2): `GET /api/docs` — the one endpoint behind
 * every list in the product — and `GET /api/tree`, the folder scoping it agrees
 * with.
 *
 * This file is the surface: nothing outside `docs/` imports its internals.
 */

export {
  MAX_QUERY_TOKENS,
  MAX_SNIPPETS_PER_ROW,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  parseSnippets,
  toFtsMatchExpression,
  toSegments,
} from "./fts.js";
export { AWAITING_AGENT_SQL, NEEDS_REASON_SQL, UNREAD_SQL, rowAttention } from "./needs.js";
export { DOCS_ROOT, folderPathPrefix, queryDocs } from "./query.js";
export { mountDocsRoutes } from "./routes.js";
export type { DocsRoutesOptions } from "./routes.js";
export { STALENESS_THRESHOLD_DAYS, STALE_TIER_SQL, stalenessCutoffs } from "./staleness.js";
export { folderTree } from "./tree.js";
