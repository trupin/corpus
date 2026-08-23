import { useCreateDoc } from "@corpus/kit";
import { useCallback } from "react";
import { describeQuery, toViewFrontmatter, type SearchQuery } from "../search/searchQuery";
import { useBoardSurface } from "./BoardsProvider";
import { columnRequest } from "./newList";
import { useColumns } from "./useColumns";
import { sameQuery as sameCompiledQuery } from "./viewDoc";

/**
 * "Save as view" — adding the current search to the showing board (SPEC.md §10).
 *
 * There is no board-layout API to call. A column is a `type: view` document
 * **listed by a board document**, so saving a search is two writes: one
 * `POST /api/docs` writing the search into the view's `query` frontmatter, and
 * one `PUT` appending its id to the board's `columns`. The column then appears
 * because both queries refetch — which is also why it is there in a second
 * browser, survives a reload, and is visible to the agent as two files.
 *
 * The create body is built by `columnRequest`, the same function the new-list
 * picker uses. Two ways to create a column would be two places for the §10 view
 * keys to drift.
 */

export interface SaveAsViewResult {
  /** The new view document's id — the column's view. */
  readonly docId: string;
  /** True when the showing board already had a column querying exactly this. */
  readonly duplicate: boolean;
}

export interface SaveAsView {
  readonly save: (query: SearchQuery) => Promise<SaveAsViewResult>;
  readonly isPending: boolean;
}

export { sameQuery } from "./viewDoc";

export function useSaveAsView(): SaveAsView {
  const surface = useBoardSurface();
  const { columns } = useColumns(surface.current, surface.boards);
  const createDoc = useCreateDoc();
  const { mutateAsync } = createDoc;
  const { addColumn } = surface;

  const save = useCallback(
    async (query: SearchQuery): Promise<SaveAsViewResult> => {
      const stored = toViewFrontmatter(query);
      const duplicate = columns.some((column) => sameCompiledQuery(column.filter, stored));
      const response = await mutateAsync(
        columnRequest({
          key: "search:current",
          source: "search",
          title: describeQuery(query),
          query: stored,
          detail: "",
        }),
      );
      const docId = response.doc.frontmatter.id;
      await addColumn(docId);
      return { docId, duplicate };
    },
    [addColumn, columns, mutateAsync],
  );

  return { save, isPending: createDoc.isPending };
}
