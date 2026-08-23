// The four folder acts of SPEC.md §9.2 (rider 7, signed 2026-08-22): rename,
// archive, unarchive, delete, each over `data/docs/<path>`.
//
// **Each is a bulk act, and is built like one** (`docs/bulk.ts`, SERVER-077).
// The pipeline already splits into a per-document half and a once-per-act half,
// so a folder act is the same shape with the folder deciding the set instead of
// a staged list:
//
//   per document: load → plan → validate → write   (N times, isolated)
//   once:         commit → re-project → announce   (`finishMutation`)
//
// That is what makes "one action, one commit" (§4) true of an act whose subject
// is a directory, however many documents the directory holds. Each act names
// itself to the committer the way the staged Save does — `docIds` plus
// `act: "commits-alone"` — so it folds into no editing session and no later save
// folds into it.
//
// **The status acts go through the single-document planners**, `planSetArchived`
// and `planDelete`, for the reason the bulk act does: a folder archive that
// flipped `status` on its own would be a second reading of §5 and §7, and the
// two would drift the first time either was amended.
//
// **The rename does not.** It moves the directory in one operation rather than
// walking `planMove` over each file, and the reason is not economy:
//
//   1. A folder holds more than documents. An image beside the note that
//      references it, a `.csv`, an editor's dotfile — a per-file walk over the
//      projection's rows leaves every one of them behind in a folder the
//      operator was told had moved.
//   2. On a case-insensitive filesystem a per-file walk is **destructive**.
//      Renaming `Finance` to `finance` file by file means moving
//      `Finance/a.md` onto `finance/a.md`, which is the same file: the move is a
//      no-op, and the sweep that then removes the emptied source removes the
//      only copy.
//
// Nothing is skipped by moving the directory instead. `renameDir` is a pipeline
// operation, not a bare `fs.rename`: it registers its self-writes, it rolls
// back, and this plan supplies the `project`/`unproject` lists that keep the
// projection exact. Anchors and threads need no help from it either — §5 makes
// the id identity and the path presentation, so every `[[ref]]`, every anchor
// entry and every thread `parent` keeps resolving across a move without a byte
// being rewritten.

import { readFileSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type {
  Actor,
  DeleteFolderResult,
  DeletedFolderDoc,
  FolderStatusChange,
  FolderStatusResult,
  MovedFolderDoc,
  QueryKey,
  RenameFolderResult,
  Warning,
} from "@corpus/contract";
import { DOCS_FOLDER_ROOT } from "@corpus/contract";
import { planSetArchived } from "../docs/archive.js";
import { AGENT_DELETE_MESSAGE, planDelete } from "../docs/delete.js";
import { loadDocument } from "../docs/read.js";
import {
  CREATE_LANE,
  applyOperations,
  commitWarnings,
  finishMutation,
  runInLanes,
  validateBeforeWrite,
  type DocsWorkspace,
  type DocumentMutex,
  type FileOperation,
} from "../docs/write.js";
import { DOCS_KEY, dedupeKeys, docKey, threadKey } from "../events/index.js";
import { conflict, forbidden } from "../errors.js";
import { assertFolderExists, documentsUnder, folderPath, membersUnder } from "./members.js";

/**
 * Where a rename is going, resolved against what is already on disk.
 *
 * `caseOnly` is the destination that **is** the source under another spelling —
 * `Finance` to `finance` where the filesystem folds case. It is a rename by the
 * contract's rule ("compared exactly … what a case-insensitive filesystem then
 * does with it is the server's problem"), and it is the only one that needs a
 * temporary name to perform and a scratch index to record.
 */
type Destination = { readonly path: string; readonly caseOnly: boolean };

/**
 * The rename, as `POST /api/folders/rename` performs it.
 *
 * `404` when `from` names no folder, `409` when something else is already at
 * `to`. Both are decided before a lane is taken: they are faults of the request
 * rather than of any document, and a caller must not wait behind a folder's
 * worth of writes to be told the folder does not exist.
 */
export async function renameFolder(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  from: string,
  to: string,
): Promise<RenameFolderResult> {
  assertFolderExists(workspace.workspaceRoot, from);
  const destination = resolveDestination(workspace.workspaceRoot, from, to);

  return inFolderLanes(workspace, mutex, from, async (members) => {
    const source = folderPath(from);
    const documents = members.filter((member) => member.path.startsWith(`${source}/`));
    const moved = documents.map((member) => ({
      id: member.id,
      from: member.path,
      to: rebase(member.path, source, destination.path),
    }));

    const operations: FileOperation[] = destination.caseOnly
      ? twoHops(
          source,
          destination.path,
          documents.map((member) => member.path),
        )
      : [
          {
            kind: "renameDir",
            from: source,
            to: destination.path,
            documents: documents.map((member) => member.path),
          },
        ];

    if (destination.caseOnly) declareBothSpellings(workspace, moved);
    applyOperations(workspace, moved[0]?.id ?? "", operations);

    const commit = await finishMutation(workspace, {
      docId: moved[0]?.id ?? "",
      ...(moved.length === 0 ? {} : { docIds: moved.map((entry) => entry.id) }),
      actor,
      plan: {
        stage: [source, destination.path],
        project: moved.map((entry) => entry.to),
        unproject: moved.map((entry) => entry.from),
        commit: {
          subject: `folder rename: ${source} → ${destination.path} (${countOf(moved.length)}) by ${actor}`,
          act: "commits-alone",
          // The one case `--only` cannot record; see `CommitRequest.forget`.
          ...(destination.caseOnly ? { forget: [source] } : {}),
        },
        keys: keysFor(members),
        mayChangeTree: true,
      },
    });

    // Every document the act moved, then every thread that moved with its
    // parent. A thread's own file does not move — threads are flat at
    // `data/threads/<id>.md` (§4) — but its folder is its parent's (§6), so the
    // folder it is in has changed and the caller is owed the row. Its `path` is
    // the one it still has, which is what the field says it is.
    const rows: MovedFolderDoc[] = [
      ...moved.map((entry) => ({ id: entry.id, path: entry.to })),
      ...members
        .filter((member) => !member.path.startsWith(`${source}/`))
        .map((member) => ({ id: member.id, path: member.path })),
    ];
    return { documents: rows, warnings: commitWarnings(commit) };
  });
}

/**
 * Archive or restore every document in a folder — `POST /api/folders/archive`
 * and `/unarchive`.
 *
 * **It moves nothing**: archiving a folder is a status act, so every path is
 * unchanged, which is what makes it reversible by name rather than by
 * remembering where things were. The flip itself is `planSetArchived`, the same
 * decision `POST /api/docs/{id}/archive` makes, so a thread gets the treatment it
 * gets one at a time and §5's ladder is read in one place.
 *
 * Every document under the folder is listed, including one already in the state
 * the act asks for: the act applied to it, and the contract's result is the
 * status each document has **after** the act rather than a list of the ones that
 * moved.
 */
export async function setFolderArchived(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  folder: string,
  archived: boolean,
): Promise<FolderStatusResult> {
  assertFolderExists(workspace.workspaceRoot, folder);
  const verb = archived ? "archive" : "unarchive";

  return inFolderLanes(workspace, mutex, folder, async (members) => {
    const held = new Set(members.map((member) => member.id));
    const changed: string[] = [];
    const stage: string[] = [];
    const project: string[] = [];
    const warnings: Warning[] = [];

    for (const member of members) {
      try {
        const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, member.id);
        const plan = planSetArchived(workspace, loaded, archived, held);
        // Already on the side the act asks for. §7's word for it is a no-op, not
        // an error, and the document is still one this act applied to.
        if (plan === null) continue;
        if (plan.text !== null) {
          warnings.push(...validateBeforeWrite(workspace, plan.path, plan.text));
        }
        applyOperations(workspace, member.id, plan.operations);
        changed.push(member.id);
        stage.push(...plan.stage);
        project.push(...plan.project);
      } catch (error) {
        // §10's rule for a bulk act — "applies to what it can and reports what
        // it could not", and "never refuses the whole set because of one
        // document". The result shape has no per-document refusal to carry
        // (CONTRACT-075), so the document is absent from `documents`, which is
        // the honest answer to "what did this act change", and the reason is
        // logged where an operator can read it.
        refusalLogged(workspace, folder, verb, member.id, error);
      }
    }

    const commit =
      changed.length === 0
        ? null
        : await finishMutation(workspace, {
            docId: changed[0] ?? "",
            docIds: changed,
            actor,
            plan: {
              stage: [...new Set(stage)],
              project: [...new Set(project)],
              unproject: [],
              commit: {
                subject: `folder ${verb}: ${folderPath(folder)} (${countOf(changed.length)}) by ${actor}`,
                act: "commits-alone",
              },
              keys: keysFor(members),
              mayChangeTree: true,
            },
          });

    return {
      // Read back rather than predicted: the field the contract asks for is the
      // status the document **has**, and after `finishMutation` the projection
      // is the answer to that.
      documents: statusesAfter(workspace, members),
      warnings: [...warnings, ...commitWarnings(commit)],
    };
  });
}

