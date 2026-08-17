import { LaneDot, useLaneRow } from "@corpus/kit";
import type { ReactElement } from "react";
import { useNowTick } from "./useNowTick";

/**
 * **Who is resident here, and whether they are there** — SPEC.md §11's board
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
 */

export interface ResidentBadgeProps {
  /** The conversation this badge is on — a lane's name is a thread id (SPEC.md §7). */
  readonly threadId: string;
}

export function ResidentBadge({ threadId }: ResidentBadgeProps): ReactElement | null {
  const now = useNowTick();
  const row = useLaneRow(threadId, new Date(now));
  if (row === undefined) return null;

  return (
    <span
      className="t-resident"
      data-resident-lane={row.lane}
      data-resident-liveness={row.liveness}
      /*
       * The line is beside the name *and* on the title, rather than only on the
       * title: §11 wants what a lapse means readable without a pointer, and a
       * hover is not available to a keyboard at all. The title repeats it for
       * the truncated case, where the line is elided by width.
       */
      title={row.line === "" ? row.name : `${row.name} — ${row.line}`}
    >
      <LaneDot liveness={row.liveness} />
      <span className="t-resident-name">{row.name}</span>
      {row.line === "" ? null : <span className="t-resident-line">{row.line}</span>}
    </span>
  );
}
