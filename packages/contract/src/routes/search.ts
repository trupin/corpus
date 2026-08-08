import { createRoute } from "@hono/zod-openapi";
import { SearchQuerySchema, SearchResultsSchema } from "../schemas/retrieval.js";
import { jsonContent, UNAUTHORIZED_RESPONSE, VALIDATION_RESPONSE } from "./responses.js";

/**
 * Ranked retrieval (SPEC.md §7 Retrieval discipline, §9.2 — SHARED-006 Edit 7,
 * signed 2026-07-30). The endpoint behind `corpus search` and, from Retrieval
 * Phase C, the ⌘K overlay.
 *
 * **Why this is not `GET /api/docs?sort=relevance`.** The collection query
 * already ranks; what it cannot do is answer cheaply. Its rows carry
 * frontmatter, attention reasons, thread affordances and snippet segment arrays
 * — a cost that scales with the documents, not with the answer. This route
 * exists for the output contract alone: id, title, heading path, one snippet
 * line, never a body (SPEC.md §1's "the agent retrieves; it never enumerates").
 * Lists stay on `GET /api/docs`; §11's columns and saved views are filtered
 * lists, because relevance ranking is a property of interactive search.
 */
export const searchCorpus = createRoute({
  method: "get",
  path: "/api/search",
  tags: ["search"],
  summary: "Ranked retrieval across the corpus",
  description:
    "Ranked retrieval over documents, threads and turns. `q` is required — a ranked list with " +
    "nothing to rank is `GET /api/docs`, not a degraded search. The structured filters are the " +
    "same set with the same semantics as `GET /api/docs`, archived default included, and are " +
    "declared from the same schema so the two cannot drift; `pinned`, `sort` and `offset` are not " +
    "among them and are ignored if sent (a ranked set has one order and no pages), and neither " +
    "is `isParent`, which §9.2's signed parameter string declares on the collection query alone. " +
    "Each hit is an " +
    "**address plus a line of context** — the document id, its title, the heading path of the " +
    "best-matching passage (for a hit inside a thread turn, that turn's heading), and a one-line " +
    "snippet — and **never a body**: reading one is a separate, deliberate `GET /api/docs/{id}` " +
    "on a retrieved id. Phase A ranks lexically (FTS5); from Retrieval Phase B, lexical and " +
    "semantic relevance combine into one list with this exact response shape, and " +
    "`semanticIndex` reports when that half is not caught up (SPEC.md §9.1) — the response's one " +
    "Phase B seam, inert today. Read-only; no acting party.",
  request: { query: SearchQuerySchema },
  responses: {
    200: jsonContent(
      SearchResultsSchema,
      "Hits, best match first; an empty list when nothing matched.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});
