import { z } from "@hono/zod-openapi";

/**
 * SPEC.md §14's warnings: things that went wrong around a mutation without
 * making it fail. A warning never changes the status code and never rolls
 * anything back — the file mutation stands, because files are the source of
 * truth. It exists so the failure "surfaces loudly — a warning on the API
 * response, a server log entry, and console visibility" instead of leaving
 * silent drift.
 *
 * Two families, both named by §14:
 *
 * - **The auto-commit half.** "If a hook fails during an auto-commit, the file
 *   mutation still stands … the failure surfaces loudly." Also covers a
 *   workspace with no git at all, which stays fully usable.
 * - **The validation half.** "Unresolvable-but-well-formed anchors (orphaned
 *   threads) and unresolved `[[refs]]` are warnings, not failures."
 *
 * Response-side only. There is deliberately no request-side counterpart: a
 * client never tells the server what to warn about.
 */
export const WARNING_CODES = [
  "commit_failed",
  "commit_skipped",
  "orphaned_anchor",
  "unresolved_ref",
] as const;

export const WarningCodeSchema = z.enum(WARNING_CODES).openapi({
  description:
    "`commit_failed`: the workspace's git hooks rejected the auto-commit, or git itself failed — " +
    "the write is on disk and uncommitted. " +
    "`commit_skipped`: no commit was attempted, because the workspace is not a git repository or " +
    "no `git` is on the server's PATH. " +
    "`orphaned_anchor`: an anchor entry is well-formed but its quote no longer resolves in the " +
    "body, so its thread is detached (SPEC.md §6). " +
    "`unresolved_ref`: a `[[ref]]` in the body names no document.",
});

export const WarningSchema = z
  .object({
    code: WarningCodeSchema,
    detail: z
      .string()
      .describe(
        "Human-readable specifics — the hook's own output, the offending anchor id, the " +
          "unresolved ref. Rendered verbatim in the console; never parsed.",
      ),
  })
  .openapi("Warning");

/**
 * The carrier itself, spread into every mutation response. Always present and
 * always an array — an empty array is the normal case, and a client that has to
 * distinguish "no warnings" from "the field is missing" has been handed a worse
 * contract for no gain.
 */
export const warningsField = z
  .array(WarningSchema)
  .describe(
    "Non-fatal problems noticed while performing this mutation (SPEC.md §14). The mutation " +
      "succeeded regardless — files are the source of truth and the server never rolls a write " +
      "back because a commit or a check failed. Empty when nothing went wrong.",
  );

export type WarningCode = z.infer<typeof WarningCodeSchema>;
export type Warning = z.infer<typeof WarningSchema>;
