import type { Doc } from "@corpus/contract";
import { useQuery, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import type { CorpusClient } from "../client/createCorpusClient.js";
import { useCorpusClient } from "../client/context.js";
import { docKey } from "./keys.js";

/**
 * The one definition of "read document `id`", so anything that reads a document
 * outside a single `useDoc` call — the scope walk's `useQueries`, for one —
 * shares this cache entry rather than registering a second `queryFn` under the
 * same key. Two functions on one key is not a type error and not a test failure;
 * it is a refetch that quietly answers differently from the mount.
 */
export function docQueryOptions(
  client: CorpusClient,
  id: string,
): UseQueryOptions<Doc, Error, Doc, readonly unknown[]> {
  return {
    queryKey: docKey(id),
    queryFn: ({ signal }) => client.getDoc(id, { signal }),
  };
}

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
    ...docQueryOptions(client, id ?? ""),
    enabled: id !== undefined && id !== "",
  });
}
