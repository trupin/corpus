import type { Warning, WarningCode } from "@corpus/contract";
import type { RowNotice } from "../row/useRowActions.js";

/**
 * How §11's warning channel is shown — **one decision per code, taken here**
 * (UI-106).
 *
 * **The defect this exists for.** Every site that rendered a warning rendered it
 * with `tone: "error"`. That was defensible while every member of
 * `WarningCode` described something wrong with a document. CONTRACT-047 widened
 * the channel: `carried_skill` describes SPEC.md §7 working exactly as
 * specified — a skill folder moved, and a nested `SKILL.md` came with it,
 * because §7 makes a skill's location its enablement. Painting "archiving this
 * skill also disabled the nested one" the same red as a failed commit teaches a
 * reader to dismiss the channel, which is how the one that *is* a problem gets
 * missed. SPEC.md's rider signed 2026-08-10 says it outright: **a warning is not
 * only a failure.**
 *
 * **The tone comes from the code and never from `detail`.** The contract makes
 * `detail` human-readable prose that is "rendered verbatim… never parsed", so a
 * tone chosen by matching words in it is a parse, and it would break the first
 * time the server reworded a sentence.
 *
 * **The map is exhaustive on purpose.** `Record<WarningCode, …>` is what makes a
 * new member a compile error rather than a silent red toast: the enum is
 * published and it grows — `validation_error` arrived in this release, and
 * `stage_status` and `default_open_cleared` a release before it. A default
 * branch would have swallowed each of them.
 *
 * ## The question each entry answers
 *
 * *Is this a report of something wrong, or an account of a specified effect?*
 *
 * - **Wrong**, and therefore `error`: the commit did not happen
 *   (`commit_failed`, `commit_skipped`), the document carries a fault
 *   (`orphaned_anchor`, `unresolved_ref`), or the save tolerated a §11 error
 *   rather than refusing it (`validation_error`).
 * - **Specified**, and therefore `info`: §7's folder move carried a skill
 *   (`carried_skill`) and corrected its frontmatter to match where it landed
 *   (`carried_reconciliation`); §5's coupling rule wrote a `status` because a
 *   board's kanban maps the `stage` this write moved (`stage_status`); §10's
 *   rider 2 allows one board to carry `default-open`, so setting it cleared the
 *   others (`default_open_cleared`).
 *
 * **No warning changes tone anywhere it is rendered today except the carried
 * pair**, which is the whole of what UI-106 asked for. `stage_status` already
 * had `info` at the one site that showed it (`FrontmatterForm`), and it keeps
 * both that tone and its bare wording here. `default_open_cleared` reached no
 * surface at all, so it had no tone to keep.
 */
interface WarningPresentation {
  readonly tone: RowNotice["tone"];
  /**
   * What precedes the server's `detail`.
   *
   * - **Absent** — the code itself leads, which is the wording every failure
   *   site in the app shows today: `commit_failed — <the hook's output>`.
   * - **`null`** — the detail alone, for a code whose server sentence is already
   *   a complete one.
   * - **A phrase** — that phrase. The carried pair leads with *"Also changed"*
   *   because that is the fact a reader needs first: this names a document they
   *   did not act on (UI-106). `detail` carries the id and the path, so which
   *   document it is stays the server's sentence and is never re-derived here.
   */
  readonly lead?: string | null;
}

export const WARNING_PRESENTATION: Record<WarningCode, WarningPresentation> = {
  commit_failed: { tone: "error" },
  commit_skipped: { tone: "error" },
  orphaned_anchor: { tone: "error" },
  unresolved_ref: { tone: "error" },
  validation_error: { tone: "error" },
  carried_skill: { tone: "info", lead: "Also changed" },
  carried_reconciliation: { tone: "info", lead: "Also changed" },
  // Its own site renders the server's sentence bare, and that sentence already
  // names the board that decided — a code in front of it would be noise.
  stage_status: { tone: "info", lead: null },
  default_open_cleared: { tone: "info", lead: "Also changed" },
};

/**
 * One warning as a notice a host can toast.
 *
 * **A code this build has never seen is shown, not swallowed.** `Warning.code`
 * is a closed enum on the wire, so the types say this cannot happen — and a
 * client is routinely older than the server it is talking to, which is exactly
 * when it does. The response says something happened, and a warning silently
 * dropped is the one outcome §11's channel exists to prevent, so an unplaced
 * code keeps the shape and the tone every warning had before this map existed:
 * `code — detail`, in red. **An unrecognised report is not evidence that nothing
 * is wrong**, and the code is on the line so the reader can look it up.
 */
export function warningNotice(warning: Warning): RowNotice {
  const shown: WarningPresentation = WARNING_PRESENTATION[warning.code] ?? { tone: "error" };
  const lead = shown.lead === undefined ? warning.code : shown.lead;
  return {
    tone: shown.tone,
    message: lead === null ? warning.detail : `${lead} — ${warning.detail}`,
  };
}

/** Every warning on a response, in the order the server sent them. */
export function warningNotices(warnings: readonly Warning[]): readonly RowNotice[] {
  return warnings.map(warningNotice);
}
