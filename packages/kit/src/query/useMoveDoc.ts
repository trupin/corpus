import type { DocMutationResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { TREE_KEY } from "./keys.js";
import type { SettledCallbacks } from "./settledCallbacks.js";
import { invalidateDoc } from "./useUpdateDoc.js";

/**
 * `POST /api/docs/{id}/move` — relocation, and only relocation (SPEC.md §9.2),
 * behind the explorer's "Move to folder…".
 *
 * **The id never changes**, so nothing that points at this document has to be
 * rewritten: `[[ref]]`s, anchors and thread `parent`s all keep resolving, and
 * the projection re-maps id → path. What does change is where every list puts
 * it, which is why the invalidation is the document's own key, the collection
 * key **and the tree** — a move is the one document write that changes the
 * folder counts `GET /api/tree` reports, and a tree left stale would keep
 * drawing the document under the folder it just left.
 *
 * **Not optimistic**, for `useUpdateDoc`'s reason: the destination is the
 * server's to resolve — a bare name and the full `data/docs/` prefix mean the
 * same folder, and an occupied destination is refused rather than overwritten —
 * so the path a client guessed could be a path that does not exist.
 *
 * `callbacks` are teardown-safe ({@link SettledCallbacks}): the menu item that
 * starts this write closes the menu in the same click, and a per-call
 * `onSuccess` would be dropped with the observer (UI-012).
 */

/** Which document, and the folder it is going to. */
export interface MoveDocVariables {
  readonly id: string;
  /**
   * Under `data/docs/`, bare (`finance`) or fully spelled (`data/docs/finance`).
   * Required: a move names where the document is going.
   */
  readonly folder: string;
}

export function useMoveDoc(
  callbacks: SettledCallbacks<DocMutationResponse, MoveDocVariables> = {},
): UseMutationResult<DocMutationResponse, Error, MoveDocVariables> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const { onSuccess, onError } = callbacks;

  return useMutation<DocMutationResponse, Error, MoveDocVariables>({
    mutationFn: ({ id, folder }) => client.moveDoc(id, folder),
    onSuccess(response, variables) {
      invalidateDoc(queryClient, variables.id);
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      onSuccess?.(response, variables);
    },
    onError(error, variables) {
      onError?.(error, variables);
    },
  });
}
