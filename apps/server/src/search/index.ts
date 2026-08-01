/**
 * Ranked retrieval (SPEC.md §7 Retrieval discipline, §9.2): `GET /api/search`,
 * the endpoint behind `corpus search` and, from Retrieval Phase C, the ⌘K
 * overlay.
 *
 * This file is the surface: nothing outside `search/` imports its internals.
 */

export { hasMatch, unmarkSnippet } from "./snippet.js";
export type { UnmarkedSnippet } from "./snippet.js";
export {
  RETRIEVAL_OVERFETCH_CAP,
  RETRIEVAL_OVERFETCH_FACTOR,
  RRF_K,
  fuseRankings,
  overFetchLimit,
} from "./fusion.js";
export { mountSearchRoutes } from "./routes.js";
export type { SearchRoutesOptions } from "./routes.js";
export { searchCorpus } from "./search.js";
export type { SearchDeps } from "./search.js";
