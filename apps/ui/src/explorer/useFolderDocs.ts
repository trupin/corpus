import { useDocs } from "@corpus/kit";
import { useMemo } from "react";
import { EXPLORER_FOLDER_LIMIT, type FolderDocs } from "./treeRows";

/**
 * One expanded folder's documents (SPEC.md §10, rider 1).
 *
 * **One hook instance per expanded folder, mounted by a component per folder.**
 * React forbids calling a hook in a loop, and the alternative — one query for
 * the whole corpus, filtered client-side — is exactly the enumeration §7
 * forbids. So `FolderDocsProbe` below is a component that renders nothing and
 * reports one folder's answer upward, and the tree mounts one per open folder.
 * A collapsed folder mounts none, so a collapsed tree costs one request (the
 * folder tree itself) and no more.
 *
 * **Bounded, and the bound is stated.** `limit` is
 * {@link EXPLORER_FOLDER_LIMIT}; `page.total` is what the query matched
 * regardless, and the tree draws a line when the two differ. A capped list
 * presented as complete is the failure §10's rule exists to prevent.
 *
 * **`includeArchived` — the one list that shows them.** Rider 1: "archived
 * documents stay in the tree, marked". Every other list in the product excludes
 * them by the collection route's default, so this is the single place that opts
 * back in, and the rows say so.
 */

export function useFolderDocs(folder: string): FolderDocs {
  const query = useDocs({
    folder,
    includeArchived: true,
    limit: EXPLORER_FOLDER_LIMIT,
    sort: "title",
  });

  const items = query.data?.items;
  const total = query.data?.page.total;
  const message = query.error?.message ?? null;
  const isPending = query.isPending;

  return useMemo<FolderDocs>(
    () => ({
      items: items ?? [],
      // With no answer yet there is nothing to compare a length against, so the
      // bound line cannot fire early: `0 < 0` is false.
      total: total ?? 0,
      isPending,
      error: message,
    }),
    [isPending, items, message, total],
  );
}