/**
 * Delete a folder and every document in it — `POST /api/folders/delete`,
 * user-only.
 *
 * **Its threads survive.** §9.2 says a deleted document's threads "become
 * orphaned records that still name it as `parent`", and a folder delete is that
 * act over a set rather than a second rule: deleting the conversations along
 * with the documents would be something no single-document delete does. They
 * are logged, since the result shape names only what was removed.
 *
 * The directory itself goes when the deletions leave it empty. Anything that was
 * never a document — an image, a stray `.csv` — is neither deleted nor moved, so
 * a folder holding one keeps both the file and the folder.
 */
export async function deleteFolder(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  actor: Actor,
  folder: string,
): Promise<DeleteFolderResult> {
  // Before anything is read or written, and whether or not the folder exists:
  // §9.2's user-only rule is about who is asking, not about what is there.
  if (actor === "agent") throw forbidden(AGENT_DELETE_MESSAGE);
  assertFolderExists(workspace.workspaceRoot, folder);

  return inFolderLanes(workspace, mutex, folder, async (members) => {
    const source = folderPath(folder);
    const documents = documentsUnder(workspace.projection, folder);
    const removed: DeletedFolderDoc[] = [];
    const orphanedThreadIds = new Set<string>();
    const stage: string[] = [];
    const unproject: string[] = [];
    const project: string[] = [];

    for (const member of documents) {
      try {
        const loaded = loadDocument(workspace.workspaceRoot, workspace.projection, member.id);
        const plan = planDelete(workspace, loaded);
        applyOperations(workspace, member.id, plan.operations);
        removed.push({ id: member.id });
        stage.push(...plan.stage);
        project.push(...plan.project);
        unproject.push(...plan.unproject);
        for (const id of plan.orphanedThreadIds) orphanedThreadIds.add(id);
      } catch (error) {
        refusalLogged(workspace, folder, "delete", member.id, error);
      }
    }

    const commit =
      removed.length === 0
        ? null
        : await finishMutation(workspace, {
            docId: removed[0]?.id ?? "",
            docIds: removed.map((entry) => entry.id),
            actor,
            plan: {
              stage: [...new Set(stage)],
              project: [...new Set(project)],
              unproject: [...new Set(unproject)],
              commit: {
                subject: `folder delete: ${source} (${countOf(removed.length)}) by ${actor}`,
                act: "commits-alone",
              },
              keys: keysFor(members),
              mayChangeTree: true,
            },
          });

    // After the commit, never before: a directory removed for a deletion that
    // then failed cannot be put back from git, while one left standing for a
    // moment costs nothing.
    pruneEmptyDirectories(workspace.workspaceRoot, source);

    if (orphanedThreadIds.size > 0) {
      workspace.logger.info("a folder delete left threads as orphaned records", {
        folder: source,
        threads: [...orphanedThreadIds],
        note: "SPEC.md §9.2: a deleted document's threads still name it as parent",
      });
    }

    return { documents: removed, warnings: commitWarnings(commit) };
  });
}

/**
 * Run `act` holding every lane a folder act can write, plus the create lane.
 *
 * The membership is read twice on purpose. The first read decides which lanes to
 * take — a question only the current projection answers, and one that has to be
 * asked before any lane is held. The second, inside the lanes, is the
 * authoritative set the act works from. The create lane is held for the whole
 * act so a document cannot be filed into the folder between the two reads and
 * land in a directory that has moved, or under a row that has been dropped.
 */
