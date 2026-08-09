// `POST /api/docs/{id}/archive` and `/unarchive` (SPEC.md §7, §11).
//
// Archiving is "a reversible organizational act, never a deletion" — the file
// stays, git keeps everything, and the document stays indexed. It drops out of
// the default result set of `GET /api/docs` and comes back with
// `status=archived`; that is the whole of it for most types.
//
// A `type: skill` document is the exception §7 carves out: archiving one must
// also *disable* it, and what disables a Claude Code skill is where its folder
// lives. So the whole folder moves between `.claude/skills/` and
// `.claude/skills-archived/`, siblings included — and because
// `.claude/skills-archived/` is itself a projection root, the document stays
// indexed on both sides.

import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Actor, Doc } from "@corpus/contract";
import {
  formatInstant,
  parseDocument,
  serializeDocument,
  setFrontmatterFields,
} from "../core/index.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { DOCUMENT_ROOTS, SKILL_FILENAME } from "../projection/index.js";
import { findDocumentRowByPath, loadDocument, toWireDoc, type LoadedDocument } from "./read.js";
import {
  destinationOccupied,
  mergeCollision,
  runMutation,
  validateBeforeWrite,
  validationError,
  type DocsWorkspace,
  type DocumentMutex,
  type FileOperation,
  type MutationResult,
} from "./write.js";

const rootPath = (key: "skills" | "skills-archived"): string => {
  const root = DOCUMENT_ROOTS.find((candidate) => candidate.key === key);
  /* c8 ignore next */
  if (root === undefined) throw new Error(`missing document root ${key}`);
  return root.path;
};

export const SKILLS_ROOT = rootPath("skills");
export const SKILLS_ARCHIVED_ROOT = rootPath("skills-archived");

export type ArchiveOutcome = { readonly doc: Doc; readonly result: MutationResult };

/** What {@link planSetArchived} decided: the write, and what to validate first. */
export type ArchivePlan = {
  readonly operations: readonly FileOperation[];
  readonly stage: readonly string[];
  readonly project: readonly string[];
  readonly unproject: readonly string[];
  /** Where the document's file ends up — under the archived root, for a skill. */
  readonly path: string;
  /** The bytes to validate and write, or `null` when only the folder moved. */
  readonly text: string | null;
};

/** Every `SKILL.md` under `dir`, workspace-relative — a folder may nest skills. */
export function skillDocumentsUnder(workspaceRoot: string, dir: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    let entries;
    try {
      entries = readdirSync(resolve(workspaceRoot, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) walk(`${relative}/${entry.name}`);
      else if (entry.name === SKILL_FILENAME) found.push(`${relative}/${entry.name}`);
    }
  };
  walk(dir);
  return found.sort();
}

type FolderMove = { readonly from: string; readonly to: string; readonly skillPath: string };

/**
 * Where a skill's folder has to go, or `null` when it is already on the right
 * side. The relative path below the root is mirrored, so a nested skill keeps
 * its shape.
 */
function planFolderMove(loaded: LoadedDocument, archived: boolean): FolderMove | null {
  const from = archived ? SKILLS_ROOT : SKILLS_ARCHIVED_ROOT;
  const to = archived ? SKILLS_ARCHIVED_ROOT : SKILLS_ROOT;
  if (!loaded.path.startsWith(`${from}/`)) return null;

  const rest = dirname(loaded.path.slice(from.length + 1));
  if (rest === "." || rest === "") {
    // A `SKILL.md` sitting directly in the root has no folder of its own, and
    // moving the root itself would take every other skill with it.
    validationError("this skill has no folder of its own to archive", [
      { path: "id", message: `${loaded.path} is not inside a skill folder` },
    ]);
  }
  return {
    from: `${from}/${rest}`,
    to: `${to}/${rest}`,
    skillPath: `${to}/${rest}/${basename(loaded.path)}`,
  };
}

