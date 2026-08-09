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
  type ParsedDocument,
} from "../core/index.js";
import { HttpError, locked } from "../errors.js";
import { DOCS_KEY, docKey } from "../events/index.js";
import { DOCUMENT_ROOTS, SKILL_FILENAME } from "../projection/index.js";
import { findDocumentRowByPath, loadDocument, toWireDoc, type LoadedDocument } from "./read.js";
import {
  destinationOccupied,
  mergeCollision,
  runInLanes,
  runMutation,
  validateBeforeWrite,
  validationError,
  type DocsWorkspace,
  type DocumentMutex,
  type FileOperation,
  type MutationResult,
  type WriteGuard,
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
 * Where a skill's folder would have to go — `"settled"` when it is already on
 * the requested side, `"rootless"` for a `SKILL.md` sitting directly in a root,
 * which has no folder of its own to move. The relative path below the root is
 * mirrored, so a nested skill keeps its shape.
 *
 * Pure, and returning the rootless case rather than refusing it, because two
 * callers ask this question at different moments: {@link planSetArchived}, for
 * which it is a refusal, and {@link carriedDocumentIds}, which asks *before any
 * lane is taken* purely to decide which documents this act will write and must
 * therefore not raise anything (the load inside the lanes is the one that
 * reports).
 */
function folderMove(
  loaded: LoadedDocument,
  archived: boolean,
): FolderMove | "settled" | "rootless" {
  const from = archived ? SKILLS_ROOT : SKILLS_ARCHIVED_ROOT;
  const to = archived ? SKILLS_ARCHIVED_ROOT : SKILLS_ROOT;
  if (!loaded.path.startsWith(`${from}/`)) return "settled";

  const rest = dirname(loaded.path.slice(from.length + 1));
  if (rest === "." || rest === "") return "rootless";
  return {
    from: `${from}/${rest}`,
    to: `${to}/${rest}`,
    skillPath: `${to}/${rest}/${basename(loaded.path)}`,
  };
}

/** {@link folderMove}, with the rootless case as the refusal the route owes it. */
function planFolderMove(loaded: LoadedDocument, archived: boolean): FolderMove | null {
  const move = folderMove(loaded, archived);
  if (move === "rootless") {
    // A `SKILL.md` sitting directly in the root has no folder of its own, and
    // moving the root itself would take every other skill with it.
    validationError("this skill has no folder of its own to archive", [
      { path: "id", message: `${loaded.path} is not inside a skill folder` },
    ]);
  }
  return move === "settled" ? null : move;
}

/**
 * The **other** documents a folder move would carry — the ids of every indexed
 * `SKILL.md` under the folder but the requested one.
 *
 * Exported because it answers a question that has to be settled *before* the
 * act takes a single lane: this verb writes those documents' files (it stamps
 * their ids, §5), so it must hold their write lanes for its whole length and
 * consult their locks, exactly as `bulk.ts` holds a cascaded parent's lane and
 * `delete.ts` holds an anchored thread's parent's (PR #38, finding 3). Before,
 * a `PUT` to a nested skill and its neighbour's archive were serialized against
 * nothing, so one could land inside the other's read-plan-write and be reverted,
 * relocated out from under itself, or written past an active lease.
 *
 * Read from the current tree, so it can in principle disagree with the plan made
 * inside the lanes — a `SKILL.md` created under the folder in between. That is
 * why the plan takes the held set rather than trusting this: a document whose
 * lane is not held is moved, never written.
 */
export function carriedDocumentIds(
  workspace: DocsWorkspace,
  loaded: LoadedDocument,
  archived: boolean,
): string[] {
  if (loaded.row.type !== "skill") return [];
  const move = folderMove(loaded, archived);
  if (typeof move === "string") return [];
  const ids: string[] = [];
  for (const path of skillDocumentsUnder(workspace.workspaceRoot, move.from)) {
    if (path === loaded.path) continue;
    const row = findDocumentRowByPath(workspace.projection, path);
    if (row !== null && row.id !== loaded.row.id) ids.push(row.id);
  }
  return ids;
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
 * already exists refuses, naming itself. An archived skill of the same name
 * whose own `SKILL.md` is in the way refuses, because that file is exactly such
 * a file — but note what that does **not** say (PR #38, finding 6, correcting
 * SERVER-078's Decision 3): a refusal needs a collision, so an unrelated archived
 * tree that happens to occupy *different* paths than the source merges silently
 * into it. `.claude/skills-archived/demo/helper/SKILL.md` beside a
 * `.claude/skills/demo/` with no `helper` is exactly that case, and it is the
 * mechanism behind finding 2 — which is why {@link ownedFields} reconciles what
 * the merge brings back to the enabled root rather than trusting the union to be
 * two halves of one folder.
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
  // `""` is the destination itself — something that is not a real directory,
  // which is in the way whole rather than at some path under it.
  const path = collision === "" ? move.to : `${move.to}/${collision}`;
  destinationOccupied("the destination already holds a file this move would overwrite", [
    { path: "id", message: `${path} already exists; move or remove it first` },
  ]);
}

/**
 * The frontmatter keys this act owns on **every** file it writes — the document
 * the caller named and the ones its folder move carries alike. One rule, applied
 * in one place, because two rules is what PR #38's review found: the requested
 * document was stamped only when its frontmatter carried no *string* `id`, so a
 * `SKILL.md` declaring `id: my-skill` — a string the contract's
 * `^(doc|th)_[A-Za-z0-9]+$` rejects, and which the projection therefore ignores
 * in favour of a synthesized one — was written back unstamped and re-minted by
 * the very move this function exists to survive.
 *
 * **`id` is the projection row's, unconditionally.** The row is the authority on
 * what a file's id *is*: a declared id the contract accepts is already the row's
 * (so the patch is a no-op and nothing is written), and one it cannot accept
 * names a document the workspace does not have. §5 makes an id identity —
 * `[[refs]]`, the `links` graph, an anchor entry and a thread's `parent` all
 * point by it — and a synthesized id hashes the path, so without this the move
 * silently turns the document into a different document, which from the
 * projection's side is indistinguishable from a delete plus a create.
 *
 * **`status` is reconciled only against the *enabled* root, and only when it
 * says `archived`.** §7 makes location the enablement, and the two skill roots
 * do not read the key the same way: `.claude/skills-archived/` decides status
 * from the root, so a frontmatter `status` there is never consulted and is left
 * exactly as its author wrote it; `.claude/skills/` leaves status to the
 * frontmatter, so a file that lands there still saying `archived` is projected
 * archived while Claude Code has it enabled again — the one state §7 forbids
 * outright. That state was reachable (PR #38, finding 2): archive a nested skill
 * on its own, which writes `status: archived` into its file, then unarchive the
 * skill above it, whose folder move brings the nested one back to the enabled
 * root. The alternative remedy — leaving an independently archived nested skill
 * behind rather than sweeping it back — was rejected: it makes a folder move
 * stop being a folder move, splitting a skill's own subtree on a key §7 does not
 * make authoritative, and it does not remove the contradiction so much as
 * relocate it. Reconciling is the only remedy under which the row and the
 * filesystem say the same thing.
 *
 * Two things a carried document is still deliberately not given. Its `updated`
 * is not stamped: nothing about its content changed, and §5's staleness clock
 * must not be reset by a neighbour's archiving. Nor is a carried write put
 * through §14 validation — the file's content is the author's, unchanged but for
 * keys the system owns, so a finding would be about a document this act never
 * asked to edit.
 */
function ownedFields(
  parsed: ParsedDocument,
  rowId: string,
  destinationPath: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { id: rowId };
  if (destinationPath.startsWith(`${SKILLS_ROOT}/`) && parsed.data["status"] === "archived") {
    fields["status"] = "open";
  }
  return fields;
}

/**
 * The writes a folder move owes the documents it **carries** — see
 * {@link ownedFields} for what a write consists of and why.
 *
 * `held` is the set of ids whose write lane this act holds. A carried document
 * outside it is one that appeared under the folder after the lanes were chosen,
 * so its file is moved (a folder move is one operation and takes everything) but
 * never rewritten: writing another document's bytes without holding its lane is
 * exactly the defect this parameter exists to prevent, and the fallback — an id
 * re-minted by the move — is the pre-existing behaviour rather than a loss.
 */
function planCarriedWrites(
  workspace: DocsWorkspace,
  move: FolderMove,
  movedDocuments: readonly string[],
  requestedPath: string,
  held: ReadonlySet<string>,
): FileOperation[] {
  const operations: FileOperation[] = [];
  for (const oldPath of movedDocuments) {
    if (oldPath === requestedPath) continue;
    const row = findDocumentRowByPath(workspace.projection, oldPath);
    // Not indexed — an unparseable file or one that lost an id race — so there
    // is no identity to preserve and nothing this act could honestly stamp.
    if (row === null) continue;
    if (!held.has(row.id)) {
      workspace.logger.info("a carried document was moved but not stamped", {
        docId: row.id,
        path: oldPath,
        note: "it appeared under the folder after this act chose its write lanes",
      });
      continue;
    }

    let content: string;
    try {
      const parsed = parseDocument(
        readFileSync(resolve(workspace.workspaceRoot, oldPath), "utf8"),
        oldPath,
      );
      // Already says all of it — a skill that carries a real `id:` and no stale
      // status keeps its bytes across any number of moves.
      const stamped = setFrontmatterFields(parsed, ownedFields(parsed, row.id, move.to));
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
 *
 * `held` is the set of document ids whose write lane the caller holds. It always
 * contains the requested document — both callers take that lane before loading —
 * and it is what decides which carried documents this plan may rewrite; see
 * {@link planCarriedWrites}.
 */
export function planSetArchived(
  workspace: DocsWorkspace,
  loaded: LoadedDocument,
  archived: boolean,
  held: ReadonlySet<string>,
): ArchivePlan | null {
  const id = loaded.row.id;
  const move = loaded.row.type === "skill" ? planFolderMove(loaded, archived) : null;

  if (move !== null) assertMergeable(workspace.workspaceRoot, move);

  const patch: Record<string, unknown> = {
    // The same keys, by the same rule, as every carried document gets — the id
    // above all, whose re-minting by the move is what {@link ownedFields}
    // exists to stop.
    ...ownedFields(loaded.parsed, id, move === null ? loaded.path : move.to),
    // And then the one key that is this act's whole point, which a carried
    // document never gets: the requested document's status is what the caller
    // asked to change.
    status: archived ? "archived" : "open",
  };

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
    operations.push(...planCarriedWrites(workspace, move, movedDocuments, loaded.path, held));
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

/**
 * The lock guard on a document this act only **carries** — reported so the
 * refusal says which document is actually locked.
 *
 * The sibling of `bulk.ts`'s `guardCascadeParent`, and for the same reason: the
 * `423` is raised while the caller asked about a different id, so everything in
 * it that names a document has to name the carried one, or a person reads
 * "locked" beside the skill they archived and clears *its* lease, which changes
 * nothing.
 */
async function assertCarriedWritable(
  guard: WriteGuard,
  verb: string,
  id: string,
  carriedId: string,
  actor: Actor,
): Promise<void> {
  try {
    await guard(carriedId, actor);
  } catch (error) {
    if (error instanceof HttpError && error.status === 423 && "lock" in error.body) {
      const lock = error.body.lock;
      if (lock !== undefined) {
        throw locked(
          `to ${verb} ${id} its whole skill folder moves (SPEC.md §7), which rewrites ` +
            `${carriedId}'s file in the same commit, and ${carriedId} is being edited by ` +
            `${lock.holder}; the lock to clear is ${carriedId}'s, not ${id}'s`,
          lock,
        );
      }
    }
    throw error;
  }
}

export async function setArchived(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<ArchiveOutcome> {
  const verb = archived ? "archive" : "unarchive";
  const guard = workspace.assertWritable ?? ((): void => undefined);

  // §7's folder move carries — and this verb therefore *writes* — every other
  // `SKILL.md` under the folder, so their lanes are held for the whole act and
  // their leases are consulted, exactly as `delete.ts` holds an anchored
  // thread's parent (PR #38, finding 3). Read before any lane is taken, because
  // which lanes to hold is a question only the current tree answers; an id that
  // fails to load here fails inside too, on the read that reports.
  const carried = prospectiveCarriedIds(workspace, id, archived);

  return runInLanes(mutex, [id, ...carried], async () => {
    // Inside the lanes, so a lease acquired while this verb waited its turn still
    // refuses it (SERVER-022 finding 7).
    await guard(id, actor);
    for (const carriedId of carried) {
      await assertCarriedWritable(guard, verb, id, carriedId, actor);
    }

    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    const plan = planSetArchived(workspace, loaded, archived, new Set([id, ...carried]));
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

/**
 * {@link carriedDocumentIds} for a document that has not been loaded yet, and
 * before any lane is held — so it must answer *something* for every id, valid or
 * not. A document that cannot be loaded carries nothing, and the load inside the
 * lanes is what turns that into the caller's `404`.
 */
function prospectiveCarriedIds(workspace: DocsWorkspace, id: string, archived: boolean): string[] {
  try {
    const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, id);
    return carriedDocumentIds(workspace, loaded, archived);
  } catch {
    return [];
  }
}

const rebase = (path: string, from: string, to: string): string =>
  path.startsWith(`${from}/`) ? `${to}/${path.slice(from.length + 1)}` : path;

const emptyResult = (): MutationResult => ({ changed: false, warnings: [], commit: null });
