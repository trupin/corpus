import type { QueueStatus } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { QUEUE_KEY } from "./keys.js";

/**
 * `GET /api/queue/status` — everything the console strip needs from one call
 * (SPEC.md §7, §11): the halted flag, the queue depth, and the per-status
 * counts the strip renders.
 *
 * Cached under `QUEUE_KEY` itself rather than a filtered sub-key: the endpoint
 * takes no parameters, and `QUEUE_KEY` is exactly what the server names in its
 * `invalidate` frame on every queue transition — so the strip goes stale the
 * moment a claim, a completion, a failure or a halt lands, with no poller.
 * A halt set by `corpus queue halt` from a terminal reaches the UI this way.
 */
export function useQueueStatus(): UseQueryResult<QueueStatus, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: QUEUE_KEY,
    queryFn: ({ signal }) => client.getQueueStatus({ signal }),
  });
}
