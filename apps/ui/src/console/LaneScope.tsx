import { LaneDot, useThreadScope, type LaneRow, type WeightLevel } from "@corpus/kit";
import type { ReactElement } from "react";
import { useOpenInColumn } from "../board/openInColumn";
import {
  laneStatement,
  laneWeightLabel,
  ORCHESTRATOR_SCOPE_NOTE,
  SCOPE_BOUND_NOTE,
  SCOPE_PENDING_NOTE,
  SCOPE_VIA_MARKS,
  scopeCountLabel,
  scopeFailure,
  scopeMemberTitle,
  ROSTER_PENDING_NOTE,
} from "./residentsModel";

/**
 * The detail half of the Residents tab: **what the selected lane owns** (SPEC.md
 * §7's scope, read through `GET /api/threads/{id}/scope`, CONTRACT-068).
 *
 * ## It consumes the walk
 *
 * Membership is computed server-side per request, by the identical walk the
 * queue routes with, so nothing here filters, re-orders or re-labels: the root
 * comes first because the server put it first, and each member's `via` is the
 * edge that walk actually took. A pane that re-derived any of it would be the
 * second implementation of one rule that `scopeWalk.ts` records the cost of.
 *
 * ## One request, for the lane a person is looking at
 *
 * The scope is fetched on selection and never per row: a roster of a dozen lanes
 * must not be a dozen requests on mount, and only one scope can be read at a
 * time anyway. The orchestrator's lane is not asked about at all — §7 defines a
 * scope only for a designated thread, so the contract answers `409` there, and
 * this pane states what that lane *is* instead of drawing an empty list.
 *
 * ## The bound is shown, not hidden
 *
 * §7 forbids the agent the sweep, and the listing carries the same discipline:
 * the page stops at `SCOPE_PAGE_SIZE` with no cursor and no total. When the
 * server says it cut the page, this says so — a capped list presented as
 * complete is the failure that flag exists to prevent.
 *
 * ## Every member opens
 *
 * A row opens the document or thread in its column, exactly as a job's detail
 * header opens its originating document (§10). Knowing what an agent owns is
 * only half of what somebody opens this tab for; the other half is going there.
 */

export interface LaneScopeProps {
  /** The selected lane, or `null` while the roster has not answered. */
  readonly row: LaneRow | null;
  readonly levels: readonly WeightLevel[];
}

export function LaneScope({ row, levels }: LaneScopeProps): ReactElement {
  const openInColumn = useOpenInColumn();
  /*
   * `null` for the orchestrator's lane and while nothing is selected: the hook
   * treats both as "no request", so the pane's own branch below is about what to
   * *say*, never about suppressing a fetch that would otherwise happen.
   */
  const lane = row === null || row.kind === "orchestrator" ? null : row.lane;
  const scope = useThreadScope(lane);

  if (row === null) {
    return (
      <div className="lane-scope">
        <div className="lane-empty" role="status">
          {ROSTER_PENDING_NOTE}
        </div>
      </div>
    );
  }

  const weight = laneWeightLabel(row, levels);
  const failure = scopeFailure(scope.query.error);
  const members = scope.members;

  return (
    <div className="lane-scope" data-lane-scope={row.lane}>
      <div className="lane-scope-head">
        <LaneDot liveness={row.liveness} />
        <span className="lane-name">{row.name}</span>
        {/* Reserved and fixed, for `LaneList`'s reason and one more: the name
            here is `flex: none`, so only `.lane-statement` could pay for a
            weight that grew — and re-truncating the sentence this pane exists
            to show is exactly what SHARED-057 forbids. */}
        {weight === "" ? null : (
          <span className="lane-weight" title={weight}>
            {weight}
          </span>
        )}
        <span className="lane-statement" data-lane-statement={row.lane}>
          {laneStatement(row)}
        </span>
        {members === undefined ? null : (
          <span className="scope-count">{scopeCountLabel(members.length, scope.truncated)}</span>
        )}
      </div>

      {row.kind === "orchestrator" ? (
        <p className="lane-note" data-lane-note="orchestrator">
          {ORCHESTRATOR_SCOPE_NOTE}
        </p>
      ) : failure !== null ? (
        <p className="lane-note" data-lane-note="failed">
          {failure}
        </p>
      ) : members === undefined ? (
        <div className="lane-empty" role="status">
          {SCOPE_PENDING_NOTE}
        </div>
      ) : (
        <>
          <div className="scope-list" aria-label={`Scope of ${row.name}`}>
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                className="scope-member"
                data-scope-member={member.id}
                data-scope-via={member.via}
                data-scope-kind={member.kind}
                data-scope-status={member.status}
                title={scopeMemberTitle(member)}
                onClick={() => {
                  // A thread is a document (SPEC.md §6), so one id and one verb
                  // open either; the column resolves where it belongs.
                  openInColumn.open({ docId: member.id });
                }}
              >
                <span className="scope-kind">{member.kind}</span>
                <span className="scope-title">{member.title}</span>
                <span className="scope-via">{SCOPE_VIA_MARKS[member.via]}</span>
                {/* An archived document is still in scope — archiving touches
                    neither origin nor parent (SPEC.md §7) — so its status is
                    said rather than left to look like a stale listing. */}
                {member.status === "open" ? null : (
                  <span className="scope-status">{member.status}</span>
                )}
              </button>
            ))}
          </div>
          {scope.truncated === true ? (
            <p className="scope-bound" data-scope-bound="true">
              {SCOPE_BOUND_NOTE}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