function inFolderLanes<T>(
  workspace: DocsWorkspace,
  mutex: DocumentMutex,
  folder: string,
  act: (members: ReturnType<typeof membersUnder>) => Promise<T>,
): Promise<T> {
  const prospective = membersUnder(workspace.projection, folder);
  return runInLanes(mutex, [CREATE_LANE, ...prospective.map((member) => member.id)], () =>
    act(membersUnder(workspace.projection, folder)),
  );
}

/**
 * Where `to` actually lands, and whether it is the source under another
 * spelling.
 *
 * The destination's **ancestors** are taken as the filesystem already spells
 * them, and its **leaf** exactly as asked. A rename names one folder, so it may
 * recase that folder and nothing else — and on a case-insensitive filesystem the
 * ancestor's own spelling is what the file will really be at, so recording the
 * requested one would leave the projection naming a path the workspace does not
 * have and `db doctor` reporting drift.
 */
function resolveDestination(workspaceRoot: string, from: string, to: string): Destination {
  const segments = to.split("/");
  const leaf = segments[segments.length - 1] ?? to;
  const ancestors = spelledOnDisk(workspaceRoot, segments.slice(0, -1));
  const path = [DOCS_FOLDER_ROOT, ...ancestors, leaf].join("/");

  const destination = statSync(resolve(workspaceRoot, path), { throwIfNoEntry: false });
  if (destination === undefined) return { path, caseOnly: false };

  const source = statSync(resolve(workspaceRoot, folderPath(from)));
  // The same directory entry reached by two spellings — the whole of what a
  // case-insensitive filesystem does to a case-only rename. Compared by identity
  // rather than by lower-casing the two paths, because the folding a filesystem
  // applies is its own (Unicode on APFS, ASCII elsewhere) and guessing it is how
  // a rename ends up merging two folders.
  if (destination.isDirectory() && destination.dev === source.dev && destination.ino === source.ino)
    return { path, caseOnly: true };

  throw conflict(
    `${path} already exists; a rename never merges two folders — rename or remove the destination first`,
  );
}

/**
 * The spelling each of these folder segments already has on disk, for the ones
 * that exist. A segment nothing matches keeps the spelling the caller asked for,
 * because the rename is about to create it.
 */
function spelledOnDisk(workspaceRoot: string, segments: readonly string[]): string[] {
  let current = resolve(workspaceRoot, DOCS_FOLDER_ROOT);
  const spelled: string[] = [];
  for (const segment of segments) {
    const entries = listing(current);
    const folded = segment.toLowerCase();
    const existing =
      entries.find((entry) => entry === segment) ??
      entries.find((entry) => entry.toLowerCase() === folded);
    const name = existing ?? segment;
    spelled.push(name);
    current = join(current, name);
  }
  return spelled;
}

/**
 * Tell the watcher that a case-only rename's files are the server's own, under
 * **both** spellings.
 *
 * Measured against chokidar 4 on macOS, a directory renamed to another case
 * reports `unlinkDir`, `addDir`, then **`change` at the file's old spelling**
 * and `add` at its new one — because the old path still stats, so nothing was
 * unlinked as far as the watcher can tell. The `change` is what does the damage:
 * the registry's ordinary record for a moved-away file is "this path should now
 * be gone", the event carries the file's bytes instead, so the claim misses and
 * the watcher re-projects the row under the spelling the rename just removed.
 * Reproduced on a real server: `db doctor` then reports `orphan_row` for the old
 * path and `duplicate_id` for the new one, and the row stays wrong until a
 * rebuild.
 *
 * Registering both spellings **with the content** is what the claim needs, and
 * it is honest rather than a suppression: the bytes at both paths are bytes this
 * act just wrote, and nothing else about them changed. Called before
 * `applyOperations`, because the watcher can see a move the instant it lands.
 *
 * The reads are the only per-document cost a rename has, and they are on this
 * path alone — an ordinary rename's old path really does disappear, so its
 * `unlink` is claimed by the removal `renameDir` already records.
 */
function declareBothSpellings(
  workspace: DocsWorkspace,
  moved: readonly { readonly from: string; readonly to: string }[],
): void {
  for (const entry of moved) {
    const absolute = resolve(workspace.workspaceRoot, entry.from);
    let content: Buffer;
    try {
      content = readFileSync(absolute);
    } catch {
      // Gone between the enumeration and here: nothing to declare, and the
      // move's own operations will report it.
      continue;
    }
    workspace.selfWrites.record(absolute, content);
    workspace.selfWrites.record(resolve(workspace.workspaceRoot, entry.to), content);
  }
}

