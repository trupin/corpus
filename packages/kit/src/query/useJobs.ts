import type { JobList } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { JobsParams } from "../client/createCorpusClient.js";
import { canonicalFilter, jobsListKey } from "./keys.js";

export interface JobsQueryOptions {
  /**
   * False parks the query: no request is issued and no answer is read.
   *
   * For the caller that needs an exact `?originId=` answer only when the shared
   * outstanding query says its own list may be short (`useOutstandingJobs`) —
   * an unconditional per-asker query is the fan-out UI-075 exists to remove.
   */
  readonly enabled?: boolean | undefined;
}

/** `GET /api/jobs` — the console's job rows (SPEC.md §7). */
export function useJobs(
  params: JobsParams = {},
  options: JobsQueryOptions = {},
): UseQueryResult<JobList, Error> {
  const client = useCorpusClient();
  const canonical = canonicalFilter(params);
  return useQuery({
    queryKey: jobsListKey(params as Record<string, unknown>),
    queryFn: ({ signal }) => client.listJobs(canonical as JobsParams, { signal }),
    enabled: options.enabled ?? true,
  });
}
