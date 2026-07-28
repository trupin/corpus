import { DEFAULT_DOC_FOLDER, type Doc } from "@corpus/contract";
import { useCreateDoc, type CreateDocInput } from "@corpus/kit";
import { useCallback } from "react";
import type { PluginColumnRef } from "./viewDoc";

/**
 * `＋` on a column — zero-form, inbox-first creation (SPEC.md §11).
 *
 * The rule is the column's own document, read: a `folder:` query creates into
 * that folder; a plugin `column:` creates that plugin's document type; anything
 * else creates into `data/docs/inbox/`, because quick creation should never ask
 * where a thought belongs — the agent files inbox arrivals per its skill.
 *
 * **UI-009's omnibox creates the same way.** That is why the request shape is a
 * separate pure function and the hook takes a target rather than a column: the
 * search overlay's "Create «query»" is `createInColumn(NO_COLUMN, query)`, not
 * a second implementation that drifts about which folder is default.
 */

/** The title a document is born with — selected, ready to be typed over. */
export const UNTITLED_DOCUMENT_TITLE = "Untitled";

/** What creation needs to know about the column it was invoked from. */
export interface CreateTarget {
  readonly folder: string | null;
  readonly plugin: PluginColumnRef | null;
}

/** The omnibox's target, and any column that is not folder- or plugin-scoped. */
export const INBOX_TARGET: CreateTarget = { folder: null, plugin: null };

/** The type a document created from this column gets. */
export const DEFAULT_DOC_TYPE = "note";

/**
 * `folder` is always **sent**, never left to a default.
 *
 * The row that offers this act says the document goes to the inbox, and a
 * promise made in the copy must not depend on a default declared in another
 * package — a server that retuned it would leave the UI quietly lying about
 * where the thought went. The constant is the contract's own
 * `DEFAULT_DOC_FOLDER`, so this is the *same* decision named at the call site,
 * not a second copy of it (`useSaveAsView` already sends `"views"` outright for
 * exactly this reason).
 */
export function creationRequest(target: CreateTarget, title: string): CreateDocInput {
  const type = target.plugin?.type ?? DEFAULT_DOC_TYPE;
  return { type, title, folder: target.folder ?? DEFAULT_DOC_FOLDER };
}

export interface CreateInColumn {
  /** Resolves with the new document's id, so the caller can open it. */
  readonly create: (target: CreateTarget, title?: string) => Promise<string>;
  /**
   * The same act, resolving with the created document.
   *
   * The omnibox needs more than the id: it opens the new document in *its home
   * column*, and which column that is depends on where the server filed it —
   * which only the response says. Column `＋` already knows the folder it
   * created into, so it keeps the narrower return.
   */
  readonly createDocument: (target: CreateTarget, title?: string) => Promise<Doc>;
  readonly isPending: boolean;
  readonly error: Error | null;
}

export function useCreateInColumn(): CreateInColumn {
  const createDoc = useCreateDoc();
  const { mutateAsync } = createDoc;

  const createDocument = useCallback(
    async (target: CreateTarget, title: string = UNTITLED_DOCUMENT_TITLE) => {
      const response = await mutateAsync(creationRequest(target, title));
      return response.doc;
    },
    [mutateAsync],
  );

  const create = useCallback(
    async (target: CreateTarget, title?: string) =>
      (await createDocument(target, title)).frontmatter.id,
    [createDocument],
  );

  return { create, createDocument, isPending: createDoc.isPending, error: createDoc.error };
}
