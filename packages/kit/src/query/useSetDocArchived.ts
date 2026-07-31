import type { DocMutationResponse } from "@corpus/contract";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import type { SettledCallbacks } from "./settledCallbacks.js";
import { invalidateDoc } from "./useUpdateDoc.js";

/**
 * `POST /api/docs/{id}/archive` and `POST /api/docs/{id}/unarchive` — the two
 * halves of SPEC.md §7's reversible organizational act, in one binding.
 *
 * **One hook because it is one decision**, taken at call time: the caller reads
 * the document's current status and asks for the other one, exactly as
 * `useSetThreadStatus` does for resolve/reopen. Two hooks would mean two
 * invalidation lists and two teardown stories for a single reversible flip.
 *
 * **Why not `useUpdateDoc({ status })`.** Only these routes run the server's
 * folder move, so only these routes archive a `type: skill` document in the
 * sense §7 means: its folder goes to `.claude/skills-archived/<name>/`, which
 * disables it and frees the name `corpus skill create` refuses to reuse
 * (SERVER-036). A `PUT` writes the frontmatter key and leaves the folder where
 * Claude Code still reads it. In the other direction the `PUT` does not exist at
 * all: SERVER-039 refuses a non-archived `status` on an archived document with a
 * `400` naming the unarchive route.
 *
 * Not optimistic, for `useUpdateDoc`'s reason: archiving is what removes a row
 * from the default lists, and that set is the server's to compute. The
 * authoritative state arrives through the invalidation and the server's own SSE
 * frame.
 */

/** Which document, and which way the flip goes. */
export interface DocArchiveVariables {
  readonly id: string;
  /** True archives, false restores. */
  readonly archived: boolean;
}

/**
 * `callbacks` are teardown-safe (see {@link SettledCallbacks}). The reader's ⋯
 * menu archives and closes in the same click, so a per-call `onSuccess` would be
 * dropped with the observer and the write would commit without a word (UI-012).
 */
export function useSetDocArchived(
  callbacks: SettledCallbacks<DocMutationResponse, DocArchiveVariables> = {},
): UseMutationResult<DocMutationResponse, Error, DocArchiveVariables> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  const { onSuccess, onError } = callbacks;

  return useMutation<DocMutationResponse, Error, DocArchiveVariables>({
    mutationFn: ({ id, archived }) => (archived ? client.archiveDoc(id) : client.unarchiveDoc(id)),
    onSuccess(response, variables) {
      invalidateDoc(queryClient, variables.id);
      onSuccess?.(response, variables);
    },
    onError(error, variables) {
      onError?.(error, variables);
    },
  });
}
