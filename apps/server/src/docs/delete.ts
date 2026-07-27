// `DELETE /api/docs/{id}` — the one destructive verb, and the one that is
// user-only (SPEC.md §7, §9.2).
//
// "The agent archives, never deletes." That is a stewardship rule, so it is
// enforced where the mutation happens rather than trusted to a caller. Nothing
// is hard-deleted from history either: git keeps the file and every version of
// it.
//
// **Two branches, both correct, and deliberately different** (sprint-006 Open
// Conflict 6). Threads are documents, so `DocumentIdSchema` accepts `th_*` and
// this route is also how a thread is deleted — there is no
// `DELETE /api/threads/{id}`:
//
//   - Deleting a **plain document** leaves its threads alone. They survive as
//     **orphaned records** that still name it as `parent`; cascade-deleting them
//     would destroy conversations nobody asked to delete.
//   - Deleting a **thread** removes its anchor entry from the parent's
//     frontmatter, in the same commit (§6: "no highlight is ever left pointing
//     at an empty conversation"). Its own child threads are orphaned by the rule
//     above — the cascade is one level of *anchor* bookkeeping, not a recursive
//     delete.

import type { Actor, DeleteDocResult } from "@corpus/contract";
import { serializeDocument, setFrontmatterFields, withoutAnchorEntry } from "../core/index.js";
import { DOCS_KEY, docKey, threadKey } from "../events/index.js";
import { forbidden } from "../errors.js";
import { loadDocument, type LoadedDocument } from "./read.js";
import {
  runInLanes,
  runMutation,
  type DocsWorkspace,
  type DocumentMutex,
  type FileOperation,
  type MutationResult,
} from "./write.js";

export const AGENT_DELETE_MESSAGE = "deletion is user-only; the agent archives, never deletes";

export type DeleteOutcome = {
  readonly result: DeleteDocResult;
  readonly mutation: MutationResult;
  /**
   * The anchor entry the cascade removed from the parent, when the deleted
   * document was an anchored thread. Deliberately **not** on the wire:
   * `DeleteDocResultSchema` has no such field and the client refetches the
   * parent anyway (Open Conflict 6). The turn-deletion route, whose contract
   * *does* declare `removedAnchor`, reads it from here.
   */
  readonly removedAnchor: string | null;
};

/**
 * The parent whose `anchors` map this document's deletion would rewrite, or
 * `null` when the deletion touches one file. Answered from the document's own
 * frontmatter, which is the only thing that decides it — so a caller can pick
 * its lanes and run the lock guard before entering them.
 */
export function anchoredThreadParent(
  loaded: LoadedDocument,
): { readonly parentId: string; readonly anchorId: string } | null {
  if (loaded.row.type !== "thread") return null;
  const parentId = loaded.parsed.data["parent"];
  const anchorId = loaded.parsed.data["anchor"];
  if (typeof parentId !== "string" || parentId === "") return null;
  if (typeof anchorId !== "string" || anchorId === "") return null;
  return { parentId, anchorId };
}

/**
 * The deletion itself, with the caller already holding the lanes and having run
 * the lock guard. Split out so turn deletion — whose last-turn cascade *is* a
 * thread deletion (§6) — reaches the same code without re-entering a mutex it
 * already holds, which would deadlock.
 */
export async function deleteDocumentLocked(
  workspace: DocsWorkspace,
  actor: Actor,
  id: string,
): Promise<DeleteOutcome> {
  const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
  const threads = workspace.projection
    .prepare("SELECT id FROM threads WHERE parent_id = ? ORDER BY id")
    .all(id) as { id: string }[];
  const orphanedThreadIds = threads.map((thread) => thread.id);

  const isThread = loaded.row.type === "thread";
  const operations: FileOperation[] = [{ kind: "remove", path: loaded.path }];
  const stage: string[] = [loaded.path];
  const project: string[] = [];
  const keys = [DOCS_KEY, docKey(id), ...(isThread ? [threadKey(id)] : [])];

  // The anchor half of the cascade. A parent that has since been deleted, or
  // whose entry someone already removed by hand, is not an error: the goal is
  // "no anchor entry survives its thread", and that is already true.
  const anchored = anchoredThreadParent(loaded);
  let removedAnchor: string | null = null;
  if (anchored !== null) {
    const parent = findParent(workspace, anchored.parentId);
    const remaining =
      parent === null ? null : withoutAnchorEntry(parent.parsed.data["anchors"], anchored.anchorId);
    if (parent !== null && remaining !== null) {
      operations.push({
        kind: "write",
        path: parent.path,
        content: serializeDocument(setFrontmatterFields(parent.parsed, { anchors: remaining })),
      });
      stage.push(parent.path);
      project.push(parent.path);
      keys.push(docKey(anchored.parentId));
      removedAnchor = anchored.anchorId;
    }
  }

  const mutation = await runMutation(workspace, {
    docId: id,
    actor,
    plan: {
      operations,
      stage,
      project,
      unproject: [loaded.path],
      commit: {
        subject: `${isThread ? "thread" : "doc"} delete: ${loaded.row.title} (${id}) by ${actor}`,
      },
      // The orphaned threads' rows are untouched, but every list that showed
      // them alongside their parent has to redraw.
      keys,
      // A parented thread's deletion takes a count off its parent's folder; a
      // standalone thread was counted nowhere and takes nothing with it.
      // Deleting a document un-counts every thread that hung from it, and
      // deleting an already-archived one un-counts only those threads — which
      // is why the answer is measured rather than assembled here.
      mayChangeTree: true,
    },
  });

  return {
    result: { deletedId: id, orphanedThreadIds, warnings: [...mutation.warnings] },
    mutation,
    removedAnchor,
  };
}

/** The parent document, or `null` when it no longer exists — a deletion never fails on that. */
function findParent(workspace: DocsWorkspace, parentId: string): LoadedDocument | null {
  try {
    return loadDocument(workspace.workspaceRoot, workspace.projection, parentId);
  } catch {
    return null;
  }
}

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
  const guard = workspace.assertWritable ?? ((): void => undefined);
  await guard(id, actor);

  // Read before entering the lanes, because which lanes to hold is a question
  // only the document's own frontmatter answers. Re-read inside; this copy
  // decides lanes and guards, never content.
  const anchored = anchoredThreadParent(
    loadDocument(workspace.workspaceRoot, workspace.projection, id),
  );
  // The parent's frontmatter is genuinely rewritten, so the other party's edit
  // lock on it refuses this deletion — sprint-006 Adjudication 1.
  if (anchored !== null) await guard(anchored.parentId, actor);

  return runInLanes(mutex, [id, anchored?.parentId], () =>
    deleteDocumentLocked(workspace, actor, id),
  );
}
