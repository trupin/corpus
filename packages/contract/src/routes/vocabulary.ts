import { createRoute } from "@hono/zod-openapi";
import { WorkspaceVocabularySchema } from "../schemas/vocabulary.js";
import { jsonContent, UNAUTHORIZED_RESPONSE } from "./responses.js";

/**
 * `GET /api/vocabulary` — what a workspace actually uses (SPEC.md §9.2).
 *
 * Read-only and cached nowhere: it **describes** the corpus rather than
 * configuring it, so it is derived on demand and has no acting party. It sits
 * beside `GET /api/tree` because the two are the same kind of thing — a cheap
 * aggregate a picker reads to know what it may offer.
 */
export const getVocabulary = createRoute({
  method: "get",
  path: "/api/vocabulary",
  tags: ["tree"],
  summary: "The tags and invented frontmatter keys this workspace uses",
  description:
    "Backs the query editor's completion and the search overlay's `tag:` chip (SPEC.md §5, §10). " +
    "Every tag and every extra frontmatter key present in the corpus, each with the number of " +
    "documents carrying it, most-used first. Archived documents are excluded, the way every list " +
    "excludes them by default, and so are the **skills and agent definitions the tool installed** " +
    "— `name` and `description` on a `SKILL.md` are Claude Code's frontmatter (SPEC.md §7), not a " +
    "convention this workspace invented, and on a fresh workspace they outnumber everything a " +
    "person wrote. They stay filterable; they are absent from this *menu*. **Keys, not their " +
    "values**: what a `customer` field holds is " +
    "unbounded and what a workspace names its fields is not. An empty corpus answers two empty " +
    "arrays, never a `404`. Read-only; no acting party.",
  responses: {
    200: jsonContent(WorkspaceVocabularySchema, "The vocabulary in use, most-used first."),
    401: UNAUTHORIZED_RESPONSE,
  },
});
