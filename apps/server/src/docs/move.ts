// `POST /api/docs/{id}/move` — relocation (SPEC.md §5, §9.2).
//
// A move rewrites the file path and **nothing else**. The id is assigned at
// creation and immutable, so every `[[ref]]`, every anchor entry and every
// thread `parent` keeps resolving without a rewrite — which is the entire
// reason "path is presentation, id is identity" is a rule rather than a slogan.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor, Doc } from "@corpus/contract";
import { parseDocumentPath } from "../core/index.js";
import { DOCS_KEY, TREE_KEY, docKey } from "../events/index.js";
import { loadDocument, toWireDoc } from "./read.js";
import {
  resolveFolder,
  runMutation,
  validationError,
  type DocsWorkspace,
  type DocumentMutex,
  type MutationResult,
} from "./write.js";

export type MoveOutcome = { readonly doc: Doc; readonly result: MutationResult };

export async function moveDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  folder: string,
): Promise<MoveOutcome> {
  await (workspace.assertWritable ?? (() => undefined))(id, actor);

  return mutex.run(id, async () => {
    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);

    const source = parseDocumentPath(loaded.path);
    if (source === null || source.root !== "docs") {
      // Threads are flat at `data/threads/<id>.md` by convention (SPEC.md §4) —
      // their filename *is* their id, so there is nowhere to move them to. A
      // skill lives inside its own folder under `.claude/`, which archiving
      // relocates and moving would break.
      validationError("this document's location is fixed", [
        {
          path: "id",
          message:
            loaded.row.type === "thread"
              ? "threads are flat under data/threads/ and cannot be moved"
              : `${loaded.path} is not under data/docs/ and cannot be moved`,
        },
      ]);
    }

    const destination = resolveFolder(folder);

    const nextPath = `${destination}/${source.filename}`;
    if (nextPath === loaded.path) {
      return { doc: toWireDoc(workspace.projection, loaded), result: emptyResult() };
    }
    // No 409 is declared on this route (sprint-005 Open Conflict 4), and the
    // rejection is honest as a request-level one: the caller named a
    // destination that cannot be used, and `issues` says which.
    if (existsSync(resolve(workspace.workspaceRoot, nextPath))) {
      validationError("the destination is already occupied", [
        { path: "folder", message: `${nextPath} already exists` },
      ]);
    }

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      plan: {
        operations: [{ kind: "renameFile", from: loaded.path, to: nextPath, content: loaded.text }],
        stage: [loaded.path, nextPath],
        project: [nextPath],
        unproject: [loaded.path],
        commit: {
          subject: `doc move: ${loaded.path} → ${nextPath} (${id}) by ${actor}`,
        },
        keys: [DOCS_KEY, docKey(id), TREE_KEY],
      },
    });

    return {
      doc: toWireDoc(
        workspace.projection,
        loadDocument(workspace.workspaceRoot, workspace.projection, id),
      ),
      result,
    };
  });
}

const emptyResult = (): MutationResult => ({ changed: false, warnings: [], commit: null });
