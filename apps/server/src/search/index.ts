/**
 * Ranked retrieval (SPEC.md §7 Retrieval discipline, §9.2): `GET /api/search`,
 * the endpoint behind `corpus search` and, from Retrieval Phase C, the ⌘K
 * overlay.
 *
 * This file is the surface: nothing outside `search/` imports its internals.
 */

export {
  enclosingHeadings,
  hasMatch,
  locatePassage,
  primaryMatch,
  unmarkSnippet,
} from "./heading-path.js";
export type { UnmarkedSnippet } from "./heading-path.js";
export { mountSearchRoutes } from "./routes.js";
export type { SearchRoutesOptions } from "./routes.js";
export { loadPassageTexts, searchCorpus } from "./search.js";
export type { PassageTextLoader } from "./search.js";
