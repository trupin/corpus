import type { QueueStatus } from "@corpus/contract";
import type { ReactElement } from "react";
import { agentPillText, agentState } from "./consoleModel";

/**
 * The agent-status pill — and, per SPEC.md §11, the **only** place agent or
 * system status appears. Nothing agent-related belongs in the top bar.
 *
 * Its state is derived from the queue status the counts beside it already read,
 * so there is no second poller and no separate endpoint: `working` while
 * something is in progress, `halted` while the sentinel is set, `idle`
 * otherwise. The dot pulses only for `working`, which is why the pulse means
 * something.
 *
 * Deliberately *not* `role="status"`: the strip's reachability notice already
 * holds that role, and a second live region in the same line would make "the
 * console says" ambiguous to a screen reader and to `getByRole` alike. The
 * pill's text is read as ordinary content, which is what it is.
 */
export function AgentPill({ status }: { readonly status: QueueStatus }): ReactElement {
  const state = agentState(status);
  const dotClass = state === "working" ? "dot busy" : state === "halted" ? "dot halted" : "dot";

  return (
    <span className="agent-pill" data-agent-state={state}>
      <span className={dotClass} aria-hidden="true" />
      <span>{agentPillText(status)}</span>
    </span>
  );
}
