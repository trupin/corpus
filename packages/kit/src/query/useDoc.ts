import type { Doc } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { docKey } from "./keys.js";

/**
 * `GET /api/docs/{id}` — one document, for an open reader.
 *
 * Caches under the contract's `docKey(id)`, i.e. `["docs", id]`. That is the
 * key the server names when the document changes, and it sits under the
 * `["docs"]` prefix every document mutation also emits.
 */
export function useDoc(id: string | undefined): UseQueryResult<Doc, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: docKey(id ?? ""),
    queryFn: ({ signal }) => client.getDoc(id ?? "", { signal }),
    enabled: id !== undefined && id !== "",
  });
}
