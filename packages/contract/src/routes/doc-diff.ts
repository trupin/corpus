import { createRoute, z } from "@hono/zod-openapi";
import { DOC_DIFF_MAX_CHARS, DocDiffQuerySchema, DocDiffSchema } from "../schemas/edit.js";
import { DocumentIdSchema } from "../schemas/id.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

/**
 * `GET /api/docs/{id}/diff` — the read behind `corpus doc diff <id>`
 * (SPEC.md §4's edit-acknowledgment rider, signed 2026-08-02; CLI-026).
 *
 * The rider names the verb and nothing else, so the route is derived the way
 * `POST /api/skills` was derived from §7's skill genesis: the agent reaches the
 * workspace only through the CLI, and the CLI only through the server
 * (CLAUDE.md Architecture Decision 2), so "a new CLI verb fetches the actual
 * diff on demand" is a server endpoint by construction. A §9.2 bullet for it is
 * drafted and held for sign-off (CONTRACT-028) — the same review discipline
 * every derived entry in `./inventory.ts` records.
 *
 * It sits beside `relatedDocs` in the registry rather than for routing reasons:
 * `/api/docs/{id}/diff` is a `GET` one segment deeper than `/api/docs/{id}`, and
 * the three routes sharing its depth (`move`, `archive`, `unarchive`) are
 * `POST`s, so no static segment competes with `{id}`.
 */

const DocIdParamSchema = z.object({
  id: DocumentIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

export const getDocDiff = createRoute({
  method: "get",
  path: "/api/docs/{id}/diff",
  tags: ["docs"],
  summary: "Read one document's change across a commit range",
  description:
    "The unified diff of a single document across a git commit range — what `corpus doc diff " +
    "<id>` prints, and the escalation a `doc.edited` queue event deliberately does not carry " +
    "(SPEC.md §4). The event announces *that* a user edit session ended, with its range and change " +
    "stats; this is the one call that says *what* changed, made only when the agent decides the " +
    "change is worth reading.\n\n" +
    "**Bounded, like the context pack.** Reading a diff costs roughly the same however large the " +
    `document or the change: the body is capped at ${DOC_DIFF_MAX_CHARS} characters ` +
    "(`DOC_DIFF_MAX_CHARS`) and a longer diff is **truncated, not refused** — whole hunks are " +
    "dropped from the end so the answer is still a valid unified diff, `truncated` says so, and " +
    "`totalChars` says how much was cut. Refusing would leave a caller that already spent a wake-up " +
    "with nothing; truncating leaves it with the front of the change and an honest measure of the " +
    "rest.\n\n" +
    "**Path-scoped**: the diff and the stats cover this document's file alone, so commits in the " +
    "range that touched other documents contribute nothing — the range may be a commit range, but " +
    "the answer is about one document.\n\n" +
    "**The range.** `from` is exclusive and `to` inclusive (`git diff from..to`). Both are " +
    "optional: `to` defaults to the newest commit that touched this document and `from` to the " +
    "parent of `to`, so the bare `corpus doc diff <id>` of §4's own sentence reads as *what changed " +
    "in this document's last commit*, while the pair carried by a `doc.edited` event reads as " +
    "*what changed in that session*. The resolved values come back in the response, because a " +
    "caller that omitted one must be able to say what it read.\n\n" +
    "**Only commit shas.** A syntactically invalid revision — `HEAD~1`, a tag, anything leading " +
    "with `-` — is a `400` naming the parameter, before a handler and therefore before a `git` " +
    "process exists. A well-formed sha this repository does not contain is *also* a `400` naming " +
    "the parameter, never a `404`: the `404` on this route means the **document** is unknown, and " +
    "conflating the two would have a caller believe its document had been deleted when it had " +
    "merely mistyped a range.\n\n" +
    "A document the workspace has never committed — a file not yet committed, or a workspace with " +
    "no git (SPEC.md §14) — answers `200` with a null range, an empty diff and zero stats: an " +
    "answer, not an error. Read-only; no acting party.",
  request: { params: DocIdParamSchema, query: DocDiffQuerySchema },
  responses: {
    200: jsonContent(
      DocDiffSchema,
      "The resolved range, the change stats, and the diff — truncated to the published bound when " +
        "the change is larger than it.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
  },
});
