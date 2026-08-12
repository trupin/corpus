// `POST /api/docs/{id}/move` — relocation (SPEC.md §5, §9.2).
//
// A move rewrites the file path and **nothing else**. The id is assigned at
// creation and immutable, so every `[[ref]]`, every anchor entry and every
// thread `parent` keeps resolving without a rewrite — which is the entire
// reason "path is presentation, id is identity" is a rule rather than a slogan.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Actor, Doc } from "@corpus/contract";
import { parseDocumentPath, type ParsedDocumentPath } from "../core/index.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { loadDocument, toWireDoc, type LoadedDocument } from "./read.js";
import {
  destinationOccupied,
  resolveFolder,
  runMutation,
  validationError,
  type DocsWorkspace,
  type DocumentMutex,
  type FileOperation,
  type MutationResult,
} from "./write.js";

export type MoveOutcome = { readonly doc: Doc; readonly result: MutationResult };

/** Where a document is going, and the one rename that takes it there. */
export type MovePlan = {
  readonly operations: readonly FileOperation[];
  readonly stage: readonly string[];
  readonly project: readonly string[];
  readonly unproject: readonly string[];
  readonly nextPath: string;
};

/**
 * The document's own path, or a `400` explaining why it has nowhere to go.
 *
 * Threads are flat at `data/threads/<id>.md` by convention (SPEC.md §4) — their
 * filename *is* their id, so there is nowhere to move them to. A skill lives
 * inside its own folder under `.claude/`, which archiving relocates and moving
 * would break. Asked before the destination is resolved, so a document that can
 * never be moved says so rather than complaining about the folder.
 */
export function assertMovable(loaded: LoadedDocument): ParsedDocumentPath {
  const source = parseDocumentPath(loaded.path);
  if (source === null || source.root !== "docs") {
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
  return source;
}

/**
 * The rename that files `loaded` under `destination`, or `null` when it is
 * already there.
 *
 * `destination` is a folder the caller has already put through
 * {@link resolveFolder}, because a folder that names nothing is a fault of the
 * *request* and not of any one document — which is the difference between a
 * `400` for the whole call and one entry in a bulk act's `refused` list
 * (SERVER-077).
 */
export function planMove(
  workspace: DocsWorkspace,
  loaded: LoadedDocument,
  destination: string,
): MovePlan | null {
  const source = assertMovable(loaded);

  const nextPath = `${destination}/${source.filename}`;
  if (nextPath === loaded.path) return null;

  // No 409 is declared on this route (sprint-005 Open Conflict 4), and the
  // rejection is honest as a request-level one: the caller named a
  // destination that cannot be used, and `issues` says which. Raised through
  // {@link destinationOccupied} rather than {@link validationError} so a bulk
  // act can report it as what it is — a write that could not happen — instead of
  // telling the user to refresh a board that is perfectly current.
  if (existsSync(resolve(workspace.workspaceRoot, nextPath))) {
    destinationOccupied("the destination is already occupied", [
      { path: "folder", message: `${nextPath} already exists` },
    ]);
  }

  return {
    operations: [{ kind: "renameFile", from: loaded.path, to: nextPath, content: loaded.text }],
    stage: [loaded.path, nextPath],
    project: [nextPath],
    unproject: [loaded.path],
    nextPath,
  };
}

export async function moveDocument(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  folder: string,
): Promise<MoveOutcome> {
  return mutex.run(id, async () => {
    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    // The location check runs before `resolveFolder`, so a thread sent to a bad
    // folder still reports the reason it could never be moved at all.
    assertMovable(loaded);

    const plan = planMove(workspace, loaded, resolveFolder(folder));
    if (plan === null) {
      return { doc: toWireDoc(workspace, loaded), result: emptyResult() };
    }

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      plan: {
        operations: plan.operations,
        stage: plan.stage,
        project: plan.project,
        unproject: plan.unproject,
        commit: {
          subject: `doc move: ${loaded.path} → ${plan.nextPath} (${id}) by ${actor}`,
          // SPEC.md §4: "a document ... moved, renamed" is a discrete act, so it
          // closes the open window and names its commit (SERVER-092). A move
          // that would change nothing returned above and is no act.
          act: "names-the-window",
        },
        keys: [DOCS_KEY, docKey(id)],
        // Usually both badges move — but an archived document counts in no
        // folder, so moving one that carries no threads changes nothing.
        mayChangeTree: true,
      },
    });

    return {
      doc: toWireDoc(workspace, loadDocument(workspace.workspaceRoot, workspace.projection, id)),
      result,
    };
  });
}

const emptyResult = (): MutationResult => ({ changed: false, warnings: [], commit: null });