/**
 * Refuse a folder move that would overwrite a file already at the destination —
 * before anything is written, so both sides stay byte-for-byte as they were.
 *
 * **A destination folder that merely exists is no longer the refusal**
 * (SERVER-078). It used to be, on the grounds that "merging two skill folders
 * would silently overwrite files" — but the overwriting is what the refusal is
 * about, and a name is not an overwrite. The old rule turned an ordinary
 * sequence into a permanent wedge: archiving a nested skill on its own creates
 * `.claude/skills-archived/<outer>/`, after which the outer skill could never be
 * archived and the only recovery was moving a directory by hand. Worse, which of
 * the two outcomes a select-all archive produced depended on the order the ids
 * arrived in.
 *
 * So the question asked is the one that was always meant: would any file at the
 * destination be lost? Two directories of the same name merge; a file that
 * already exists refuses, naming itself. A genuinely unrelated archived skill of
 * the same name still refuses, because its own `SKILL.md` is exactly such a file.
 *
 * {@link destinationOccupied}, not {@link validationError}: inside a bulk act the
 * difference is whether the report says "refresh the board" or "this name is
 * taken" (sprint-005 Open Conflict 4: a 400, since this route declares no 409).
 */
function assertMergeable(workspaceRoot: string, move: FolderMove): void {
  const collision = mergeCollision(
    resolve(workspaceRoot, move.from),
    resolve(workspaceRoot, move.to),
  );
  if (collision === null) return;
  destinationOccupied("the destination already holds a file this move would overwrite", [
    { path: "id", message: `${move.to}/${collision} already exists; move or remove it first` },
  ]);
}

/**
 * The identity-preserving writes a folder move owes the documents it **carries**.
 *
 * A skill with no `id:` of its own is projected under an id derived from its
 * path (§7), so every document under a moved folder — not only the one the
 * caller named — changes identity when the folder moves. §5 makes an id
 * identity: `[[refs]]`, the `links` graph, an anchor entry and a thread's
 * `parent` all point by it, and nothing reports the breakage, because from the
 * projection's side an id vanishing while another appears is indistinguishable
 * from a delete plus a create. Stamping the id the document already has is what
 * makes it survive, and it is a write, so it belongs here and never to the
 * projection.
 *
 * The id comes from the projection row — the authority on what this file's id
 * *is*, including the case where the frontmatter declares one the contract
 * cannot accept and the row therefore carries the synthesized one instead.
 *
 * Two things are deliberately not done to a carried document. Its `updated` is
 * not stamped: nothing about its content changed, and §5's staleness clock must
 * not be reset by a neighbour's archiving. Its `status` is not touched either:
 * for a skill the *root* decides status (§7), so writing one would be dead
 * metadata that lies after the reverse move.
 *
 * Nor is a carried write put through §14 validation. The file's content is the
 * author's, unchanged but for one key the system owns, so a finding would be
 * about a document this act never asked to edit.
 */
function planCarriedIdStamps(
  workspace: DocsWorkspace,
  move: FolderMove,
  movedDocuments: readonly string[],
  requestedPath: string,
): FileOperation[] {
  const operations: FileOperation[] = [];
  for (const oldPath of movedDocuments) {
    if (oldPath === requestedPath) continue;
    const row = findDocumentRowByPath(workspace.projection, oldPath);
    // Not indexed — an unparseable file or one that lost an id race — so there
    // is no identity to preserve and nothing this act could honestly stamp.
    if (row === null) continue;

    let content: string;
    try {
      const parsed = parseDocument(
        readFileSync(resolve(workspace.workspaceRoot, oldPath), "utf8"),
        oldPath,
      );
      // Already says so — a skill that carries a real `id:` keeps it across any
      // number of moves, and there is nothing to write.
      const stamped = setFrontmatterFields(parsed, { id: row.id });
      if (stamped === parsed) continue;
      content = serializeDocument(stamped);
      /* c8 ignore start -- the projection racing an out-of-band edit to a file this act is only carrying */
    } catch {
      // A row said this file was readable and it no longer is. Skipping loses
      // the id; failing the archive loses the archive, and the caller asked for
      // a different document entirely.
      continue;
    }
    /* c8 ignore stop */
    operations.push({ kind: "write", path: rebase(oldPath, move.from, move.to), content });
  }
  return operations;
}

