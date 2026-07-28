import type { DeleteTurnResult } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, docKey, threadKey } from "./keys.js";

/**
 * `DELETE /api/threads/{id}/turns/{ts}` — user-only turn deletion (SPEC.md §6).
 *
 * **Not optimistic, deliberately.** The delete cascades: the thread's last turn
 * takes the thread with it, and the thread takes its anchor entry out of the
 * parent's frontmatter. Which of those happened is in the *response*
 * (`deletedThread`, `removedAnchor`, `parentId`) and cannot be derived from the
 * client's copy of the conversation — an optimistic removal would have to guess,
 * and the guess it would make ("just this turn") is wrong exactly when the
 * consequence matters most.
 *
 * The invalidations follow the response rather than a fixed list: a deleted
 * thread is a deleted *document*, so its own `docKey` and the parent's both go,
 * and `["docs"]` drops every list that showed either.
 */
export function useDeleteTurn(
  threadId: string,
): UseMutationResult<DeleteTurnResult, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<DeleteTurnResult, Error, string>({
    mutationFn: (ts) => client.deleteTurn(threadId, ts),
    onSuccess(result) {
      void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
      void queryClient.invalidateQueries({ queryKey: docKey(threadId) });
      if (result.parentId !== null) {
        void queryClient.invalidateQueries({ queryKey: docKey(result.parentId) });
      }
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
    },
  });
}
