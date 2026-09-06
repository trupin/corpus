import { useSetResident, type LaneRow } from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useToast } from "../shell/Toasts";
import { RELEASED_NOTICE } from "../thread/residentActions";
import {
  laneHasDesignation,
  RELEASE_CANCEL_LABEL,
  RELEASE_CONFIRM_LABEL,
  RELEASE_CONSEQUENCE,
  RELEASE_FAILED_LEAD,
  RELEASE_LABEL,
} from "./residentsModel";

/**
 * **Stopping this lane's resident, in the pane that shows it running** — the
 * Residents tab's release control (SPEC.md §7's dissolution, §9.2's `DELETE
 * /api/threads/{id}/resident`, §8's rider signed 2026-09-06; UI-195, asked for
 * by the user on 2026-09-06: *"I want to be able to stop a resident agent from
 * the console pannel."*).
 *
 * ## It releases. There is no second stop
 *
 * §9.2's release is the one act this product has that stops an agent with an
 * observable end: SERVER-128 stopped it being discovered up to a rearm window
 * late, so the enqueued `resident.released` ends every park on the lane it names
 * and the listener is gone when the response lands. Nothing else halts one
 * agent — the console's HALT is the queue's whole switch — so this control is
 * `useSetResident` with `release: true`, the same mutation the conversation's
 * own menu sends, and not a bespoke write. Two implementations of one act is how
 * two surfaces come to disagree about what they did, which is the property
 * UI-195 asks for by name.
 *
 * ## Nothing is painted before the server says so
 *
 * The row is the roster's, and the roster is refetched because the mutation
 * invalidates `["agents"]` — the same key the server's own `resident.released`
 * invalidation names, so a release made anywhere else updates this pane
 * identically. This component holds no copy of the row and hides nothing
 * locally: a released lane leaves the list when `GET /api/agents` stops naming
 * it, and `resolveSelectedLane` falls back rather than stranding the pane on a
 * row that has gone. §9.2 makes the effect observable, and a pane that pretended
 * an agent had stopped before it had would spend exactly the honesty this tab
 * exists for.
 *
 * ## It is in the detail pane, and every resident row reaches it
 *
 * The list beside this is rows of real `<button>`s — `LaneList`'s deliberate
 * choice, so Tab and Enter work with no handler of ours — and a control nested
 * inside one would be a button inside a button. More to the point, this act owes
 * a **sentence** before it is taken, and `.lane-weight`'s note records what
 * happens to a sentence put in a row: nothing in that list may grow (UI-131).
 * So it sits where the pane already puts a per-resident write, one block under
 * the weight section, keyed and marked with the lane it acts on. Selecting a
 * lane is what reaches it, which is the same gesture that reaches everything
 * else this tab says about that lane.
 *
 * ## The consequence is stated before the act, and that costs one press
 *
 * The first press arms and says what releasing does. The second performs it. The
 * sentence sits above the confirm rather than below it, unlike
 * `WEIGHT_CHANGE_COST` — there the paragraph explains a choice already made in
 * the select beside it, and here it is the input to the press directly under it.
 *
 * Armed rather than always on the screen, for the weight panel's measured
 * reason: the console drawer is 210 px by default (`useConsoleLayout.ts`), the
 * panel above already spends a paragraph of it, and a second permanent one would
 * leave the lane's scope list a few pixels. The whole sentence rides the resting
 * button's own `title` as well, so it is readable before anything is pressed at
 * all.
 *
 * Arming still overflows that drawer, and both halves of the answer are here
 * rather than only one: `.lane-scope` scrolls, so nothing is unreachable at any
 * height, and this section scrolls **itself** to the pane's bottom edge when it
 * arms, so the sentence and the two presses arrive together. Measured against
 * the real app at the default height — before the pair, `Confirm release` landed
 * 27 px below the drawer's own edge with no scroller to reach it.
 *
 * ## A lane with no resident is offered nothing
 *
 * §9.2 makes the release idempotent, so a second one would be harmless — and an
 * offer that acts on nothing is still a claim that there is something to act on.
 * The gate is {@link laneHasDesignation}, the weight control's: the
 * orchestrator's lane belongs to no conversation and was designated by nobody,
 * and an `unknown` row is a lane the roster reports with no resident on it.
 * A `profile-gone` lane **is** offered the control, unlike the weight one — a
 * release names no profile that has to resolve, so the one act that cannot fail
 * for a missing profile is the one this pane still offers there.
 */

export interface LaneReleaseProps {
  readonly row: LaneRow;
}

export function LaneRelease({ row }: LaneReleaseProps): ReactElement | null {
  const notify = useToast();
  const setResident = useSetResident();
  /**
   * Whether the consequence has been shown. Browser-local and reset by the
   * pane's `key`, so selecting another lane never carries a half-made decision
   * onto a resident it was not made about.
   */
  const [armed, setArmed] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  /**
   * Arming makes this section taller than the space left in a 210 px drawer, so
   * the sentence would appear with its own confirm below the pane's edge — an
   * act a person started and cannot finish without knowing to scroll. `.lane-scope`
   * scrolls (`console.css`), and this is what uses it: the section is brought to
   * the pane's bottom edge so the consequence and the two presses arrive
   * together.
   *
   * Only on the way **in**. Disarming shrinks the section, which needs no
   * scroll, and scrolling on the way out would move a pane a person did not ask
   * to move. `scrollIntoView` is called optionally because jsdom does not
   * implement it and a layout convenience must not throw in a test.
   */
  useEffect(() => {
    if (!armed) return;
    panel.current?.scrollIntoView?.({ block: "end" });
  }, [armed]);

  if (!laneHasDesignation(row)) return null;

  return (
    <div className="lane-release-panel" data-lane-release-panel={row.lane} ref={panel}>
      {armed ? (
        <p className="lane-note lane-release-consequence" data-lane-release-consequence={row.lane}>
          {RELEASE_CONSEQUENCE}
        </p>
      ) : null}
      <div className="lane-release-control">
        {armed ? (
          <>
            <button
              type="button"
              data-lane-release-confirm={row.lane}
              disabled={setResident.isPending}
              title={RELEASE_CONSEQUENCE}
              onClick={() => {
                setResident.mutate(
                  { id: row.lane, release: true },
                  {
                    onSuccess: () => {
                      setArmed(false);
                      notify({ tone: "info", message: RELEASED_NOTICE });
                    },
                    onError: (error: Error) => {
                      notify({
                        tone: "error",
                        message: `${RELEASE_FAILED_LEAD}: ${error.message}`,
                      });
                    },
                  },
                );
              }}
            >
              {RELEASE_CONFIRM_LABEL}
            </button>
            <button
              type="button"
              data-lane-release-cancel={row.lane}
              disabled={setResident.isPending}
              onClick={() => {
                setArmed(false);
              }}
            >
              {RELEASE_CANCEL_LABEL}
            </button>
          </>
        ) : (
          <button
            type="button"
            data-lane-release={row.lane}
            disabled={setResident.isPending}
            title={RELEASE_CONSEQUENCE}
            onClick={() => {
              setArmed(true);
            }}
          >
            {RELEASE_LABEL}
          </button>
        )}
      </div>
    </div>
  );
}
