import type { IndexStatus } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { INDEX_KEY } from "./keys.js";

/**
 * `GET /api/index/status` — the semantic index's counts, recorded identity and
 * derived state, which is everything the console strip's index pill and its
 * expanded status row render (SPEC.md §9.1, §11's index-pill rider).
 *
 * Cached under `INDEX_KEY` itself, for {@link useQueueStatus}'s reason: the
 * endpoint takes no parameters, and `["index"]` is exactly the key the embed
 * worker names in its `invalidate` frames — provider adoption, a new disabled or
 * download reason, throttled progress while a backlog drains, and the caught-up
 * transition, plus a rebuild's start and end. So the pill's counts climb as the
 * worker drains **and there is no poller**: `refetchInterval` is deliberately
 * absent, because an indexing backlog can last minutes and a UI that polled
 * through it would spend the whole time asking a question the server has already
 * promised to answer.
 *
 * The response is returned exactly as the contract types it. In particular
 * `detail` is the server's sentence, to be rendered and never parsed — `state`
 * is the field a surface is allowed to branch on.
 */
export function useIndexStatus(): UseQueryResult<IndexStatus, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: INDEX_KEY,
    queryFn: ({ signal }) => client.getIndexStatus({ signal }),
  });
}
