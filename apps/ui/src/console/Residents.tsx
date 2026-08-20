import { laneRows, useAgentsRoster, useWeightLevels } from "@corpus/kit";
import { useMemo, useState, type ReactElement } from "react";
import { useNowTick } from "../thread/useNowTick";
import { LaneList } from "./LaneList";
import { LaneScope } from "./LaneScope";
import { resolveSelectedLane } from "./residentsModel";

/**
 * **Who is resident, and what they own** — the console's Residents tab
 * (SPEC.md §7's roster and scope, §11's console; UI-125, asked for by the user
 * on 2026-08-19).
 *
 * It answers in one place the question the board answers a conversation at a
 * time: the lanes on the left, the selected lane's scope on the right, in the
 * job tab's master-detail so that one console has one shape.
 *
 * ## Why it is in the console at all
 *
 * §11 splits the surface: the board is the corpus, and the console is the
 * agent's own machinery — jobs, logs, the queue. A roster of running agents is
 * that machinery, and a lane's scope is what that machinery is pointed at, so
 * the pair belongs here rather than on a board column. What each *member* of a
 * scope is stays the board's: every row opens in a column.
 *
 * ## It holds a clock, and one selection
 *
 * The clock is the board badge's and the console pill's, at the same 15 s: a
 * lane's liveness expires without anything arriving — `isAgentPresent` treats a
 * `live: true` whose evidence has aged past the grace window as lapsed — so a
 * tab that repainted only on data would keep a green dot lit after an agent
 * walked away. The selection is browser-local and nothing else here is: the
 * roster and the scope are both ordinary cached reads behind the keys the server
 * names.
 */

export function Residents(): ReactElement {
  const now = useNowTick();
  const roster = useAgentsRoster();
  const levels = useWeightLevels();
  const [chosen, setChosen] = useState<string | null>(null);

  const lanes = roster.lanes;
  const rows = useMemo(
    () => (lanes === undefined ? undefined : laneRows(lanes, new Date(now))),
    [lanes, now],
  );

  const selectedLane = resolveSelectedLane(rows ?? [], chosen);
  const selected = rows?.find((row) => row.lane === selectedLane) ?? null;

  return (
    <>
      <LaneList rows={rows} levels={levels} selectedLane={selectedLane} onSelect={setChosen} />
      <LaneScope row={selected} levels={levels} />
    </>
  );
}
