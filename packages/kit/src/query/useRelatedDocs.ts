import type { RelatedDocs } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { relatedKey } from "./keys.js";

/**
 * `GET /api/docs/{id}/related` — the ranked related set behind the reader's
 * related panel (SPEC.md §9.2, §10).
 *
 * Caches under `relatedKey(id)`, i.e. `["docs", id, "related"]`: under the
 * `["docs"]` prefix the server emits on every document and thread mutation, so
 * an SSE `invalidate` frame that already exists refreshes the panel, and no new
 * key name enters the closed contract vocabulary.
 *
 * `id` is optional, and an absent one disables the query rather than issuing a
 * request for `""` — the same shape as {@link useDoc} and {@link useThread}, so
 * a host with no open document makes no request.
 *
 * The response is returned exactly as the contract types it: every row's
 * `relation` (`linked`, `similar`, `both`) is the server's claim, and nothing
 * here re-ranks, filters or interprets which retrieval phase produced it.
 */
export function useRelatedDocs(id: string | undefined): UseQueryResult<RelatedDocs, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: relatedKey(id ?? ""),
    queryFn: ({ signal }) => client.relatedDocs(id ?? "", undefined, { signal }),
    enabled: id !== undefined && id !== "",
  });
}