/**
 * Everything archiving one document does to the filesystem, decided but not yet
 * done — `null` when the document is already on the requested side, which is a
 * no-op and never an error (§7).
 *
 * Extracted so the bulk act (SPEC.md §4, SERVER-077) archives through the *same*
 * decision as `POST /api/docs/{id}/archive`, skill folder move included. A bulk
 * path that flipped `status` on its own would report success while leaving a
 * skill enabled — §7's whole point being that what disables a skill is where its
 * folder lives.
 *
 * Validation is deliberately left to the caller: it needs `path` and `text`,
 * which are exactly what this returns, and the two callers report a §14 refusal
 * differently (a `400` for one document, a `refused` entry for one of many).
 */
export function planSetArchived(
  workspace: DocsWorkspace,
  loaded: LoadedDocument,
  archived: boolean,
): ArchivePlan | null {
  const id = loaded.row.id;
  const move = loaded.row.type === "skill" ? planFolderMove(loaded, archived) : null;

  if (move !== null) assertMergeable(workspace.workspaceRoot, move);

  const patch: Record<string, unknown> = { status: archived ? "archived" : "open" };
  // A hand-written `SKILL.md` carries no `id`, so the projection derives one
  // from its path (§7) — which the folder move would change, silently turning
  // the document into a different document. Stamping the current id into the
  // file is what makes identity survive the move, and it is a write, so it is
  // this path's business and never the projection's.
  if (typeof loaded.parsed.data["id"] !== "string") patch["id"] = id;

  const nextParsed = setFrontmatterFields(loaded.parsed, patch);
  const stamped =
    nextParsed === loaded.parsed
      ? nextParsed
      : setFrontmatterFields(nextParsed, { updated: formatInstant(workspace.now()) });
  const text = serializeDocument(stamped);
  const contentChanged = text !== loaded.text;

  // Already in the requested state — archiving twice is a no-op, never an
  // error and never a deletion (§7).
  if (!contentChanged && move === null) return null;

  const path = move?.skillPath ?? loaded.path;
  const movedDocuments =
    move === null ? [] : skillDocumentsUnder(workspace.workspaceRoot, move.from);
  const operations: FileOperation[] = [];
  if (move !== null) {
    operations.push({ kind: "renameDir", from: move.from, to: move.to, documents: movedDocuments });
    // After the move, never before: the stamps are written at the destination.
    operations.push(...planCarriedIdStamps(workspace, move, movedDocuments, loaded.path));
  }
  if (contentChanged) operations.push({ kind: "write", path, content: text });

  return {
    operations,
    stage: move === null ? [loaded.path] : [move.from, move.to],
    project:
      move === null
        ? [loaded.path]
        : [...movedDocuments.map((entry) => rebase(entry, move.from, move.to)), path],
    unproject: move === null ? [] : movedDocuments,
    path,
    text: contentChanged ? text : null,
  };
}

export async function setArchived(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<ArchiveOutcome> {
  const verb = archived ? "archive" : "unarchive";

  return mutex.run(id, async () => {
    // Inside the lane, so a lease acquired while this verb waited its turn still
    // refuses it (SERVER-022 finding 7).
    await (workspace.assertWritable ?? (() => undefined))(id, actor);

    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    const plan = planSetArchived(workspace, loaded, archived);
    if (plan === null) {
      return { doc: toWireDoc(workspace.projection, loaded), result: emptyResult() };
    }

    const warnings = plan.text === null ? [] : validateBeforeWrite(workspace, plan.path, plan.text);

    const result = await runMutation(workspace, {
      docId: id,
      actor,
      warnings,
      plan: {
        operations: plan.operations,
        stage: plan.stage,
        project: plan.project,
        unproject: plan.unproject,
        commit: {
          subject: `doc ${verb}: ${loaded.row.title} (${id}) by ${actor}`,
        },
        keys: [DOCS_KEY, docKey(id)],
        // Archived documents are excluded from every folder count, so archiving
        // and unarchiving move a folder badge in opposite directions — for a
        // document and for a parented thread alike (SERVER-018). A skill,
        // whose archiving relocates a folder outside `data/docs/`, moves no
        // badge at all; the comparison tells the two apart.
        mayChangeTree: true,
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

const rebase = (path: string, from: string, to: string): string =>
  path.startsWith(`${from}/`) ? `${to}/${path.slice(from.length + 1)}` : path;

const emptyResult = (): MutationResult => ({ changed: false, warnings: [], commit: null });
