import { GENERAL_RESIDENT_LABEL, LaneDot, useLaneRow, useWeightLevels } from "@corpus/kit";
import type { ReactElement } from "react";
import { laneWeightLabel } from "../console/residentsModel";
import { useNowTick } from "./useNowTick";

/**
 * **Who is resident here, and whether they are there** — SPEC.md §10's board
 * showing who is running, on the conversation that has the resident (§7).
 *
 * ## The roster *is* the designation
 *
 * §7 names a lane after its designated root thread, so this asks the roster for
 * a row under this thread's own id and renders exactly when it finds one. There
 * is no second field to read and nothing to keep in step: a thread with a
 * resident has a lane, a thread without one does not, and the badge follows the
 * `["agents"]` invalidation that designating, releasing and resolving all emit.
 *
 * ## It renders nothing rather than "nobody"
 *
 * `useLaneRow` answers `undefined` both for *"the roster has not spoken"* and
 * for *"the roster has spoken and this conversation is not a lane"*, and this
 * draws nothing in both cases. That is deliberate on the first: a badge saying
 * "no resident" while `GET /api/agents` is in flight would be asserting an
 * absence from an answer nobody has received (UI-098), and the ordinary
 * conversation — the overwhelming majority — has no resident and must look
 * exactly as it did before this feature existed.
 *
 * ## The words are the composer's words
 *
 * Name, liveness and line all come from `laneRow`, so the badge on the board and
 * the row in the recipient picker describe one lane identically — including the
 * cases that are easy to get subtly different, like a designated lane whose
 * frontmatter names no agent, or a lapsed one whose line has to say what happens
 * meanwhile. The dot is the picker's own `LaneDot`.
 *
 * ## Why it holds a clock
 *
 * Because liveness expires without anything arriving. `isAgentPresent` treats a
 * `live: true` whose evidence has aged past the grace window as lapsed, and a
 * badge that repainted only on data would keep a green dot lit after the agent
 * walked away until some unrelated invalidation happened by. The console pill
 * ticks for the same reason and at the same period.
 *
 * ## The one place it does not use the composer's word
 *
 * A **general resident** — a designation that named no profile (SPEC.md §7) —
 * is named in a *list* of lanes by the conversation it owns, because two of them
 * named alike would be two rows nobody can pick between. Here there is one lane
 * and it is on that very conversation, so its title would say nothing; the badge
 * prints `GENERAL_RESIDENT_LABEL` instead. That is still the kit's word and not
 * this component's — it is exported from the same module the name comes from,
 * for the same reason the rest of them are (UI-122).
 *
 * It is a **role and never a name**: "resident, no profile" cannot be mistaken
 * for an agent-def's title the way `agent` or `general` could, which is the
 * substitution CONTRACT-061 shaped `Resident` to prevent. It also cannot be read
 * as *no resident* — there is one, and the dot beside it says whether it is
 * there.
 *
 * ## …and what it runs at (UI-168)
 *
 * `Resident.weight` was put on the *response* rather than left write-only for
 * one stated reason: *"a surface that shows who is resident must show what it
 * runs at, or the choice is invisible once made."* This is that surface, and
 * until UI-168 it was the one that did not — the composer's address line already
 * said it, and the board badge, which is where a person looks at a conversation,
 * said nothing.
 *
 * The wording is the console's own {@link laneWeightLabel}, not a second
 * derivation beside it — the same reason the name, the note and the line all
 * come from `laneRow`. It carries three answers this badge would otherwise have
 * had to re-derive: a recorded level through the workspace's declared table, a
 * `null` said in the composer's words rather than left blank (a designation made
 * before this shipped chose nothing, and *the launcher chose* is a real outcome),
 * and **silence** for a lane with no designation to read a level from.
 */

export interface ResidentBadgeProps {
  /** The conversation this badge is on — a lane's name is a thread id (SPEC.md §7). */
  readonly threadId: string;
}

export function ResidentBadge({ threadId }: ResidentBadgeProps): ReactElement | null {
  const now = useNowTick();
  const row = useLaneRow(threadId, new Date(now));
  /*
   * The declaration, for turning the recorded **key** into the label a person
   * picked by. Read unconditionally, before the early return: it is the same
   * cached pair of queries every composer's weight control already holds, so it
   * costs this badge no request, and a hook cannot sit behind a branch.
   */
  const levels = useWeightLevels();
  if (row === undefined) return null;

  const general = row.kind === "general";
  const label = general ? GENERAL_RESIDENT_LABEL : row.name;
  const weight = laneWeightLabel(row, levels);
  /*
   * Composed exactly as the console's `laneRowTitle` composes a lane row's: the
   * three clauses about *who and whether* joined by ` — `, and the weight added
   * after them with the ` · ` the composer's address line uses between a
   * recipient and its level. One lane, one sentence, on every surface.
   */
  const statement = [label, row.note, row.line].filter((part) => part !== "").join(" — ");

  return (
    <span
      className="t-resident"
      data-resident-lane={row.lane}
      data-resident-liveness={row.liveness}
      data-resident-kind={row.kind}
      /*
       * The recorded **key**, beside the label the badge draws — deliberately
       * not `data-resident-weight`, which the composer's address popover already
       * uses for a `ResidentWeight.kind`. Two meanings on one attribute name is
       * how an unscoped selector starts matching the wrong surface.
       */
      data-resident-weight-key={row.weight ?? ""}
      /*
       * The line is beside the name *and* on the title, rather than only on the
       * title: §10 wants what a lapse means readable without a pointer, and a
       * hover is not available to a keyboard at all. The title repeats it for
       * the truncated case, where the line is elided by width.
       */
      title={weight === "" ? statement : `${statement} · ${weight}`}
    >
      <LaneDot liveness={row.liveness} />
      <span className={general ? "t-resident-kind" : "t-resident-name"}>{label}</span>
      {/*
       * §7's *"the missing profile is reported rather than silently
       * substituted"*, and this is where it is reported: on the conversation
       * whose designation still stands. Beside the liveness line rather than
       * inside it, because they answer different questions — who is resident,
       * and whether they are there.
       */}
      {row.note === "" ? null : <span className="t-resident-note">{row.note}</span>}
      {/*
       * What it runs at, between who it is and whether it is there — the order
       * the console's own lane row draws it in (`LaneList`: name, mark, weight,
       * liveness), so the two surfaces are scanned the same way. Empty only for
       * a lane with no designation, which this badge does not draw at all.
       */}
      {weight === "" ? null : <span className="t-resident-weight">{weight}</span>}
      {row.line === "" ? null : <span className="t-resident-line">{row.line}</span>}
    </span>
  );
}
