import type { FolderNode } from "@corpus/contract";
import type { WorkspaceCommandSpec } from "../registry/types.js";

/**
 * `corpus tree` — the folder structure, in one bounded call (CLI-023).
 *
 * `GET /api/tree` has backed the board's folder pickers since Phase 3 and no
 * verb exposed it, so the agent could not see the shape of the corpus at all.
 * The comment skill's old workaround was a raw read of `data/docs/`, which
 * AGENT-008's retrieval-first pass removed and did not replace. SPEC.md §7 makes
 * the CLI the agent's only door, so a route with no verb behind it is a part of
 * the product the agent cannot reach.
 *
 * **Structure is not enumeration**, which is why this does not breach §7's
 * retrieval discipline. What comes back is folders and how many documents are in
 * them — never a title, never a body, never an id. It answers *where would this
 * go?* and it cannot answer *what is in the corpus?*, which is what `search` is
 * for. The count is what makes it useful for filing: an empty folder and one
 * holding two hundred documents are different answers to the same question.
 */

/** How deep a folder sits, as its indent. */
const INDENT = "  ";

/**
 * One line per folder: the path, then its counts.
 *
 * The **path**, not the name, because the path is what `--folder` takes and a
 * name repeated at two depths would be ambiguous exactly when it mattered. The
 * indent carries the shape for a person reading; the path carries it for
 * anything else.
 *
 * `count` alone where a folder has no children, `count (totalCount)` where it
 * does and the two differ — a parent whose own documents are outnumbered by its
 * descendants' is the common case, and printing one number there would hide
 * whichever it was not.
 */
export function treeLines(folders: readonly FolderNode[], depth = 0): readonly string[] {
  return folders.flatMap((folder) => [
    `${INDENT.repeat(depth)}${folder.path}  ${counts(folder)}`,
    ...treeLines(folder.children, depth + 1),
  ]);
}

function counts(folder: FolderNode): string {
  const own = String(folder.count);
  return folder.totalCount === folder.count ? own : `${own} (${String(folder.totalCount)})`;
}

export const treeCommand: WorkspaceCommandSpec = {
  name: "tree",
  summary: "The folder structure of `data/docs/`, with document counts.",
  description:
    "One bounded call that answers *where does this go?* — every folder under `data/docs/`, " +
    "indented by depth, with the number of documents filed directly in it and, where they " +
    "differ, the number including its descendants in parentheses. It is **structure, not " +
    "enumeration** (SPEC.md §7): no titles, no ids, no bodies, so it never stands in for a " +
    "search. Threads inherit their parent document's folder and are counted where they are " +
    "filed. A workspace with no folders prints nothing and exits 0 — an empty tree is an " +
    "answer, not a failure.",
  args: [],
  flags: [],
  examples: [
    { command: "corpus tree", description: "Every folder, indented, with its counts." },
    {
      command: "corpus tree --json",
      description: "The wire shape unchanged, for a caller that wants the nesting.",
    },
  ],
  handler: async (context) => {
    const tree = await context.client.request((api) => api.GET("/api/tree"));
    context.out.emit(tree);
    for (const line of treeLines(tree.folders)) context.out.line(line);
  },
};
