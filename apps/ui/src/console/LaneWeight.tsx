import { useSetResident, weightLabel, type LaneRow, type WeightLevel } from "@corpus/kit";
import { useState, type ReactElement } from "react";
import { LAUNCHER_DECIDES_LABEL } from "../thread/residentActions";
import { useToast } from "../shell/Toasts";
import {
  laneHasDesignation,
  residentWeightNote,
  weightChangedNotice,
  WEIGHT_CHANGE_COST,
  WEIGHT_CHANGE_FAILED_LEAD,
  WEIGHT_CHANGE_LABEL,
  WEIGHT_CHANGE_NEEDS_PROFILE,
  WEIGHT_CONTROL_ARIA,
} from "./residentsModel";
import type { LaunchReading } from "./useLaunchRecord";

/**
 * **What this lane's resident works at, and the place to change it** — the
 * Residents tab's weight section (SPEC.md §7's rider signed 2026-08-19 as
 * amended by SHARED-076, 2026-09-02; UI-186, asked for by the user on
 * 2026-09-02: *"maybe we make it possible to change a resident's model from the
 * residents tab. That would make the mistake less of a problem."*).
 *
 * ## It re-designates. There is no second mechanism
 *
 * Changing a resident's level *is* re-designating the conversation, and the
 * server has done it all along: `POST /api/threads/{id}/resident` with a
 * different weight releases the standing resident with reason `replaced`, stops
 * its listener, and enqueues a fresh `resident.designated` for a listener at the
 * new level (`apps/server/src/threads/resident.ts`, SERVER-128/SERVER-129). The
 * conversation's own menu already offers exactly this, worded
 * *"Re-designate the general resident"*.
 *
 * So this control sends {@link useSetResident} with the resident already in
 * force and a new weight, and shares its words with that menu —
 * {@link LAUNCHER_DECIDES_LABEL} is `residentActions.ts`'s, not a second wording
 * of the same outcome. A dedicated route or a bespoke write here would be a
 * second implementation of one act, which is how two surfaces come to disagree
 * about what they did.
 *
 * ## The vocabulary is the workspace's, and it can be empty
 *
 * `levels` is `useWeightLevels` — the tier table in the workspace's own
 * orchestrate skill, which SHARED-022 Decision 1 makes the one declaration. A
 * workspace declaring none gets **no control at all**, exactly as the thread
 * menu's weight rows and Ask's owner level behave: never a fallback list, which
 * would be the second source that design exists to remove.
 *
 * ## Three lanes are offered nothing, for three different reasons
 *
 *   - The **orchestrator's** lane and an **unknown** row have no designation to
 *     change, so they get no section at all — not even the sentence.
 *   - A lane whose **profile has gone** has one, and it cannot be written: a
 *     re-designation names the profile and this one no longer resolves, so the
 *     server would answer `404`. It gets the sentence and
 *     {@link WEIGHT_CHANGE_NEEDS_PROFILE} in place of the control.
 *
 * ## The cost is on the screen, not behind a confirmation
 *
 * SHARED-076's rider requires the act to *"say what it costs before it is
 * taken"*. It says so **in the pane**, above the press, rather than in a dialog
 * the press summons: a person deciding whether to change a level needs the
 * price while they are deciding, and a modal that appears after the decision is
 * a speed bump rather than an input to it.
 *
 * It appears when a level **different from the one in force** is chosen — which
 * is exactly when the act becomes available, and therefore before it can be
 * taken. That is a budget decision and it was measured: the console drawer is
 * 210 px by default (`useConsoleLayout.ts`), and a permanently rendered cost
 * paragraph made this panel 194 px, leaving the lane's scope list 12 px. A
 * sentence that swallows the pane it explains is not a sentence anybody reads.
 *
 * It is **not** the growth §10's rider of 2026-08-20 forbids. That rule is about
 * a component sized by *"the text that happens to be in it"* — a longer name, a
 * value arriving after its box. This is a disclosure a person asked for by
 * choosing, it appears below the control rather than under the pointer, and the
 * full sentence also rides the button's own `title`.
 */

export interface LaneWeightProps {
  readonly row: LaneRow;
  /** The workspace's declared levels; empty means no control (SHARED-022). */
  readonly levels: readonly WeightLevel[];
  /** What the launch went out at, as `useLaunchRecord` read it. */
  readonly reading: LaunchReading;
}

export function LaneWeight({ row, levels, reading }: LaneWeightProps): ReactElement | null {
  const notify = useToast();
  const setResident = useSetResident();
  /**
   * The level standing for the *next* re-designation, seeded from the one in
   * force. `undefined` is "the launcher decides", which is a real member of the
   * set and the way back once a level has been picked (`residentActions.ts`).
   *
   * Held here and reset by the pane's `key`, so selecting another lane starts
   * from that lane's own level rather than carrying a half-made choice across.
   */
  const [chosen, setChosen] = useState<string | undefined>(row.weight ?? undefined);

  if (!laneHasDesignation(row)) return null;

  const note = residentWeightNote(row, levels, reading);
  const gone = row.kind === "profile-gone";
  /**
   * The standing level is offered even where the guidance has stopped declaring
   * it — `residentActions.ts`'s `weightOptions` rule, and it matters more here
   * for the same reason it does there: the choice is read off a designation that
   * may be months old, and dropping it would leave a control with nothing
   * selected and a resident whose recorded level the tab refuses to name.
   */
  const options =
    row.weight === null || levels.some((level) => level.key === row.weight)
      ? levels
      : [...levels, { label: row.weight, key: row.weight }];
  // Absence and a key compare the way the write compares them: omitting the
  // weight **clears** it server-side, so `heavy` → nothing is a real change.
  const changed = (chosen ?? null) !== (row.weight ?? null);

  return (
    <div className="lane-weight-panel" data-lane-weight-panel={row.lane}>
      <p className="lane-note" data-lane-weight-note={row.lane}>
        {note}
      </p>
      {gone ? (
        <p className="lane-note" data-lane-weight-blocked={row.lane}>
          {WEIGHT_CHANGE_NEEDS_PROFILE}
        </p>
      ) : levels.length === 0 ? null : (
        <>
          <div className="lane-weight-control">
            <select
              aria-label={WEIGHT_CONTROL_ARIA}
              value={chosen ?? ""}
              disabled={setResident.isPending}
              onChange={(event) => {
                const picked = event.currentTarget.value;
                setChosen(picked === "" ? undefined : picked);
              }}
            >
              <option value="">{LAUNCHER_DECIDES_LABEL}</option>
              {options.map((level) => (
                <option key={level.key} value={level.key}>
                  {level.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-lane-weight-apply={row.lane}
              disabled={!changed || setResident.isPending}
              title={WEIGHT_CHANGE_COST}
              onClick={() => {
                setResident.mutate(
                  { id: row.lane, designate: row.profile, weight: chosen },
                  {
                    onSuccess: () => {
                      notify({
                        tone: "info",
                        message: weightChangedNotice(
                          chosen === undefined
                            ? LAUNCHER_DECIDES_LABEL
                            : weightLabel(levels, chosen),
                        ),
                      });
                    },
                    onError: (error: Error) => {
                      notify({
                        tone: "error",
                        message: `${WEIGHT_CHANGE_FAILED_LEAD}: ${error.message}`,
                      });
                    },
                  },
                );
              }}
            >
              {WEIGHT_CHANGE_LABEL}
            </button>
          </div>
          {changed ? (
            <p className="lane-note lane-weight-cost" data-lane-weight-cost={row.lane}>
              {WEIGHT_CHANGE_COST}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
