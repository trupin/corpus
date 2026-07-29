import { createRoute } from "@hono/zod-openapi";
import { CheckReportSchema, CheckRequestSchema } from "../schemas/check.js";
import { jsonContent, UNAUTHORIZED_RESPONSE, VALIDATION_RESPONSE } from "./responses.js";

/**
 * The validation surface behind `corpus doc check` (SPEC.md §14).
 *
 * §14's requirement is not that a check exists but that there is **one** of
 * them: "the same validator behind `corpus doc check` runs on every save".
 * Exposing it over HTTP is what makes that literally true rather than a claim
 * about two implementations that agree today — the server is the sole writer and
 * the only process holding the projection, so a CLI that validated locally would
 * be a second validator with a different view of the corpus.
 *
 * Read-only in the strictest sense: nothing is written, nothing is committed, no
 * acting party is declared (there is no author for a call that authors nothing),
 * and the response therefore carries no §14 commit `Warning` — only the
 * validator's own findings.
 */

export const checkDocuments = createRoute({
  method: "post",
  path: "/api/check",
  tags: ["check"],
  summary: "Validate documents against the §14 rules",
  description:
    "Runs the corpus validator and reports what it found, separated into failures and warnings " +
    "(SPEC.md §14). This is the same validator every server mutation runs before writing — hooks " +
    "and API share one implementation, which is the whole point of exposing it.\n\n" +
    "**Two request forms, exactly one per call.** `{ids}` names documents to read from the " +
    "workspace. `{documents: [{path, content}]}` supplies content that is not on disk — " +
    "`corpus doc check --staged`, whose bytes come from `git diff --cached`. Sending both keys, " +
    "or neither, is a `400`: the two forms answer different questions and a request that mixed " +
    "them would leave the caller guessing which one was honoured. There is deliberately no " +
    "implicit everything form, so an empty request can never be mistaken for a whole-workspace " +
    "check; an empty `ids` or `documents` array is legal and returns an empty, `ok` report.\n\n" +
    "**Cross-document rules see the whole corpus, not just the request.** Duplicate ids, thread " +
    "parents, anchor claims and `[[refs]]` are judged against the workspace, so checking one file " +
    "does not report every reference in it as unresolved merely because its target was not " +
    "submitted.\n\n" +
    "**Severity is fixed by §14, not by the caller.** Warnings are exactly `anchor-unresolved` " +
    "(a well-formed anchor whose quote no longer resolves — an orphaned thread, a normal outcome " +
    "of editing) and `ref-unresolved` (a `[[ref]]` whose target does not exist yet — how a corpus " +
    "grows). The other eleven codes are errors, `anchor-unused` among them: §14 requires every " +
    "anchor to belong to an existing thread, so a highlight pointing at no conversation is " +
    "structural drift. `ok` is `errors.length === 0` and is what `corpus doc check` turns into " +
    "exit 0 or exit 6.\n\n" +
    "A drifted corpus is a `200` carrying the findings, never an error status — the check " +
    "succeeded; the corpus is what has the problem.",
  request: {
    body: {
      required: true,
      description: "Either the document ids to check, or the unsaved `(path, content)` pairs.",
      content: { "application/json": { schema: CheckRequestSchema } },
    },
  },
  responses: {
    200: jsonContent(
      CheckReportSchema,
      "The report. `ok` is the verdict; `errors` fails the check and `warnings` does not.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});
