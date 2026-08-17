import type { AgentLane, AgentRoster } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { AGENTS_KEY } from "./keys.js";

/**
 * `GET /api/agents` — SPEC.md §7's roster, as one query the whole app shares.
 *
 * ## An ordinary cached read, and deliberately nothing cleverer
 *
 * §7 is explicit that *"who is running is a read, never a push: the roster and
 * each lane's liveness are read behind the ordinary invalidate keys, like any
 * other projection"*. So this is `useQuery` under {@link AGENTS_KEY} and that is
 * the whole mechanism: the server names `["agents"]` over SSE, the bridge
 * invalidates, this refetches. There is **no poll, no `staleTime: 0`, and no
 * refetch-on-open**, and their absence is load-bearing rather than an oversight
 * — a surface that worked around a missing invalidation would hide the missing
 * invalidation, and the workaround would outlive the bug by years. A lane that
 * changes without an `["agents"]` frame is a server issue and is reported as
 * one (SERVER-115).
 *
 * ## Absence is not emptiness
 *
 * {@link AgentRosterView.lanes} is `undefined` until the server has answered,
 * never `[]`. The distinction is the whole of UI-098's rule read at this grain:
 * an empty roster would be a workspace with no lanes at all, which the contract
 * says is impossible (the orchestrator's row is unconditional), so a caller that
 * treated "not yet" as "none" would be asserting an absence from an answer it
 * has not received. Every consumer here renders the static default and offers no
 * alternatives while it is `undefined`.
 *
 * The `Array.isArray` guard is the other half of the same care, and it is there
 * because of a fixture, not a theory: every test transport in this repo falls
 * through to `json({})` for a route it does not know, so the first surface to
 * read a new field turns a silent stub gap into a `TypeError` in a component
 * that always renders (UI-098, `boardFixture`). A malformed answer degrades to
 * *unknown* here rather than to a crash in a composer.
 */

export interface AgentRosterView {
  /**
   * Every lane the server named, or `undefined` while it has not answered (or
   * answered with something that is not a roster). Never `[]` for "not yet".
   */
  readonly lanes: readonly AgentLane[] | undefined;
  /** The underlying query, for a caller that needs its error or fetch state. */
  readonly query: UseQueryResult<AgentRoster, Error>;
}

export function useAgentsRoster(): AgentRosterView {
  const client = useCorpusClient();
  const query = useQuery({
    queryKey: AGENTS_KEY,
    queryFn: ({ signal }) => client.getAgentRoster({ signal }),
  });
  const agents: unknown = query.data?.agents;
  return { lanes: Array.isArray(agents) ? (agents as readonly AgentLane[]) : undefined, query };
}
