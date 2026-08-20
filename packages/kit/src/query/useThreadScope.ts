import { ORCHESTRATOR_LANE, type ScopeMember, type ThreadScope } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { threadScopeKey } from "./keys.js";

/**
 * `GET /api/threads/{id}/scope` — **what one lane owns** (SPEC.md §7,
 * CONTRACT-068), as the console's Residents tab reads it (UI-125).
 *
 * ## It consumes the walk; it never repeats it
 *
 * Membership is computed server-side, per request, by the identical `walkScope`
 * the queue routes with. So this hook fetches and caches, and derives nothing:
 * no filtering, no re-ordering, no second opinion about which edge a member
 * reached the scope by. `packages/kit/src/recipient/scopeWalk.ts` records what
 * one rule with two implementations cost — a composer that named the wrong
 * agent while both suites were green — and the cheapest way not to repeat it is
 * to have nothing here to disagree with.
 *
 * ## An ordinary cached read, like the roster beside it
 *
 * Cached under {@link threadScopeKey}, which sits under the `["docs"]` prefix
 * the server names on every document and thread mutation — which is what a
 * scope's membership actually moves on. No poll, no `staleTime` override and no
 * refetch-on-open, for `useAgentsRoster`'s reason: a surface that worked around
 * a missing invalidation would hide it, and the workaround would outlive the bug.
 *
 * ## Absence is not emptiness
 *
 * {@link ThreadScopeView.members} is `undefined` until the server has answered,
 * never `[]` — an empty listing would be a scope not even containing its own
 * root thread, which the contract says is impossible (`members[0]` is the root),
 * so a caller treating "not yet" as "nothing" would assert an absence out of an
 * answer it has not received (UI-098). {@link ThreadScopeView.truncated} is
 * `undefined` in the same window and for the same reason: *the list is complete*
 * is a claim, and a page nobody has read yet does not support it.
 *
 * The `Array.isArray` guard is that care against a real failure mode rather than
 * a theory — every test transport in this repo falls through to `json({})` for a
 * route it does not know, so the first surface to read a new field turns a silent
 * stub gap into a `TypeError` in a component that always renders.
 *
 * ## The orchestrator's lane is not a scope, and is never asked about
 *
 * §7 defines scope only for a designated thread: everything outside every scope
 * falls on the orchestrator's lane, so the contract answers `409` there rather
 * than inventing an empty scope. Passing `ORCHESTRATOR_LANE` — or `null` — is
 * therefore not a request at all. A surface showing that lane says what the lane
 * means instead of rendering an empty list.
 */

export interface ThreadScopeView {
  /**
   * Every member the server listed, root first, or `undefined` while it has not
   * answered (or answered with something that is not a listing). Never `[]` for
   * "not yet".
   */
  readonly members: readonly ScopeMember[] | undefined;
  /**
   * Whether the page was cut at the contract's bound (`SCOPE_PAGE_SIZE`), or
   * `undefined` while nothing has said. A surface that hides a `true` here is
   * showing a capped list as a complete one.
   */
  readonly truncated: boolean | undefined;
  /** The underlying query, for a caller that needs its error or fetch state. */
  readonly query: UseQueryResult<ThreadScope, Error>;
}

export function useThreadScope(threadId: string | null): ThreadScopeView {
  const client = useCorpusClient();
  const lane = threadId === null || threadId === ORCHESTRATOR_LANE ? "" : threadId;
  const query = useQuery({
    queryKey: threadScopeKey(lane),
    queryFn: ({ signal }) => client.getThreadScope(lane, { signal }),
    enabled: lane !== "",
  });
  const members: unknown = query.data?.members;
  const truncated: unknown = query.data?.truncated;
  return {
    members: Array.isArray(members) ? (members as readonly ScopeMember[]) : undefined,
    truncated: typeof truncated === "boolean" ? truncated : undefined,
    query,
  };
}
