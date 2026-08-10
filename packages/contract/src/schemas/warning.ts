import { z } from "@hono/zod-openapi";

/**
 * SPEC.md §14's warnings: things that went wrong around a mutation without
 * making it fail. A warning never changes the status code and never rolls
 * anything back — the file mutation stands, because files are the source of
 * truth. It exists so the failure "surfaces loudly — a warning on the API
 * response, a server log entry, and console visibility" instead of leaving
 * silent drift.
 *
 * Two families are named by §14 itself:
 *
 * - **The auto-commit half.** "If a hook fails during an auto-commit, the file
 *   mutation still stands … the failure surfaces loudly." Also covers a
 *   workspace with no git at all, which stays fully usable.
 * - **The validation half.** "Unresolvable-but-well-formed anchors (orphaned
 *   threads) and unresolved `[[refs]]` are warnings, not failures."
 *
 * A third family joins them with CONTRACT-047, and it widens what the channel
 * carries, so it is stated rather than smuggled in:
 *
 * - **The carried half.** Effects the act had on documents **it was not asked to
 *   act on**. Nothing went wrong; the act was correct and so were the effects.
 *   But §4's reporting rule — the report and the commit are one story — is
 *   argued from the inverse case (never record an effect the user was told did
 *   not happen), and an effect the user was told *nothing* about fails it for
 *   the same reason. Archiving a skill moves its whole folder (§7), which
 *   carries every `SKILL.md` under it: a nested skill nobody named is enabled
 *   or disabled by that move, and may have its stale `status` corrected on the
 *   way. Before this, both were visible only in the commit and the server log.
 *
 * **Why this channel and not a new response field.** Two routes' responses
 * would have grown a field that is empty on every non-skill mutation, and the
 * two consumers that would render it — the console and the CLI's output — are
 * exactly the two that already render warnings verbatim. The channel's shape
 * fits (a machine-readable class plus prose naming the documents), so the only
 * thing that had to change is its published meaning: "non-fatal problems"
 * became "non-fatal problems, and effects on documents the request did not
 * name". A SPEC.md §14 rider saying so is drafted in
 * `issues/contract/047-report-a-carried-reconciliation.md`, held for the user's
 * signature; it ratifies the widening rather than authorising it, since §7 and
 * §4 already require the effect and the honesty about it respectively.
 *
 * **What is deliberately *not* reported: the id stamp.** The same folder move
 * writes the projection's id into a carried file so the move cannot re-mint it
 * (SERVER-078), and that write is not warned about. It changes nothing a reader
 * would notice — afterwards the document is the same document, with the same
 * id, which is what a reader already assumed; the write exists to *keep* that
 * true rather than to make anything new true. It also fires on nearly every
 * carry, which is how the reconciliation beside it would get ignored. It stays
 * recorded where a change with no consequence belongs: the commit and the log.
 *
 * Response-side only. There is deliberately no request-side counterpart: a
 * client never tells the server what to warn about.
 */
export const WARNING_CODES = [
  "commit_failed",
  "commit_skipped",
  "orphaned_anchor",
  "unresolved_ref",
  "carried_skill",
  "carried_reconciliation",
] as const;

export const WarningCodeSchema = z.enum(WARNING_CODES).openapi({
  description:
    "`commit_failed`: the workspace's git hooks rejected the auto-commit, or git itself failed — " +
    "the write is on disk and uncommitted. " +
    "`commit_skipped`: no commit was attempted, because the workspace is not a git repository or " +
    "no `git` is on the server's PATH. " +
    "`orphaned_anchor`: an anchor entry is well-formed but its quote no longer resolves in the " +
    "body, so its thread is detached (SPEC.md §6). " +
    "`unresolved_ref`: a `[[ref]]` in the body names no document. " +
    "`carried_skill`: this act moved a skill folder, and the move **enabled or disabled a skill " +
    "document the act did not itself archive or unarchive** — SPEC.md §7 makes a skill's " +
    "location its enablement, so a nested `SKILL.md` carried along by the folder changes state " +
    "without being asked. One warning per carried document, naming its id, its path after the " +
    "move, and which way its enablement went. " +
    "`carried_reconciliation`: a carried document's **own frontmatter was rewritten** to agree " +
    "with where it now sits — a stale `status: archived`, left by a previous independent archive " +
    "of that nested skill, corrected to `open` because the folder move landed it back under the " +
    "enabled root, where frontmatter is what status is read from. One warning per document " +
    "reconciled, naming its id and the key. It arises on unarchive only: the archived root reads " +
    "status from the root itself and never consults the key, so a move in that direction leaves " +
    "the key exactly as its author wrote it. " +
    "Both are silent when there is nothing to say — an act that carried no other skill document " +
    "emits neither, and a carried document whose frontmatter needed no correction emits " +
    "`carried_skill` alone. Neither ever describes a document whose **own archive or unarchive " +
    "landed in this act**: that document is the response's own subject on the single-document " +
    "routes, or a `changed` entry carrying that verb in a bulk result, and the move is exactly " +
    "what it asked for. **Being named is not enough** — a staged row that was refused, that was " +
    "already in the state it asked for, or that carried some other verb (a `tag` on the skill an " +
    "`archive` in the same Save disabled) is still described here, because nothing in the answer " +
    "it did get says the act moved its folder.",
});

export const WarningSchema = z
  .object({
    code: WarningCodeSchema,
    detail: z
      .string()
      .describe(
        "Human-readable specifics — the hook's own output, the offending anchor id, the " +
          "unresolved ref, the carried document's id and path. Rendered verbatim in the console; " +
          "never parsed, which is why every distinction a client must act on lives in `code`.",
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
    "Non-fatal problems noticed while performing this mutation (SPEC.md §14), **and effects it " +
      "had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The " +
      "mutation succeeded regardless — files are the source of truth and the server never rolls " +
      "a write back because a commit or a check failed, and a carried effect is not a failure at " +
      "all but a consequence the caller is owed. Empty when nothing went wrong and the act " +
      "touched nothing beyond what it was asked to do.",
  );

export type WarningCode = z.infer<typeof WarningCodeSchema>;
export type Warning = z.infer<typeof WarningSchema>;
