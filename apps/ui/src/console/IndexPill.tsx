import type { IndexStatus } from "@corpus/contract";
import type { ReactElement } from "react";
import { indexDotClass, indexPillText } from "./consoleModel";

/**
 * The semantic index's pill (SPEC.md §11's index-pill rider, signed
 * 2026-08-02). It sits at the end of the strip's left group, immediately
 * before the spacer — UI-133 moved it there from beside the agent pill,
 * because its sentence is the strip's one unbounded string and anything after
 * it was shoved 233px sideways when the sentence grew.
 *
 * It is the agent pill's twin by construction — same shape, same dot vocabulary,
 * same `.dot` child — because the two report the same kind of thing: what a
 * background worker is doing right now. Its own class (`.index-pill`) exists so
 * that a locator for either one stays single-match in Playwright's strict mode,
 * which is the rule the strip has already been bitten by once (sprint-010
 * adjudication 5).
 *
 * Deliberately *not* `role="status"`, for {@link AgentPill}'s reason: the strip's
 * reachability notice holds that role, and a third live region on one line would
 * make "the console says" ambiguous to a screen reader.
 */
export function IndexPill({ status }: { readonly status: IndexStatus }): ReactElement {
  return (
    <span className="index-pill" data-index-state={status.state}>
      <span className={indexDotClass(status)} aria-hidden="true" />
      <span>{indexPillText(status)}</span>
    </span>
  );
}

/**
 * The expanded drawer's index row: the server's sentence, and the number that
 * will not drain by itself.
 *
 * **`detail` is rendered verbatim and nothing branches on it.** The contract is
 * explicit that the wording is the server's, that it changes with the reason —
 * a model 46% downloaded, a configured endpoint that did not answer, an index
 * built by a model that is no longer resolving — and that `state` is the only
 * field a client may decide with. So this component reads `detail` as a string
 * and prints it; there is no parsing, no percentage extraction, no keyword
 * match, and no fallback wording invented on the server's behalf.
 *
 * **`failed` appears only when it is non-zero**, which is the rider's wording and
 * also the honest reading: `0 failed` on every workspace forever is a number
 * that trains people to stop seeing it, and a failed chunk is exactly the state
 * that needs a person (it does not drain — `corpus index rebuild` re-queues it).
 *
 * The row renders nothing when there is neither a sentence nor a failure. The
 * counts and the state are already one line above in the pill, and a row whose
 * only content is a restatement is a row that has to invent something to say.
 */
export function IndexStatusRow({
  status,
}: {
  readonly status: IndexStatus | undefined;
}): ReactElement | null {
  if (status === undefined) return null;
  const detail = status.detail;
  if (detail === undefined && status.failed === 0) return null;

  return (
    <div className="index-status" data-index-state={status.state}>
      <span className={indexDotClass(status)} aria-hidden="true" />
      {detail === undefined ? null : (
        /*
         * Truncated in place, whole in `title` (SPEC.md §11's rider, signed
         * 2026-08-20). The row used to wrap this sentence, which took its second
         * line out of the board — measured at 28.94px → 44.88px on the row and
         * 348.63px → 332.69px on the board (UI-133). The sentence is the
         * server's and can be any length, so the box cannot be its.
         */
        <span className="index-detail" title={detail}>
          {detail}
        </span>
      )}
      {status.failed === 0 ? null : <span className="index-failed">{status.failed} failed</span>}
    </div>
  );
}
