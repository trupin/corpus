import type { Health } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { HEALTH_KEY } from "./keys.js";

/**
 * `GET /api/health` — the console strip's liveness probe (SPEC.md §11).
 *
 * A probe, not data: its only job is to let the strip say something true about
 * the server, so a failure stays inside the query and the shell renders either
 * way. Nothing server-side ever invalidates {@link HEALTH_KEY}; the SSE bridge
 * does it, on every drop and every reconnect, which is what stops the strip
 * from reporting a version for a server that died — or "unreachable" for one
 * that came back.
 */
export function useHealth(): UseQueryResult<Health, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: HEALTH_KEY,
    queryFn: ({ signal }) => client.getHealth({ signal }),
  });
}
