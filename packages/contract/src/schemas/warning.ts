import { z } from "@hono/zod-openapi";

/**
 * SPEC.md §11's warnings: things that went wrong around a mutation without
 * making it fail. A warning never changes the status code and never rolls
 * anything back — the file mutation stands, because files are the source of
 * truth. It exists so the failure "surfaces loudly — a warning on the API
 * response, a server log entry, and console visibility" instead of leaving
 * silent drift.
 *
 * Two families are named by §11 itself:
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
 * name". A SPEC.md §11 rider saying so is drafted in
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
 *
 * ## Where the last two members came from (CONTRACT-079)
 *
 * `stage_status` and `default_open_cleared` were added during Phase 41 **from
 * `apps/server`'s workspace**, by SERVER-138, rather than through an issue in
 * this domain. The enum is closed and both of that issue's acceptance criteria
 * require the response to name what the write changed, so routing two members
 * through a separate contract issue would have cost a serialization for no
 * decision. The generated artifacts moved in the same commit as the schema and
 * the breach was flagged in the commit and PR bodies; PR #58's reviewer judged
 * the call right and asked only that the contract's own history record it.
 * This paragraph is that record, and it is the exception rather than the rule:
 * a member added here is a published vocabulary change, and the next one goes
 * through this domain.
 *
 * The descriptions below were audited against their emitters on 2026-08-23
 * (CONTRACT-079), and three had drifted from what the server does. Each is
 * corrected in place and noted where the correction is not self-evident.
 */
export const WARNING_CODES = [
  "commit_failed",
  "commit_skipped",
  "orphaned_anchor",
  "unresolved_ref",
  "carried_skill",
  "carried_reconciliation",
  "stage_status",
  "default_open_cleared",
] as const;

export const WarningCodeSchema = z.enum(WARNING_CODES).openapi({
  description:
    "`commit_failed`: the workspace's git hooks rejected the auto-commit, or git itself failed — " +
    "the write is on disk and uncommitted. " +
    "`commit_skipped`: **no commit stands for this write**, and nothing refused it — the write is " +
    "on disk and uncommitted, as it is under `commit_failed`, but no hook and no git command " +
    "said no. The ordinary causes are a workspace that is not a git repository and no `git` on " +
    "the server's PATH, and the rarer one is a commit that ran and left no `HEAD`; `detail` names " +
    "which, and the set is the server's to grow. Silent when a save changed no committed bytes: " +
    "the pipeline agreeing with itself is not a degraded state. " +
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
    "of that nested skill, corrected to `resolved` because the folder move landed it back under " +
    "the enabled root, where frontmatter is what status is read from. `resolved` and not `open`: " +
    "being swept back to the enabled root **is** being unarchived, implicitly rather than by " +
    "name, so the carried document is given the state SPEC.md §5's ladder gives the one a caller " +
    "unarchives outright — one move must not hand two skills two different states. One warning " +
    "per document reconciled, naming its id, its path and the status it was given. It arises on " +
    "unarchive only: the archived root reads status from the root itself and never consults the " +
    "key, so a move in that direction leaves the key exactly as its author wrote it. " +
    "`stage_status`: this write moved a document's `stage`, the document is **in a kanban**, and " +
    "the board's `kanban.status` map therefore decided its `status` in the same commit " +
    "(SPEC.md §5's coupling rule, rider signed 2026-08-22). One warning, naming the stage, the " +
    "status it wrote and the board that decided — and, when the document is in more than one " +
    'kanban over `stage`, the boards that did not decide, since "the one with the lowest ' +
    '`order`" is a rule a caller cannot check from the response alone. It is about the document ' +
    "the request named, unlike the carried pair above, and it is here because the caller asked " +
    "for one field and got two: a `status` a caller neither sent nor was told about is exactly " +
    "the effect §11 says must not be learned from `git log`. A stage the board maps writes that " +
    "status; any other stage, a stage the board does not draw included, writes `open` " +
    "(SPEC.md §5). **It is silent in five cases**, and the last is the common one: when the write " +
    "moved no stage at all (an autosave re-sending the stored value has moved nothing); when no " +
    "kanban over `stage` claims the document; when the only board that would claim it is itself " +
    "**archived**, since a board nobody can see deciding a status is a change with no visible " +
    "cause; when the document's **root** decides its status rather than its frontmatter — an " +
    "archived skill is archived because of the folder it sits in (§7), so there is no status here " +
    "to decide; and when the status the stage decides is the one the write was already going to " +
    "leave on disk, which is every ordinary move between two stages a board maps the same way. " +
    "The last is why this is not a warning per drag: it fires when a `status` changed under a " +
    "caller who asked about `stage`, and not otherwise. " +
    "`default_open_cleared`: this write set `default-open: true` on a board, and **at most one " +
    "board carries it** (SPEC.md §10, rider 2), so every other board that carried the flag lost " +
    "it in the same commit. One warning per board cleared, naming its id and title. Silent when " +
    "no other board carried it. " +
    "The last two are silent when there is nothing to say, and so are the carried pair — an act " +
    "that carried no other skill document " +
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
    "Non-fatal problems noticed while performing this mutation (SPEC.md §11), **and effects it " +
      "had on documents it was not asked to act on** (§7's skill folder move; CONTRACT-047). The " +
      "mutation succeeded regardless — files are the source of truth and the server never rolls " +
      "a write back because a commit or a check failed, and a carried effect is not a failure at " +
      "all but a consequence the caller is owed. Empty when nothing went wrong and the act " +
      "touched nothing beyond what it was asked to do.",
  );

export type WarningCode = z.infer<typeof WarningCodeSchema>;
export type Warning = z.infer<typeof WarningSchema>;
