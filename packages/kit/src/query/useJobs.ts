import type { JobList } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { JobsParams } from "../client/createCorpusClient.js";
import { canonicalFilter, jobsListKey } from "./keys.js";

/** `GET /api/jobs` — the console's job rows (SPEC.md §7). */
export function useJobs(params: JobsParams = {}): UseQueryResult<JobList, Error> {
  const client = useCorpusClient();
  const canonical = canonicalFilter(params);
  return useQuery({
    queryKey: jobsListKey(params as Record<string, unknown>),
    queryFn: ({ signal }) => client.listJobs(canonical as JobsParams, { signal }),
  });
}
