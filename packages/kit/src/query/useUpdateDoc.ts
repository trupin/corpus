import type { UpdateDocResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { UpdateDocChanges } from "../client/createCorpusClient.js";
import { DOCS_KEY, docKey } from "./keys.js";

/**
 * `PUT /api/docs/{id}` — the one document write the board performs (SPEC.md §9.2).
 *
 * Deliberately **not optimistic**. `useAppendTurn` is, because a turn the user
 * just typed is content the client already holds and the server only echoes.
 * This is the opposite: every caller here changes state the server derives
 * (`status: archived` removes the row from the default lists; `reviewed` resets
 * a staleness tier the server, not the client, computes — SERVER-015). Writing
 * a guess into the cache would make the row claim a level the server has not
 * agreed to, which is exactly the two-sources-of-truth failure SPEC.md §5's
 * "still current" is fragile to. The authoritative state arrives through the
 * invalidation below and the server's own SSE frame.
 *
 * The visual transition (a row sliding out before it disappears) is the caller's
 * and stays in the component — a CSS class, not cache state.
 */
export function useUpdateDoc(
  docId: string,
): UseMutationResult<UpdateDocResponse, Error, UpdateDocChanges> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<UpdateDocResponse, Error, UpdateDocChanges>({
    mutationFn: (changes) => client.updateDoc(docId, changes),
    onSuccess() {
      // The server's own `invalidate` frame covers a connected client; doing it
      // here too keeps the mutation correct when the stream is down, which is
      // exactly when a user is most likely to be retrying.
      void queryClient.invalidateQueries({ queryKey: docKey(docId) });
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
    },
  });
}
