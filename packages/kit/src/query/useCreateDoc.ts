import type { DocMutationResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { CreateDocInput } from "../client/createCorpusClient.js";
import { DOCS_KEY, TREE_KEY } from "./keys.js";

/**
 * `POST /api/docs` — zero-form creation (SPEC.md §10), and the call that pins a
 * board column (a column IS a `type: view` document with `pinned: true`).
 *
 * **Not optimistic**, for the same reason as `useUpdateDoc`: the server assigns
 * the id, the path, the timestamps and — for a creation from a template — the
 * body. A cache entry written from the request would be a different document
 * from the one on disk, and the board would then be reordering a row the corpus
 * has never heard of. The created document arrives through the invalidation
 * below and the server's own SSE frame.
 *
 * The folder tree is invalidated too: a creation can bring a folder into
 * existence, and the new-list picker reads its folder options from `useTree`.
 */
export function useCreateDoc(): UseMutationResult<DocMutationResponse, Error, CreateDocInput> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<DocMutationResponse, Error, CreateDocInput>({
    mutationFn: (input) => client.createDoc(input),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
    },
  });
}
