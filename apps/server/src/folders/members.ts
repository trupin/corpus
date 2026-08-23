// What a folder **is**, on disk and in the projection (SPEC.md §9.2's folder
// acts, rider 7 signed 2026-08-22).
//
// A folder act names a directory, and two questions follow from that: does the
// directory exist, and what does it hold. Both are answered here so the four
// acts cannot answer them four different ways.
//
// **Both answers are byte-exact.** The path grammar is the contract's
// (`FolderPathSchema`), which compares exactly — a rename that differs only in
// case is a rename, not a no-op — and an act that then matched
// case-insensitively would archive `finance` because the caller wrote
// `Finance`. Two places would otherwise let case in by the back door: a
// case-insensitive filesystem answers `existsSync` for a spelling it does not
// have, and SQLite's `LIKE` folds ASCII case whatever the collation. So
// existence is decided by looking each segment up in its parent's own listing,
// and every row a query returns is filtered again in TypeScript against the
// prefix it was meant to match.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DOCS_FOLDER_ROOT } from "@corpus/contract";
import { notFound } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";

/** The workspace-relative path of a folder named relative to `data/docs/`. */
export const folderPath = (folder: string): string => `${DOCS_FOLDER_ROOT}/${folder}`;

/** Escapes a `LIKE` prefix so a folder named `q_1` cannot match `q11`. */
const likePrefix = (value: string): string => `${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Whether `folder` exists **spelled exactly as asked**, relative to `data/docs/`.
 *
 * Each segment is required to appear byte-for-byte in its parent's `readdir`,
 * for the reason SERVER-010 required it of an attachment path: macOS resolves
 * and `stat`s a path whose case it does not have, so `existsSync` alone would
 * make `Finance` and `finance` the same folder on one platform and two folders
 * on another. The act would then move different files depending on the
 * developer's laptop.
 */
export function folderExists(workspaceRoot: string, folder: string): boolean {
  let current = resolve(workspaceRoot, DOCS_FOLDER_ROOT);
  if (!existsSync(current)) return false;
  for (const segment of folder.split("/")) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    current = join(current, segment);
  }
  return statSync(current, { throwIfNoEntry: false })?.isDirectory() === true;
}

/**
 * The `404` every folder act owes a path this workspace does not hold — one
 * sentence, whichever act asked, because "there is no such folder" is one fact.
 */
export function assertFolderExists(workspaceRoot: string, folder: string): void {
  if (folderExists(workspaceRoot, folder)) return;
  throw notFound(`no folder ${folderPath(folder)}`);
}

/** One document a folder act applies to, as the projection has it. */
export type FolderMember = {
  readonly id: string;
  /** Workspace-relative path — `data/threads/<id>.md` for a thread (§4). */
  readonly path: string;
  readonly type: string;
  readonly status: string;
};

type MemberRow = FolderMember & { readonly folderPath: string };

/**
 * Every document filed under `folder`, **recursively**, in path order.
 *
 * The recursion is the prefix: `data/docs/a/%` matches `a/b/c.md` as readily as
 * `a/c.md`, which is what makes a folder act reach a whole subtree without a
 * walk. Path order rather than id order so a nested document follows its
 * parent folder in every result and in every commit trailer.
 */
export function documentsUnder(db: ProjectionDb, folder: string): FolderMember[] {
  const prefix = `${folderPath(folder)}/`;
  const rows = db
    .prepare(
      `SELECT id, path, type, status, path AS folderPath
         FROM documents
        WHERE path LIKE ? ESCAPE '\\'
        ORDER BY path`,
    )
    .all(likePrefix(prefix)) as MemberRow[];
  return exactly(rows, prefix);
}

/**
 * Every thread whose parent is filed under `folder` (SPEC.md §6: a thread
 * inherits its parent's folder).
 *
 * Threads are flat at `data/threads/<id>.md`, so this is never about where their
 * files sit — it is the same membership `GET /api/docs?folder=` reports, asked
 * of the same join, so a folder act covers exactly the set a folder column
 * shows. A thread whose parent was deleted belongs to no folder and is absent
 * here, matching the filter that cannot place it either.
 */
export function threadsUnder(db: ProjectionDb, folder: string): FolderMember[] {
  const prefix = `${folderPath(folder)}/`;
  const rows = db
    .prepare(
      `SELECT d.id AS id, d.path AS path, d.type AS type, d.status AS status,
              p.path AS folderPath
         FROM threads t
         JOIN documents d ON d.id = t.id
         JOIN documents p ON p.id = t.parent_id
        WHERE p.path LIKE ? ESCAPE '\\'
        ORDER BY p.path, d.id`,
    )
    .all(likePrefix(prefix)) as MemberRow[];
  return exactly(rows, prefix);
}

/**
 * Everything a folder act applies to: the documents filed there and the threads
 * about them, documents first.
 *
 * Documents first because they are what the folder holds and the threads follow
 * from them — and because an act that writes both wants the parent's write
 * ahead of its conversations in the one commit it makes.
 */
export const membersUnder = (db: ProjectionDb, folder: string): FolderMember[] => [
  ...documentsUnder(db, folder),
  ...threadsUnder(db, folder),
];

/**
 * Drops the rows `LIKE` matched only by folding case. SQLite's `LIKE` is
 * case-insensitive for ASCII whatever the collation, and no `PRAGMA` narrows it
 * for one query, so the comparison the grammar promises is made here.
 */
const exactly = (rows: readonly MemberRow[], prefix: string): FolderMember[] =>
  rows
    .filter((row) => row.folderPath.startsWith(prefix))
    .map(({ id, path, type, status }) => ({ id, path, type, status }));
