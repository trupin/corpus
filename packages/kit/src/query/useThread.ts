import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient, usePendingTurnStore } from "../client/context.js";
import { threadKey } from "./keys.js";
import { mergePendingTurns, type ThreadView } from "./pendingTurns.js";

/**
 * `GET /api/threads/{id}` — one thread and its turns.
 *
 * Caches under the contract's `threadKey(id)`, i.e. `["threads", id]` — the key
 * the server names on thread creation, turn append, turn deletion,
 * resolve/reopen and mark-seen.
 *
 * The `queryFn` re-merges any still-unsettled optimistic turn (see
 * `pendingTurns.ts`). That is what makes an SSE invalidation arriving *between*
 * the optimistic write and the mutation settling harmless: the refetch replaces
 * cached data wholesale, and without this the user's own turn would vanish from
 * under them mid-send.
 */
export function useThread(id: string | undefined): UseQueryResult<ThreadView, Error> {
  const client = useCorpusClient();
  const pendingTurns = usePendingTurnStore();
  const threadId = id ?? "";
  return useQuery({
    queryKey: threadKey(threadId),
    queryFn: async ({ signal }) =>
      mergePendingTurns(await client.getThread(threadId, { signal }), pendingTurns.list(threadId)),
    enabled: threadId !== "",
  });
}
