/**
 * Ranked retrieval (SPEC.md §7 Retrieval discipline, §9.2): `GET /api/search`,
 * the endpoint behind `corpus search` and, from Retrieval Phase C, the ⌘K
 * overlay.
 *
 * This file is the surface: nothing outside `search/` imports its internals.
 */

export { hasMatch, unmarkSnippet } from "./snippet.js";
export type { UnmarkedSnippet } from "./snippet.js";
export { mountSearchRoutes } from "./routes.js";
export type { SearchRoutesOptions } from "./routes.js";
export { searchCorpus } from "./search.js";
