import { useCreateDoc } from "@corpus/kit";
import { useCallback } from "react";
import { describeQuery, toViewFrontmatter, type SearchQuery } from "../search/searchQuery";
import { columnRequest } from "./newList";
import { nextOrder } from "./columnOrder";
import { useColumns } from "./useColumns";

/**
 * "Save as view" — pinning the current search as a board column (SPEC.md §10).
 *
 * There is no board-layout API to call: a column **is** a `type: view` document
 * with `pinned: true`, so saving a search is one `POST /api/docs` writing the
 * search into that document's `query` frontmatter, at an `order` that puts it
 * last. The column then appears because the board's own pinned-view query
 * refetches and finds it — which is also why it is there in a second browser,
 * survives a reload, and is visible to the agent as a file.
 *
 * The request body is built by UI-003's `columnRequest`, the same function the
 * new-list picker uses. Two ways to create a column would be two places for the
 * §10 view keys to drift.
 */

export interface SaveAsViewResult {
  /** The new view document's id — the column's id. */
  readonly docId: string;
  /** True when a pinned view already queried exactly this. */
  readonly duplicate: boolean;
}

export interface SaveAsView {
  readonly save: (query: SearchQuery) => Promise<SaveAsViewResult>;
  readonly isPending: boolean;
}

/** Two compiled queries are the same search when they are the same map. */
export function sameQuery(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

export function useSaveAsView(): SaveAsView {
  const { columns } = useColumns();
  const createDoc = useCreateDoc();
  const { mutateAsync } = createDoc;

  const save = useCallback(
    async (query: SearchQuery): Promise<SaveAsViewResult> => {
      const stored = toViewFrontmatter(query);
      const duplicate = columns.some((column) => sameQuery(column.filter, stored));
      const response = await mutateAsync(
        columnRequest(
          {
            key: "search:current",
            source: "search",
            title: describeQuery(query),
            query: stored,
            detail: "",
          },
          nextOrder(columns),
        ),
      );
      return { docId: response.doc.frontmatter.id, duplicate };
    },
    [columns, mutateAsync],
  );

  return { save, isPending: createDoc.isPending };
}
