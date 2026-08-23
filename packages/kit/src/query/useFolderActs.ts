import type { DeleteFolderResult, FolderStatusResult, RenameFolderResult } from "@corpus/contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCorpusClient } from "../client/context.js";
import { DOCS_KEY, TREE_KEY, docKey, threadKey } from "./keys.js";

/**
 * The four folder acts (SPEC.md §9.2, rider 7), bound for the explorer's folder
 * menu (§10, rider 1).
 *
 * **Four hooks and not one**, for the reason the contract declares four routes:
 * the three result shapes differ, only delete is user-only, and only rename can
 * conflict. A single hook taking a verb would have had to publish the union of
 * all of that at every call site.
 *
 * **What every one of them invalidates, and why it is the same list.** A folder
 * act moves or flips documents the caller never named — threads inherit their
 * parent's folder (§6) — so the collection key goes, the tree key goes (a rename
 * and a delete both change the hierarchy; an archive does not, and paying one
 * refetch for a uniform rule is cheaper than a stale tree after the one act that
 * moves things), and each named document's own key goes. The ids come from the
 * response rather than from a guess: `documents` is the state *after* the act,
 * which is exactly the set whose cached rows are now wrong.
 *
 * **Nothing here writes the cache in place.** The results carry enough to patch
 * a row — a new path, a new status — and patching would be a second
 * implementation of what the server just decided. The server is the sole writer
 * (Architecture Decision 2) and the refetch is what agrees with it.
 *
 * **A refused document is absent from the response rather than reported**
 * (CONTRACT-078, open): a caller counting `documents` is counting what changed,
 * never what it asked for. No hook here narrates on the caller's behalf, so the
 * sentence a surface shows is the surface's to write honestly.
 */

/** Every key a folder act can have made stale, invalidated in one place. */
function invalidateFolderAct(
  queryClient: QueryClient,
  documents: readonly { readonly id: string }[],
): void {
  void queryClient.invalidateQueries({ queryKey: DOCS_KEY });
  void queryClient.invalidateQueries({ queryKey: TREE_KEY });
  for (const document of documents) {
    void queryClient.invalidateQueries({ queryKey: docKey(document.id) });
    // A thread's own key is a different key from its document row's, and a
    // folder act moves threads it was never asked about (§6).
    void queryClient.invalidateQueries({ queryKey: threadKey(document.id) });
  }
}

/** Where the folder is now, and where it is going. A rename names both. */
export interface RenameFolderVariables {
  readonly from: string;
  readonly to: string;
}

/**
 * `POST /api/folders/rename` — moves `data/docs/<from>` to `data/docs/<to>`,
 * carrying every document and thread under it. **Ids never change.**
 *
 * `409` when `to` already exists: a rename never merges two folders. `404` when
 * `from` names no folder — compared byte for byte, so `FINANCE` is a `404` in a
 * workspace holding `finance` (SERVER-136).
 */
export function useRenameFolder(): UseMutationResult<
  RenameFolderResult,
  Error,
  RenameFolderVariables
> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  return useMutation<RenameFolderResult, Error, RenameFolderVariables>({
    mutationFn: ({ from, to }) => client.renameFolder(from, to),
    onSuccess(result) {
      invalidateFolderAct(queryClient, result.documents);
    },
  });
}

/**
 * `POST /api/folders/archive` and `/unarchive` — one hook, because it is one
 * reversible decision taken at call time, exactly as {@link useSetDocArchived}
 * treats the single-document flip.
 *
 * **It moves nothing**: archiving a folder is a status act, so every path is
 * unchanged and the folder stays in the tree. The result lists **every**
 * document under the folder, including ones already in the target status,
 * because the act applied to them (SERVER-136).
 */
export interface FolderArchiveVariables {
  readonly path: string;
  /** True archives, false restores. */
  readonly archived: boolean;
}

export function useSetFolderArchived(): UseMutationResult<
  FolderStatusResult,
  Error,
  FolderArchiveVariables
> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  return useMutation<FolderStatusResult, Error, FolderArchiveVariables>({
    mutationFn: ({ path, archived }) =>
      archived ? client.archiveFolder(path) : client.unarchiveFolder(path),
    onSuccess(result) {
      invalidateFolderAct(queryClient, result.documents);
    },
  });
}

/**
 * `POST /api/folders/delete` — user-only, like deleting a document, and the
 * only act here that cannot be undone by running its inverse.
 *
 * **It does not remove the folder's threads.** They survive as orphaned records
 * naming a deleted parent, and the response does not name them (SERVER-136), so
 * every thread key would have to be invalidated blindly to catch them —
 * `DOCS_KEY` is what actually repaints the lists, and a thread open in a reader
 * refetches on its own next read. It also leaves the folder itself behind when
 * something that is not a document is still in it, which is why the tree key
 * goes too rather than the caller assuming the row has gone.
 */
export function useDeleteFolder(): UseMutationResult<DeleteFolderResult, Error, string> {
  const client = useCorpusClient();
  const queryClient = useQueryClient();
  return useMutation<DeleteFolderResult, Error, string>({
    mutationFn: (path) => client.deleteFolder(path),
    onSuccess(result) {
      invalidateFolderAct(queryClient, result.documents);
    },
  });
}
