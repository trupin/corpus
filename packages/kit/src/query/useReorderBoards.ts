import type { ReorderBoardsResult } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, docKey } from "./keys.js";

/**
 * `POST /api/boards/order` — the board bar, in one act and one commit (SPEC.md
 * §10, rider 2).
 *
 * **One mutation, not a loop of `useUpdateDocById`.** Hooks cannot be called in
 * a loop, which is why the late-bound update hook exists at all — but the real
 * reason the loop is gone is git: §4's commit window folds one party's editing
 * session on one document, so a `PUT` per board is a commit per board, and
 * reverting "the reorder" stops being one revert. The route is what makes it one
 * (CONTRACT-080).
 *
 * **Not optimistic**, for the reason every other document write here is not: the
 * server decides which boards it actually had to write, and a cache patched with
 * a guess would claim positions the corpus has not agreed to. The authoritative
 * order arrives through the invalidation below and the server's own SSE frame.
 *
 * The ids invalidated come from the **result**, which names every board the
 * request covered — including the ones already at their number, whose rows a
 * caller is showing just the same.
 */
export function useReorderBoards(): UseMutationResult<
  ReorderBoardsResult,
  Error,
  readonly string[]
> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<ReorderBoardsResult, Error, readonly string[]>({
    mutationFn: (boards) => client.reorderBoards(boards),
    onSuccess(result) {
      void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
      for (const board of result.boards) {
        void queryClient.invalidateQueries({ queryKey: docKey(board.id) });
      }
    },
  });
}
