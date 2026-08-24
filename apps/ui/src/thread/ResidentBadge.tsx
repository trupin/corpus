import { GENERAL_RESIDENT_LABEL, LaneDot, useLaneRow } from "@corpus/kit";
import type { ReactElement } from "react";
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
 * ## §7's missing-profile report is carried at **row width** (UI-124)
 *
 * The badge is one line inside a conversation's head, and it used to print
 * `LaneRow.note` — {@link MISSING_PROFILE_NOTE}, the whole sentence. Measured in
 * a real browser during PR #50's third review: `scrollWidth` 499 against a
 * `clientWidth` of 263. It clipped, and the resident's name beside it wrapped.
 *
 * So it prints `LaneRow.mark` instead. That is **not a second wording of the
 * claim** — the thing SHARED-053 exists to prevent, and the thing this issue's
 * acceptance criteria forbid inventing. `note` and `mark` are two renderings of
 * one fact, both derived from `LaneRow.kind`, and `laneRows.ts` says in as many
 * words which surface takes which: *"a surface with a line to itself says the
 * note; one whose rows sit side by side says this."* The recipient picker's own
 * rows already take the mark for the same reason, and the composer's statement
 * — the surface this note is written for — still carries the whole sentence.
 *
 * The sentence is not lost here either: the badge's `title` carries `note` in
 * full, which is SHARED-057's reveal (*"a truncated value gets its whole self on
 * a tooltip"*) and was already true before this change.
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
 * ## What it deliberately does **not** say: the weight (UI-168)
 *
 * This badge answers *who is resident*, and the composer's line one gesture
 * below answers *at what*. UI-168 built the weight clause here and it was taken
 * out again, on the measurement rather than on taste — recorded so nobody adds
 * it back without the number.
 *
 * The value arrives on a second round trip (`useWeightLevels` scans
 * `?type=skill` and then reads the body), and it is the workspace's own words,
 * so it needs the reserved box `console.css` documents: **~164px, 26ch**. In a
 * head that is `flex-wrap: wrap` that took a row of its own on a narrow card,
 * permanently, on every conversation with a resident — while the composer's
 * address line a few lines down already reads `researcher will answer · Heavy or
 * judgment-laden`. Room spent twice for one fact.
 *
 * The criterion it was built for is that *the choice must not be invisible once
 * made*, and it is not: it is at the **point of change** (the conversation's own
 * menu, `residentActions.ts`), the **point of use** (the composer's address line
 * and its popover), and in the **roster** (the console's Residents tab, whose
 * `.lane-weight` is a row with the width to hold it). Three surfaces, none of
 * them this one — which is the same split that keeps the weight off the
 * composer's recipient *rows*.
 *
 * Left out of the `title` too, rather than hidden there: a hover is not an
 * answer to "where is this shown", and a badge whose tooltip carries a fact its
 * face does not is the half-state this decision exists to avoid.
 */

export interface ResidentBadgeProps {
  /** The conversation this badge is on — a lane's name is a thread id (SPEC.md §7). */
  readonly threadId: string;
}

export function ResidentBadge({ threadId }: ResidentBadgeProps): ReactElement | null {
  const now = useNowTick();
  const row = useLaneRow(threadId, new Date(now));
  if (row === undefined) return null;

  const general = row.kind === "general";
  const label = general ? GENERAL_RESIDENT_LABEL : row.name;

  return (
    <span
      className="t-resident"
      data-resident-lane={row.lane}
      data-resident-liveness={row.liveness}
      data-resident-kind={row.kind}
      /*
       * The line is beside the name *and* on the title, rather than only on the
       * title: §10 wants what a lapse means readable without a pointer, and a
       * hover is not available to a keyboard at all. The title repeats it for
       * the truncated case, where the line is elided by width.
       */
      title={[label, row.note, row.line].filter((part) => part !== "").join(" — ")}
    >
      <LaneDot liveness={row.liveness} />
      <span className={general ? "t-resident-kind" : "t-resident-name"}>{label}</span>
      {/*
       * §7's *"the missing profile is reported rather than silently
       * substituted"*, and this is where it is reported: on the conversation
       * whose designation still stands. Beside the liveness line rather than
       * inside it, because they answer different questions — who is resident,
       * and whether they are there.
       *
       * At **row width** (`mark`), because this badge is a row; the whole
       * sentence (`note`) is on the title above and in the composer's statement
       * below. See the docblock — the two are one fact, not two wordings.
       */}
      {row.mark === "" ? null : <span className="t-resident-note">{row.mark}</span>}
      {row.line === "" ? null : <span className="t-resident-line">{row.line}</span>}
    </span>
  );
}
