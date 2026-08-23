import type { DocRow, FolderNode } from "@corpus/contract";
import { stalenessLevel, type StalenessLevel } from "@corpus/kit";

/**
 * The explorer's tree, as a flat list of rows (SPEC.md §10, rider 1: "shows the
 * workspace as a tree: `GET /api/tree`'s folders, and under each folder its
 * documents").
 *
 * **Flat rather than nested, and that is the whole design.** A nested render
 * makes the keyboard's `↑`/`↓` a tree walk and the "update rows in place" rule a
 * per-subtree problem. One list, keyed, indented by a `--d` custom property, is
 * what makes both trivial: moving the cursor is `index ± 1`, and React reuses
 * every row whose key survives — which is what stops Chrome dropping a double
 * click when the first click changes what the row says (the prototype's own
 * warning, and this issue's Key Implementation Detail).
 *
 * **Pure, and given everything.** Folders come from `GET /api/tree`, documents
 * from one `GET /api/docs?folder=…` per expanded folder, and the marks from the
 * board's browser-local strip. Nothing here fetches, so the ordering rule, the
 * bound line and the mark precedence are all testable without a DOM or a server.
 */

/**
 * How many documents one folder lists before the listing says it stopped
 * (SPEC.md §10: "a listing that reached its bound says so rather than ending
 * quietly"). A folder of thousands must not be a scroll of everything.
 */
export const EXPLORER_FOLDER_LIMIT = 100;

export interface FolderTreeRow {
  readonly kind: "folder";
  readonly key: string;
  /** Relative to `data/docs/`, exactly as the server spells it. */
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  /** Documents in this folder and every folder under it. */
  readonly count: number;
  readonly collapsed: boolean;
}

export interface DocTreeRow {
  readonly kind: "doc";
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly type: string;
  /** The folder this row is filed under, for the menu that acts on it. */
  readonly folder: string;
  readonly depth: number;
  /** The document's own status, for the menu that acts on it. */
  readonly status: string;
  /** The staleness rung, so the tree's menu offers the same acts a row's does. */
  readonly staleLevel: StalenessLevel;
  /** Explorer lists include archived documents — the one list that does. */
  readonly archived: boolean;
  /** This row is the explorer path's origin: the path hanging off it is showing. */
  readonly isOrigin: boolean;
  /** Open somewhere on the showing board, but not this path's origin. */
  readonly isOpen: boolean;
  /** A `type: board` row for the board currently showing. */
  readonly isCurrentBoard: boolean;
}

/** The listing stopped at its bound, and says so rather than ending quietly. */
export interface BoundTreeRow {
  readonly kind: "bound";
  readonly key: string;
  readonly folder: string;
  readonly depth: number;
  readonly shown: number;
  readonly total: number;
}

/** The folder's documents have been asked for and have not arrived. */
export interface PendingTreeRow {
  readonly kind: "pending";
  readonly key: string;
  readonly folder: string;
  readonly depth: number;
  /** `null` while loading; the reason when the read failed. */
  readonly error: string | null;
}

export type TreeRow = FolderTreeRow | DocTreeRow | BoundTreeRow | PendingTreeRow;

/** One expanded folder's answer, as {@link useFolderDocs} reports it. */
export interface FolderDocs {
  readonly items: readonly DocRow[];
  /** Rows matching the query, ignoring the limit — `page.total`. */
  readonly total: number;
  readonly isPending: boolean;
  readonly error: string | null;
}

export interface TreeInput {
  readonly folders: readonly FolderNode[];
  /** One entry per **expanded** folder path; absent means "not expanded". */
  readonly docsByFolder: ReadonlyMap<string, FolderDocs>;
  /**
   * Whether a folder is drawn open. Closed is the default, so a tree nobody has
   * touched asks for no folder listings at all (`useExplorerLayout`).
   */
  readonly isExpanded: (path: string) => boolean;
  /** Documents open somewhere on the showing board (`openDocsOn`). */
  readonly openDocs: ReadonlySet<string>;
  /** The document the explorer's preview path hangs off, or `null`. */
  readonly originDoc: string | null;
  /** The board being shown, so its own row can say so. */
  readonly currentBoardId: string | null;
}

const byName = (left: FolderNode, right: FolderNode): number => left.name.localeCompare(right.name);

const byTitle = (left: DocRow, right: DocRow): number => left.title.localeCompare(right.title);

/**
 * The rows, depth-first: each folder, then its sub-folders, then its own
 * documents — the prototype's `walk`, with folders before documents at every
 * level so a deep tree does not bury its structure under a long file list.
 *
 * A collapsed folder contributes its own row and nothing else. An expanded
 * folder whose documents have not arrived contributes a pending row, so the
 * caret never flips onto emptiness that might be a loading state.
 */
export function buildTreeRows(input: TreeInput): readonly TreeRow[] {
  const rows: TreeRow[] = [];

  const walk = (nodes: readonly FolderNode[], depth: number): void => {
    for (const node of [...nodes].sort(byName)) {
      const collapsed = !input.isExpanded(node.path);
      rows.push({
        kind: "folder",
        key: `f:${node.path}`,
        path: node.path,
        name: node.name,
        depth,
        count: node.totalCount,
        collapsed,
      });
      if (collapsed) continue;
      walk(node.children, depth + 1);
      pushDocs(node, depth + 1);
    }
  };

  const pushDocs = (node: FolderNode, depth: number): void => {
    const pending = (error: string | null): void => {
      rows.push({ kind: "pending", key: `p:${node.path}`, folder: node.path, depth, error });
    };
    const answer = input.docsByFolder.get(node.path);
    // A failure is said whatever the folder holds: a read that failed is not the
    // same fact as a folder that is empty.
    if (answer !== undefined && answer.error !== null) {
      pending(answer.error);
      return;
    }
    if (answer === undefined || answer.isPending) {
      // A folder holding nothing directly is not waiting for anything: the caret
      // is open, its sub-folders are drawn, and there is simply no file row.
      if (node.count === 0) return;
      pending(null);
      return;
    }
    for (const row of [...answer.items].sort(byTitle)) {
      rows.push({
        kind: "doc",
        key: `d:${row.id}`,
        id: row.id,
        title: row.title,
        type: row.type,
        folder: node.path,
        depth,
        status: row.status,
        staleLevel: stalenessLevel(row.stale),
        archived: row.status === "archived",
        isOrigin: input.originDoc === row.id,
        // The origin row draws its own mark; a document that is both shows the
        // stronger one rather than two marks in the same slot.
        isOpen: input.openDocs.has(row.id) && input.originDoc !== row.id,
        isCurrentBoard: row.type === "board" && row.id === input.currentBoardId,
      });
    }
    if (answer.items.length < answer.total) {
      rows.push({
        kind: "bound",
        key: `b:${node.path}`,
        folder: node.path,
        depth,
        shown: answer.items.length,
        total: answer.total,
      });
    }
  };

  walk(input.folders, 0);
  return rows;
}

/** What the bound row says. One sentence, so the surface and its test agree. */
export function boundLabel(shown: number, total: number): string {
  return `${String(shown)} of ${String(total)} — the listing reached its bound`;
}
