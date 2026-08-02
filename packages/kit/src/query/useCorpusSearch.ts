import type { SearchResults } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { SearchParams } from "../client/createCorpusClient.js";
import { canonicalFilter, searchKey } from "./keys.js";

/**
 * `GET /api/search` — ranked retrieval (SPEC.md §9.1, §9.2), behind the ⌘K
 * overlay.
 *
 * Deliberately **not** {@link useDocs} with a `q`: the two endpoints answer
 * different questions with different payloads, and which one a surface reads
 * from is a product decision rather than a parameter. Interactive search is
 * ranked and returns one-line hits; saved views and board columns stay filtered
 * lists on `GET /api/docs`, because relevance ranking is a property of the
 * search box and not of a persisted document (SPEC.md §11).
 *
 * Caches under `searchKey(params)` — `["docs", "search", { …canonical params }]`
 * — so two spellings of one query share a cache entry and one request, and the
 * whole set is invalidated by the `["docs"]` frames the server already emits on
 * every mutation.
 *
 * **An empty query is not a search.** `q` is required by the contract and an
 * empty one is a `400`, so a caller passing `undefined` — or a query whose `q`
 * is blank — issues no request at all. That is the honest reading of an open
 * overlay with nothing typed in it: there is no ranking of everything.
 */
export function useCorpusSearch(
  params: SearchParams | undefined,
): UseQueryResult<SearchResults, Error> {
  const client = useCorpusClient();
  const enabled = params !== undefined && params.q.trim() !== "";
  const canonical = canonicalFilter(params ?? {}) as SearchParams;
  return useQuery({
    queryKey: searchKey(params ?? {}),
    queryFn: ({ signal }) => client.searchCorpus(canonical, { signal }),
    enabled,
  });
}
