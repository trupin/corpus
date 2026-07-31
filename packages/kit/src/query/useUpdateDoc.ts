import type { UpdateDocResponse } from "@corpus/contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { UpdateDocChanges } from "../client/createCorpusClient.js";
import { DOCS_KEY, docKey } from "./keys.js";
import type { SettledCallbacks } from "./settledCallbacks.js";

/**
 * `PUT /api/docs/{id}` — the document write, in two bindings (SPEC.md §9.2).
 *
 * Both are deliberately **not optimistic**. `useAppendTurn` is, because a turn
 * the user just typed is content the client already holds and the server only
 * echoes. This is the opposite: every caller here changes state the server
 * derives (`status: archived` removes the row from the default lists;
 * `reviewed` resets a staleness tier the server, not the client, computes —
 * SERVER-015; `order` decides a column's board position after the server has
 * applied its own tiebreak). Writing a guess into the cache would make the row
 * claim a state the server has not agreed to, which is exactly the
 * two-sources-of-truth failure SPEC.md §5's "still current" is fragile to. The
 * authoritative state arrives through the invalidation below and the server's
 * own SSE frame.
 *
 * The visual transition (a row sliding out, a column following the pointer)
 * stays in the component — a CSS class, not cache state.
 */

/**
 * Shared so the bindings cannot drift about what a doc write invalidates.
 *
 * Exported (module-internally — it is not on the kit's public surface) so
 * `useSetDocArchived` answers the same question the same way: archiving is a
 * different *route*, not a different kind of write, and two invalidation lists
 * that agree on the day they were written is how a board column stops updating.
 */
export function invalidateDoc(queryClient: QueryClient, docId: string): void {
  // The server's own `invalidate` frame covers a connected client; doing it
  // here too keeps the mutation correct when the stream is down, which is
  // exactly when a user is most likely to be retrying.
  void queryClient.invalidateQueries({ queryKey: docKey(docId) });
  void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
}

/**
 * `callbacks` are the **teardown-safe** ones (see {@link SettledCallbacks}): a
 * caller that closes its own surface on click — the reader's ⋯ menu — has no
 * observer left to receive a per-call `onSuccess`, and would commit the write
 * in silence.
 */
export function useUpdateDoc(
  docId: string,
  callbacks: SettledCallbacks<UpdateDocResponse, UpdateDocChanges> = {},
): UseMutationResult<UpdateDocResponse, Error, UpdateDocChanges> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const { onSuccess, onError } = callbacks;

  return useMutation<UpdateDocResponse, Error, UpdateDocChanges>({
    mutationFn: (changes) => client.updateDoc(docId, changes),
    onSuccess(response, changes) {
      invalidateDoc(queryClient, docId);
      onSuccess?.(response, changes);
    },
    onError(error, changes) {
      onError?.(error, changes);
    },
  });
}

/** Which document to write, when the caller only knows at call time. */
export interface UpdateDocVariables {
  readonly id: string;
  readonly changes: UpdateDocChanges;
}

/**
 * The late-bound form: the document id rides in the variables.
 *
 * It exists because a board reorder writes *several* documents from one
 * gesture, and hooks cannot be called in a loop — `useUpdateDoc(id)` can only
 * ever address the id it was mounted with. Same route, same invalidation, no
 * second convention.
 */
export function useUpdateDocById(): UseMutationResult<
  UpdateDocResponse,
  Error,
  UpdateDocVariables
> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();

  return useMutation<UpdateDocResponse, Error, UpdateDocVariables>({
    mutationFn: ({ id, changes }) => client.updateDoc(id, changes),
    onSuccess(_data, variables) {
      invalidateDoc(queryClient, variables.id);
    },
  });
}
