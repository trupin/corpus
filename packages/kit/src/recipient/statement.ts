import type { LaneRow } from "./laneRows.js";

/**
 * The words a composer says about **who will answer** — SPEC.md §10's *"A
 * composer says who it will reach, before you send"* and §7's *"the default is
 * never a guess a person has to check"*, as one sentence.
 *
 * Pure, and apart from the control that shows it (`ComposerAddress`), for the
 * reason every liveness rule in this repo is: the honesty is in the wording,
 * and wording derived inside a component is wording no test reaches without
 * rendering one.
 */

/** Said while the walk has not answered: true, and claims no lane. */
export const RECIPIENT_UNKNOWN_STATEMENT = "who answers follows from where you are";

/** Marks the row a send with nothing picked would go to. */
export const DEFAULT_ROW_NOTE = "default here";

/**
 * What the statement says about a lane the **server refused** (SPEC.md §7's
 * `422 unknown_recipient`, UI-118).
 *
 * It stays on the row after the toast has gone, because a toast that dismisses
 * itself in six seconds is not where a person finds out where their message did
 * not go. It says *nothing was sent* in the server's own words rather than
 * softening it: the send is the thing that did not happen, and the composer
 * still holds the text to prove it.
 */
export const RECIPIENT_REFUSED_STATEMENT = "is not a lane any more — nothing was sent; pick again";

/**
 * @param picked whether the person **chose** this row, rather than it being
 * where posting here happens to go. The verb changes on the act and not on the
 * difference: a pick that names the default's own lane is still a choice about
 * this one message, and UI-118 is what happens when the two are conflated.
 *
 * Three clauses, and each answers a different question: **who** answers,
 * **what is worth saying about who they are** (`note` — §7's missing-profile
 * report, empty for every other kind), and **whether they are there** (`line`).
 * Joined in that order and dropped where empty, exactly as the board badge joins
 * them, so a lane reads the same on both surfaces.
 */
export function statementFor(row: LaneRow | undefined, picked: boolean, refused = false): string {
  if (row === undefined) return RECIPIENT_UNKNOWN_STATEMENT;
  if (refused) return `${row.name} ${RECIPIENT_REFUSED_STATEMENT}`;
  const verb = picked ? "will answer this message" : "will answer";
  return [`${row.name} ${verb}`, row.note, row.line].filter((part) => part !== "").join(" — ");
}
