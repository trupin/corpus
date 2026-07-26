import type { Health } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { uiClient } from "../app/apiClient";

export const healthQueryKey = ["health"] as const;

/**
 * The one request UI-001 makes. It is a liveness probe, not data: its only job
 * is to let the console strip say something true about the server. A failure
 * therefore has to stay inside the query — the shell renders either way.
 */
export function useHealth(): UseQueryResult<Health, Error> {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: async (): Promise<Health> => {
      const { data, error, response } = await uiClient.api.GET("/api/health", {});
      if (data === undefined) {
        throw new Error(
          `Health check failed (HTTP ${String(response.status)}): ${JSON.stringify(error ?? null)}`,
        );
      }
      return data;
    },
  });
}
