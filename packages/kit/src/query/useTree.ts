import type { FolderTree } from "@corpus/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { TREE_KEY } from "./keys.js";

/** `GET /api/tree` — the `data/docs/` folder hierarchy behind the folder picker. */
export function useTree(): UseQueryResult<FolderTree, Error> {
  const client = useCorpusClient();
  return useQuery({
    queryKey: TREE_KEY,
    queryFn: ({ signal }) => client.getTree({ signal }),
  });
}
