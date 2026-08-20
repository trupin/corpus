import { LaneDot, type LaneRow, type WeightLevel } from "@corpus/kit";
import type { ReactElement } from "react";
import {
  laneStatement,
  laneWeightLabel,
  NO_DESIGNATIONS_NOTE,
  ROSTER_PENDING_NOTE,
} from "./residentsModel";

/**
 * The master half of the Residents tab (SPEC.md §7's roster, §11's console):
 * every lane the server named, in the server's own order — the orchestrator's
 * first — at the job list's width and with its anatomy.
 *
 * A row is a real `<button>`, navigable by Tab and activated by Enter or Space
 * with no handler of our own, and `aria-current` says which one the scope pane
 * is showing. It is the job list's shape deliberately: two master-detail panes
 * one tab apart that select differently would be two answers to the same
 * gesture.
 *
 * ## Four facts per row, and every word of them comes from `laneRows`
 *
 * The dot says whether anybody is listening, the name says who is resident, the
 * mark carries §7's missing-profile report at row width, and the meta says the
 * liveness in a word. The full sentence — name, note, and what a lapse means
 * meanwhile — is on the row's title and stated again in the pane beside it,
 * because a hover is not available to a keyboard at all.
 *
 * ## Absence and emptiness are drawn differently
 *
 * `rows` is `undefined` until `GET /api/agents` answers, and that draws the
 * pending line rather than an empty list: the contract makes the orchestrator's
 * row unconditional, so an empty roster is a bug and not a workspace without
 * agents (UI-098). A roster naming **only** that row is the real empty state —
 * nothing has been designated — and it says how to designate something rather
 * than reading as a fault.
 */

export interface LaneListProps {
  /** Every lane as `laneRows` reads it, or `undefined` while the roster has not answered. */
  readonly rows: readonly LaneRow[] | undefined;
  /** The workspace's declared weight levels, for the level a designation recorded. */
  readonly levels: readonly WeightLevel[];
  readonly selectedLane: string | null;
  readonly onSelect: (lane: string) => void;
}

export function LaneList({ rows, levels, selectedLane, onSelect }: LaneListProps): ReactElement {
  if (rows === undefined) {
    return (
      <div className="lane-list" aria-label="Lanes">
        <div className="lane-empty" role="status">
          {ROSTER_PENDING_NOTE}
        </div>
      </div>
    );
  }

  const designated = rows.filter((row) => row.kind !== "orchestrator");

  return (
    <div className="lane-list" aria-label="Lanes">
      {rows.map((row) => {
        const weight = laneWeightLabel(row, levels);
        return (
          <button
            key={row.lane}
            type="button"
            className={row.lane === selectedLane ? "lane sel" : "lane"}
            aria-current={row.lane === selectedLane}
            data-lane={row.lane}
            data-lane-liveness={row.liveness}
            data-lane-kind={row.kind}
            title={laneStatement(row)}
            onClick={() => {
              onSelect(row.lane);
            }}
          >
            <LaneDot liveness={row.liveness} />
            <span className="lane-name">{row.name}</span>
            {row.mark === "" ? null : <span className="lane-mark">{row.mark}</span>}
            {weight === "" ? null : <span className="lane-weight">{weight}</span>}
            <span className="lane-meta">{row.liveness}</span>
          </button>
        );
      })}
      {designated.length === 0 ? <div className="lane-empty">{NO_DESIGNATIONS_NOTE}</div> : null}
    </div>
  );
}
