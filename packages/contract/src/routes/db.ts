import { createRoute } from "@hono/zod-openapi";
import { ActorHeaderSchema } from "../schemas/actor.js";
import { DoctorReportSchema, RebuildResultSchema } from "../schemas/db.js";
import { jsonContent, UNAUTHORIZED_RESPONSE, VALIDATION_RESPONSE } from "./responses.js";

/**
 * The projection's maintenance surface — `corpus db rebuild` and `corpus db
 * doctor` (SPEC.md §2.2, §14).
 *
 * Both go over HTTP rather than running in the CLI, for the same reason every
 * other verb does: the server is the sole writer, and it is the process holding
 * the open `cache.db` handle. A CLI that rebuilt the file itself would leave a
 * running server reading a replaced inode.
 *
 * Neither route touches workspace files, so neither produces a git commit and
 * neither can warn under §14 — the `Warning` carrier every mutation response
 * spreads is deliberately absent from both responses, and stays absent.
 * `doctor` is read-only in the strictest sense: it opens the database read-only
 * and mutates nothing at all.
 *
 * **What CONTRACT-025 changed, and what it did not.** `DoctorReport` now carries
 * an optional `warnings` array of `DoctorWarning` — a *different* vocabulary
 * that happens to share the word, for report-only findings a person should see
 * and the projection is nonetheless correct about (SERVER-038's unindexable
 * files). The paragraph above still holds as written: doctor cannot produce a
 * §14 commit warning, because it performs no write. What was wrong was reading
 * "no §14 warnings" as "no findings beyond drift", which left a recovery surface
 * with nowhere to land except `drift` — where it would have flipped `ok` and the
 * exit code, breaking §14's `rebuild && doctor` clean invariant for the exact
 * workspaces that most need the report. `RebuildResult` gains nothing: a rebuild
 * already reports what it could not use, in `skipped`.
 */

export const rebuildDb = createRoute({
  method: "post",
  path: "/api/db/rebuild",
  tags: ["db"],
  summary: "Rebuild the projection from files",
  description:
    "Re-derives every row of `.corpus/cache.db` from the workspace's files alone and swaps the " +
    'result in atomically, which is what makes §9.1\'s "derived tables only" checkable rather ' +
    "than merely asserted (SPEC.md §14). The rename is the commit point: an interrupted rebuild " +
    "leaves the previous database intact. **Takes no request body at all** — there is nothing to " +
    "configure, and a bodiless `POST` is the whole call. A rebuild of a large corpus is the " +
    "longest-running call in the API; clients give it a longer timeout than the default. " +
    "`rebuild` followed by a clean `doctor` is the standing invariant §14 names.",
  request: { headers: ActorHeaderSchema },
  responses: {
    200: jsonContent(
      RebuildResultSchema,
      "What the rebuild wrote: per-table row counts, how long it took, and every file it skipped.",
    ),
    400: VALIDATION_RESPONSE,
    401: UNAUTHORIZED_RESPONSE,
  },
});

export const doctorDb = createRoute({
  method: "get",
  path: "/api/db/doctor",
  tags: ["db"],
  summary: "Check the projection against the files",
  description:
    "Reports every disagreement between the workspace's files and the projection's rows (SPEC.md " +
    "§14). Cheap enough for a pre-commit hook: a file whose size and mtime are unchanged is never " +
    "re-read, and a file that already has a row is never re-parsed. Nothing is mutated and no " +
    "rebuild is triggered — a drifted projection is reported, never quietly repaired, because the " +
    "point of the check is that drift is visible. `ok` is the verdict `corpus db doctor` turns " +
    "into its exit code. Findings that are worth reporting but are not disagreements arrive " +
    "separately in `warnings`, which never moves `ok`.",
  responses: {
    200: jsonContent(
      DoctorReportSchema,
      "The drift report. `ok` is true exactly when `drift` is empty; a drifted projection is a " +
        "`200` carrying the findings, not an error status. `warnings`, when present, is " +
        "report-only and leaves `ok` alone.",
    ),
    401: UNAUTHORIZED_RESPONSE,
  },
});
