// `GET /api/tree` — the `data/docs/` folder tree with counts (SPEC.md §9.2),
// behind folder pickers, folder columns and filter chips.
//
// Built from the projection's `documents.path`, never from a filesystem walk:
// the tree has to agree with the list it scopes, and the list is SQL. Two rules
// come from that agreement (sprint-004 TEST-52):
//
// - **Threads count where their parent is filed.** They are flat in
//   `data/threads/` and are therefore not tree *nodes*, but §10 folder scoping
//   puts them in their parent's folder column, so a folder's badge counts them.
// - **Archived documents are excluded**, exactly as the default result set of
//   `GET /api/docs` excludes them — a badge that counted rows the column does
//   not show would be a bug report waiting to happen.

import type { FolderNode, FolderTree } from "@corpus/contract";
import type { ProjectionDb } from "../projection/index.js";
import { DOCS_ROOT } from "./query.js";

/**
 * One row per counted document: the path of the document itself, or of the
 * parent document a thread hangs from. A thread whose parent was deleted (§9.2's
 * orphaned record) contributes nothing, matching `?folder=` which cannot place
 * it either.
 */
const FOLDER_PATHS_SQL = `
  SELECT d.path AS path
    FROM documents d
   WHERE d.status <> 'archived' AND d.path LIKE '${DOCS_ROOT}/%'
  UNION ALL
  SELECT p.path AS path
    FROM threads t
    JOIN documents td ON td.id = t.id
    JOIN documents p ON p.id = t.parent_id
   WHERE td.status <> 'archived' AND p.path LIKE '${DOCS_ROOT}/%'
`;

/** The folder a workspace-relative document path is filed in, relative to `data/docs/`. */
function folderOf(path: string): string {
  const relative = path.slice(DOCS_ROOT.length + 1);
  const slash = relative.lastIndexOf("/");
  return slash < 0 ? "" : relative.slice(0, slash);
}

interface MutableNode {
  readonly path: string;
  readonly name: string;
  count: number;
  readonly children: Map<string, MutableNode>;
}

const emptyNode = (path: string, name: string): MutableNode => ({
  path,
  name,
  count: 0,
  children: new Map(),
});

/** Walks to a folder, creating every ancestor: `finance/2026` implies `finance`. */
function ensureNode(roots: Map<string, MutableNode>, folder: string): MutableNode | null {
  const segments = folder.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return null;

  let level = roots;
  let node: MutableNode | null = null;
  let path = "";
  for (const segment of segments) {
    path = path === "" ? segment : `${path}/${segment}`;
    let child = level.get(segment);
    if (child === undefined) {
      child = emptyNode(path, segment);
      level.set(segment, child);
    }
    node = child;
    level = child.children;
  }
  return node;
}

function freeze(node: MutableNode): FolderNode {
  const children = [...node.children.values()]
    .sort((left, right) => (left.name < right.name ? -1 : 1))
    .map(freeze);
  return {
    path: node.path,
    name: node.name,
    count: node.count,
    totalCount: node.count + children.reduce((sum, child) => sum + child.totalCount, 0),
    children,
  };
}

/** The `data/docs/` folder tree, roots first, with direct and recursive counts. */
export function folderTree(db: ProjectionDb): FolderTree {
  const rows = db.prepare(FOLDER_PATHS_SQL).all() as { path: string }[];
  const roots = new Map<string, MutableNode>();

  for (const row of rows) {
    // Documents filed at the root of `data/docs/` belong to no folder node;
    // they are still listed by `?folder=/`, which scopes by prefix.
    const node = ensureNode(roots, folderOf(row.path));
    if (node === null) continue;
    node.count += 1;
  }

  return {
    folders: [...roots.values()]
      .sort((left, right) => (left.name < right.name ? -1 : 1))
      .map(freeze),
  };
}

/**
 * A comparable snapshot of what `GET /api/tree` would answer right now.
 *
 * SPEC.md §9's invalidation rule for `["tree"]` is a statement about the
 * *response*: a frame carries the key exactly when the tree a client would
 * refetch actually changed. Deciding that from the mutation's own shape means
 * re-deriving {@link FOLDER_PATHS_SQL}'s rules — which documents are counted,
 * under whose folder a thread counts, what an archived row contributes — at
 * every write site, and the moment those copies disagree with this file the
 * board desynchronises silently. So the answer is taken from the same function
 * the route calls, before the write and after the projection is current:
 * `runMutation` compares two signatures and announces the difference (see
 * `MutationPlan.mayChangeTree`).
 *
 * The tree is a plain data structure with a deterministic order (folders and
 * children are sorted by name), so serialising it is a faithful identity: equal
 * strings mean a byte-identical response.
 */
export function folderTreeSignature(db: ProjectionDb): string {
  return JSON.stringify(folderTree(db));
}
