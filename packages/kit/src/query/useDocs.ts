import type { DocList } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { DocsFilter } from "../client/createCorpusClient.js";
import { canonicalFilter, docsListKey } from "./keys.js";

/**
 * `GET /api/docs` — the single collection query behind every list (SPEC.md
 * §9.2): board columns, the search overlay, Attention, and every autocomplete.
 *
 * The filter object is canonicalised into the cache key, so two callers with
 * logically identical filters share one cache entry and issue one request. Rows
 * are returned exactly as the contract types them, `snippets` included — the
 * FTS highlights UI-009 renders are never stripped here.
 */
export function useDocs(filter: DocsFilter = {}): UseQueryResult<DocList, Error> {
  const client = useCorpusClient();
  const canonical = canonicalFilter(filter);
  return useQuery({
    queryKey: docsListKey(filter as Record<string, unknown>),
    queryFn: ({ signal }) => client.listDocs(canonical as DocsFilter, { signal }),
  });
}
