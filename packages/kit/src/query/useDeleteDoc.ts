import type { DeleteDocResult } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, docKey, threadKey } from "./keys.js";

/**
 * `DELETE /api/docs/{id}` — the one irreversible act in the product (SPEC.md
 * §7, §9.2), and **user-only**: the agent archives, never deletes.
 *
 * Not optimistic, and not even close. A document removed from the cache before
 * the server agreed would be a document the user believes is gone while it is
 * still on disk — and a `423` (someone holds the edit lock) or a `403` are both
 * ordinary answers here. The reader's confirmation is the guard; this hook's job
 * is to tell the truth about what happened afterwards.
 *
 * The threads named by the result become **orphaned records** rather than
 * disappearing, so their keys are invalidated too: a thread whose parent is gone
 * still renders, and it must stop claiming a parent it no longer has.
 */
export function useDeleteDoc(): UseMutationResult<DeleteDocResult, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<DeleteDocResult, Error, string>({
    mutationFn: (id) => client.deleteDoc(id),
    onSuccess(result, id) {
      void queryClient.invalidateQueries({ queryKey: docKey(id) });
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      for (const threadId of result.orphanedThreadIds) {
        void queryClient.invalidateQueries({ queryKey: threadKey(threadId) });
      }
    },
  });
}