/** What a directory holds, or nothing when it is not a directory this can read. */
function listing(absolute: string): string[] {
  try {
    return readdirSync(absolute);
  } catch {
    return [];
  }
}

/**
 * A case-only rename, as two moves through a name that differs by more than
 * case.
 *
 * POSIX lets a filesystem treat `rename(old, new)` as a no-op when both resolve
 * to the same entry, and a case-insensitive one may. macOS APFS happens to
 * perform the recase, but a rename that silently does nothing on some other
 * volume is not something to leave to luck: the temporary name makes both hops
 * ordinary moves between distinct entries, on every filesystem. It never
 * survives the request — both hops are one all-or-nothing group in
 * `applyOperations`, which rolls the first back if the second throws — and it
 * begins with a dot so nothing indexes or watches it in the instant it exists.
 */
function twoHops(
  source: string,
  destination: string,
  documents: readonly string[],
): FileOperation[] {
  const temporary = `${dirname(destination)}/.corpus-rename-${randomUUID()}`;
  return [
    { kind: "renameDir", from: source, to: temporary, documents: [...documents] },
    {
      kind: "renameDir",
      from: temporary,
      to: destination,
      documents: documents.map((path) => rebase(path, source, temporary)),
    },
  ];
}

/** `data/docs/a/x.md` under `data/docs/a` becomes `data/docs/b/x.md` under `data/docs/b`. */
const rebase = (path: string, from: string, to: string): string =>
  path.startsWith(`${from}/`) ? `${to}/${path.slice(from.length + 1)}` : path;

/**
 * The keys one folder act invalidates: the collection, every document it names
 * and every thread among them. `["tree"]` is deliberately absent — `mayChangeTree`
 * has `runMutation` measure `GET /api/tree`'s own answer instead, because
 * whether a folder badge moved has no answer at a call site (SERVER-018).
 */
const keysFor = (members: ReturnType<typeof membersUnder>): QueryKey[] =>
  dedupeKeys([
    DOCS_KEY,
    ...members.map((member) => docKey(member.id)),
    ...members.filter((member) => member.type === "thread").map((member) => threadKey(member.id)),
  ]);

/** The status each of these documents has now, in the order the act applied. */
function statusesAfter(
  workspace: DocsWorkspace,
  members: ReturnType<typeof membersUnder>,
): FolderStatusChange[] {
  const rows: FolderStatusChange[] = [];
  for (const member of members) {
    const row = workspace.projection
      .prepare("SELECT status FROM documents WHERE id = ?")
      .get(member.id) as { status: string } | undefined;
    if (row === undefined) continue;
    rows.push({ id: member.id, status: row.status as FolderStatusChange["status"] });
  }
  return rows;
}

/**
 * §11's log half for a document a folder act could not apply to. The act stands
 * for everything it did apply to; this is what stops the one it could not from
 * being silent.
 */
function refusalLogged(
  workspace: DocsWorkspace,
  folder: string,
  verb: string,
  docId: string,
  error: unknown,
): void {
  workspace.logger.error("a folder act could not apply to one document", {
    folder: folderPath(folder),
    verb,
    docId,
    error: String(error),
    note: "the act stands for every other document; this one is absent from the result",
  });
}

/**
 * Remove the folder, and everything under it, wherever the deletions left an
 * empty directory. Deepest first, and never recursively: a directory still
 * holding something the act did not delete keeps it, and keeps the folder.
 */
function pruneEmptyDirectories(workspaceRoot: string, path: string): void {
  const absolute = resolve(workspaceRoot, path);
  for (const entry of listing(absolute)) {
    if (statSync(join(absolute, entry), { throwIfNoEntry: false })?.isDirectory() === true) {
      pruneEmptyDirectories(workspaceRoot, `${path}/${entry}`);
    }
  }
  try {
    rmdirSync(absolute);
  } catch {
    // Something is still in it. Leaving it is the whole of the intended
    // behaviour, not a failure to report.
  }
}

/** "1 document" / "4 documents" — a commit subject naming what an act changed (§4). */
const countOf = (total: number): string => `${total} document${total === 1 ? "" : "s"}`;
