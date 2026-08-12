import { createRoute, z } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import {
  PatchConflictErrorSchema,
  PatchDocRequestSchema,
  PatchDocResponseSchema,
} from "../schemas/doc-patch.js";
import { StaleKeyErrorSchema } from "../schemas/error.js";
import { DocumentIdSchema } from "../schemas/id.js";
import {
  jsonContent,
  NOT_FOUND_RESPONSE,
  UNAUTHORIZED_RESPONSE,
  VALIDATION_RESPONSE,
} from "./responses.js";

const DocIdParamSchema = z.object({
  id: DocumentIdSchema.openapi({ param: { name: "id", in: "path", required: true } }),
});

/**
 * The `409` of this route. Two shapes, and the second one is not a caller's
 * mistake at all.
 *
 * A patch presents **no key** — §7 exempts it, because naming the text it
 * expects to find *is* the staleness check. But the server applies a patch by
 * computing a new body and handing it to the ordinary write path, which does
 * require one, so it presents the key of the bytes it just read and matched
 * (SERVER-079). If an **external editor** rewrites the file between that read
 * and the save's own read, that key goes stale and the refusal surfaces as
 * `stale_key` — carrying the document as it now stands, which is exactly what a
 * caller needs in order to re-quote.
 *
 * It is declared here rather than left undeclared because a route answering a
 * shape its contract does not name is the defect this package exists to prevent
 * (PR #43 review). `code` tells them apart: `conflict` is a patch the document's
 * own text refuses, `stale_key` is the document having moved underneath it.
 */
export const PATCH_CONFLICT_RESPONSE = jsonContent(
  z.union([PatchConflictErrorSchema, StaleKeyErrorSchema]),
  "The document's text refuses the patch, and `matches` says how many times `old` occurs in it. " +
    "`reason: no-match` (`matches: 0`) — the text is not there; re-read the document. " +
    "`reason: multiple-matches` — the text is there more than once and the patch did not ask for " +
    "`all`; quote more surrounding context. The two are separate because the recoveries are " +
    "opposite. Nothing was written. A `stale_key` here is the other case: an external editor moved the " +
    "document between the match and the write, so re-quoting against the copy this carries is the recovery.",
);

/**
 * `POST /api/docs/{id}/patch` — the anchored edit (SPEC.md §9.2, rider
 * SHARED-037 signed 2026-08-12).
 *
 * ## Why `POST` on a named sub-resource
 *
 * Not `PATCH /api/docs/{id}`: that verb is already taken, in meaning if not in
 * spelling. `PUT /api/docs/{id}` is *itself* a field-patch — every frontmatter
 * field is optional and a request names only what it changes — so a `PATCH` on
 * the same path would be a second, incompatible reading of "partially update
 * this document", distinguished from the first only by which verb the caller
 * happened to pick. A named sub-resource is honest about being an operation
 * rather than a representation, which is what this is: it takes an instruction
 * (`old` → `new`) rather than a state.
 *
 * ## Where it sits in the registry
 *
 * Immediately after `updateDoc`, which is where §9.2's bullet order puts it —
 * the whole-body write and the anchored one, adjacent, because the second exists
 * to be preferred over the first. Placement is for readability, not routing: it
 * is one segment deeper than `/api/docs/{id}`, and nothing competes for that
 * position.
 */
export const patchDoc = createRoute({
  method: "post",
  path: "/api/docs/{id}/patch",
  tags: ["docs"],
  summary: "Edit a document's body by anchored exact string replacement",
  description:
    "Edits the body by naming the text to replace rather than by sending a new body: `old` (an " +
    "excerpt of the body), `new` (its replacement, possibly empty), and `all` (default `false`). " +
    "**Prefer it over `PUT /api/docs/{id}` for a change you can quote.** That is most bounded " +
    "changes and not all of them: a patch **replaces**, so it catches a writer who changed the " +
    "text you quoted and not one who **inserted** elsewhere — an append that another writer may " +
    "also be appending to goes back whole under a key instead (SPEC.md §7). The whole-body write prices " +
    "a one-line edit at the length of the document, and — more than the cost — a body the caller " +
    "never saw cannot survive a body the caller sends: an edit that never carries the rest of the " +
    "document cannot destroy the rest of the document.\n\n" +
    "**`old` must match the body exactly and uniquely.** Matching is **byte-exact against the " +
    "body as stored** — the same bytes `GET /api/docs/{id}` returned in `body` — with no " +
    "normalisation, no trimming, no line-ending translation and no regular expressions, so what " +
    "you read is what you quote. It is a **body** operation: `body` excludes the frontmatter " +
    "block, so an excerpt quoting frontmatter matches nothing, and frontmatter is changed by " +
    "naming its fields on `PUT /api/docs/{id}`.\n\n" +
    "**Zero matches and multiple matches are separate refusals that name the count** — both " +
    "`409`, distinguished by `reason` and quantified by `matches` — because the recoveries are " +
    "opposite: re-read the document, versus quote more context. A single *it did not apply* would " +
    "collapse them and leave the caller guessing. `all: true` lifts the uniqueness requirement " +
    "and replaces **every occurrence left to right without overlap**; it does not lift the " +
    "requirement to match at all, so zero occurrences is still refused.\n\n" +
    "**It presents no key** (SPEC.md §7). It names the text it expects to find, which is a " +
    "staleness check by another route — sharper where it applies, since a patch whose text has " +
    "moved is told *which* text is gone rather than *that* the document changed, and requiring a " +
    "key would refuse a well-anchored patch because an unrelated paragraph moved. **It is not the " +
    "key by another name**: it covers the text the patch quotes and nothing else, which is why the " +
    "insertion case above goes back whole under a key instead.\n\n" +
    "**An ordinary write once applied**: validated before writing (SPEC.md §14), anchors " +
    "reconciled with remapped and orphaned anchors reported (§6), and one auto-commit attributed " +
    "to the acting party (§4) — the same response shape `PUT /api/docs/{id}` answers with, plus " +
    "`replaced`. **A patch whose result is the unchanged body is a no-op that writes nothing**: " +
    "`new` equal to `old` answers `200` with no file change and no commit, rather than a refusal.",
  request: {
    params: DocIdParamSchema,
    headers: ActorHeaderSchema,
    body: {
      required: true,
      description:
        "The text to find and what to put in its place. Mandatory: a patch that names no text is " +
        "not an edit.",
      content: { "application/json": { schema: PatchDocRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      PatchDocResponseSchema,
      "The saved document — carrying a fresh `key` — the anchor reconciliation report, §14's " +
        "warnings, and how many occurrences were `replaced`.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
    404: NOT_FOUND_RESPONSE,
    409: PATCH_CONFLICT_RESPONSE,
  },
});
