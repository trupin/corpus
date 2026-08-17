import type { QueueStatus } from "@corpus/contract";
import { useEffect, useState, type ReactElement } from "react";
import { agentDotClass, agentPillText, agentState } from "./consoleModel";

/**
 * How often the pill re-reads the clock.
 *
 * Coarse on purpose, and the same 15 s the thread's pending indicator already
 * ticks at — nothing here changes faster than the grace window, which is 960 s
 * (`AGENT_PRESENCE_WINDOW_SECONDS`), so this bounds the lag on a departure at
 * under 2% of it while costing one `setState` a minute and **no request at all**.
 * A tick that tried to be precise would be a poller in everything but name.
 */
const TICK_MS = 15_000;

/**
 * The agent-status pill — and, per SPEC.md §11, the **only** place agent or
 * system status appears. Nothing agent-related belongs in the top bar.
 *
 * ## What it says
 *
 * Four states, and §11's own precedence between them, taken whole from the
 * contract (`agentActivity`, CONTRACT-045) rather than derived here:
 *
 * - **`halted`** while the sentinel is set — it outranks everything, because
 *   nothing further is claimed and an in-flight job finishing does not make the
 *   agent working again.
 * - **`disconnected`** when no listener is parked: nobody is there. It outranks
 *   `working`, since `inProgress > 0` is a fact about *events* and an agent that
 *   claimed work and died leaves that count standing forever.
 * - **`working`** when somebody is there and holds work.
 * - **`idle`** when somebody is there and holds none — a claim with evidence
 *   behind it, which is the whole of UI-098: it used to be the else-branch, so a
 *   machine with no agent running at all reported an agent with nothing to do.
 *
 * A fifth, **`unknown`**, is what it says before `GET /api/queue/status` has
 * answered. That is not a state of the agent; it is the absence of an answer,
 * and it is here because the other four are each a claim this component would
 * otherwise be making on no evidence. The reachability notice two spans to the
 * right is the fact that *is* true then.
 *
 * The dot pulses only for `working`, which is why the pulse means something;
 * `disconnected` is deliberately not dressed as a failure (§11: with no agent
 * running it is simply the truth).
 *
 * ## Why it holds a clock
 *
 * Presence expires. `isAgentPresent` withdraws a `live: true` whose evidence has
 * aged past the grace window, so a pill that only re-rendered when new data
 * arrived would sit on `idle` for as long as nothing else happened — which is
 * UI-098's bug with extra steps, since an agent walking away *is* nothing else
 * happening: it produces no queue transition and therefore no `["queue"]`
 * invalidation. The tick costs nothing (no fetch, one component) and re-reads a
 * verdict already in cache. It can only ever *withdraw* presence, never
 * manufacture it, so a skewed local clock cannot make this pill claim more than
 * the server did.
 *
 * Deliberately *not* `role="status"`: the strip's reachability notice already
 * holds that role, and a second live region in the same line would make "the
 * console says" ambiguous to a screen reader and to `getByRole` alike. The
 * pill's text is read as ordinary content, which is what it is.
 */
export function AgentPill({
  status,
}: {
  /**
   * The queue status, or `undefined` while the server has not answered.
   *
   * **Never `UNKNOWN_QUEUE_STATUS`.** That placeholder exists for the counts,
   * whose zeroes are true of a server that is not there; its `agent` field is a
   * required value with nothing behind it, and reading it here would turn "we
   * have not heard" into "nobody is connected".
   */
  readonly status: QueueStatus | undefined;
}): ReactElement {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const at = new Date(now);
  const state = agentState(status, at);

  return (
    <span className="agent-pill" data-agent-state={state}>
      <span className={agentDotClass(state)} aria-hidden="true" />
      <span>{agentPillText(status, at)}</span>
    </span>
  );
}
