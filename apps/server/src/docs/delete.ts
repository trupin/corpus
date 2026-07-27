// `DELETE /api/docs/{id}` — the one destructive verb, and the one that is
// user-only (SPEC.md §7, §9.2).
//
// "The agent archives, never deletes." That is a stewardship rule, so it is
// enforced where the mutation happens rather than trusted to a caller. Nothing
// is hard-deleted from history either: git keeps the file and every version of
// it, and the document's threads survive as **orphaned records** that still
// name it as `parent`. Cascade-deleting them would destroy conversations
// nobody asked to delete.

import type { Actor, DeleteDocResult } from "@corpus/contract";
import { DOCS_KEY, TREE_KEY, docKey } from "../events/index.js";
import { forbidden } from "../errors.js";
import { loadDocument } from "./read.js";
import {
  runMutation,
  type DocsWorkspace,
  type DocumentMutex,
  type MutationResult,
} from "./write.js";

export const AGENT_DELETE_MESSAGE = "deletion is user-only; the agent archives, never deletes";

export type DeleteOutcome = { readonly result: DeleteDocResult; readonly mutation: MutationResult };

export async function deleteDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
): Promise<DeleteOutcome> {
  // Before the lock guard and before any read: an agent may not delete, and
  // finding out whether the document exists is not information the refusal
  // depends on.
  if (actor === "agent") throw forbidden(AGENT_DELETE_MESSAGE);
  await (workspace.assertWritable ?? (() => undefined))(id, actor);

  return mutex.run(id, async () => {
    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    const threads = workspace.projection
      .prepare("SELECT id FROM threads WHERE parent_id = ? ORDER BY id")
      .all(id) as { id: string }[];
    const orphanedThreadIds = threads.map((thread) => thread.id);

    const mutation = await runMutation(workspace, {
      docId: id,
      actor,
      plan: {
        operations: [{ kind: "remove", path: loaded.path }],
        stage: [loaded.path],
        project: [],
        unproject: [loaded.path],
        commit: { subject: `doc delete: ${loaded.row.title} (${id}) by ${actor}` },
        // The orphaned threads' rows are untouched, but every list that showed
        // them alongside their parent has to redraw.
        keys: [DOCS_KEY, docKey(id), TREE_KEY],
      },
    });

    return {
      result: { deletedId: id, orphanedThreadIds, warnings: [...mutation.warnings] },
      mutation,
    };
  });
}
