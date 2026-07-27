import type { LockList } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { LOCKS_KEY } from "./keys.js";

/** `GET /api/locks` — every active lock, for hydrating lock banners (SPEC.md §7). */
export function useLocks(): UseQueryResult<LockList, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: LOCKS_KEY,
    queryFn: ({ signal }) => client.listLocks({ signal }),
  });
}
