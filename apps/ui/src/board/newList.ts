import type { FolderNode, FolderTree } from "@corpus/contract";
import type { CreateDocInput } from "@corpus/kit";

/**
 * The new-list picker's offer, and what each choice creates (SPEC.md §11 — the
 * trailing ghost column: "a folder, a library/preset view, a plugin column
 * type, or from current search").
 *
 * Every choice lands the same way: **one `POST /api/docs` creating a pinned
 * `type: view` document**. There is no other mechanism for a column to come
 * into being, which is what makes a board reproducible from the workspace alone
 * and stewardable by the agent ("@agent pin me a view of unresolved finance
 * threads" is this same document, written by the agent instead).
 */

/** Where view documents are filed, matching the workspace the seed ships. */
export const VIEW_DOCUMENT_FOLDER = "views";

export type NewListSource = "folder" | "preset" | "plugin" | "search";

export interface NewListChoice {
  /** Stable within a rendered menu; also the React key. */
  readonly key: string;
  readonly source: NewListSource;
  readonly title: string;
  readonly query: Readonly<Record<string, string>>;
  /** A `"<plugin>/<type>"` reference for a plugin column (SPEC.md §10). */
  readonly column?: string;
  /** Secondary text — a folder's document count, a preset's filter. */
  readonly detail: string;
}

/**
 * The preset library.
 *
 * Deliberately **disjoint from the seed columns**: the workspace already ships
 * Attention, Inbox and Open threads as documents, and a picker that re-offered
 * them would be the board's own column set restated in TypeScript — the thing
 * SPEC.md §11's "nothing hardwired" forbids. These are starting points the seed
 * does not cover, and every one of them is only a query: choosing it writes a
 * document the user can then rename, re-query or archive like any other.
 */
export const PRESET_CHOICES: readonly NewListChoice[] = [
  {
    key: "preset:due",
    source: "preset",
    title: "Due this week",
    query: { due: "week" },
    detail: "due=week",
  },
  {
    key: "preset:replies",
    source: "preset",
    title: "Unread replies",
    query: { needs: "unread-reply" },
    detail: "needs=unread-reply",
  },
  {
    key: "preset:stale",
    source: "preset",
    title: "Stale for review",
    query: { stale: "stale" },
    detail: "stale=stale",
  },
  {
    key: "preset:skills",
    source: "preset",
    title: "Skills & agents",
    query: { type: "skill,agent-def" },
    detail: "type=skill,agent-def",
  },
  {
    key: "preset:archived",
    source: "preset",
    title: "Archived",
    query: { status: "archived" },
    detail: "status=archived",
  },
];

function walkFolders(nodes: readonly FolderNode[], into: NewListChoice[]): void {
  for (const node of nodes) {
    if (node.path !== "") {
      into.push({
        key: `folder:${node.path}`,
        source: "folder",
        // The folder's own name is the column's title; the query carries the path.
        title: node.name,
        query: { folder: node.path },
        detail: `${String(node.totalCount)} ${node.totalCount === 1 ? "doc" : "docs"}`,
      });
    }
    walkFolders(node.children, into);
  }
}

/**
 * Every folder under `data/docs/`, with the count `GET /api/tree` reports.
 *
 * Descendants are offered too — the hierarchy is the primary organization
 * (SPEC.md §11) and a column scoped to `finance/mortgage` is as legitimate as
 * one scoped to `finance`. `totalCount` rather than `count`, because a folder
 * query matches the folder *and its descendants*.
 */
export function folderChoices(tree: FolderTree | undefined): readonly NewListChoice[] {
  if (tree === undefined) return [];
  const choices: NewListChoice[] = [];
  walkFolders(tree.folders, choices);
  return choices;
}

/** "From current search", offered only while a search query actually exists. */
export function searchChoice(query: string): NewListChoice | null {
  const trimmed = query.trim();
  if (trimmed === "") return null;
  return {
    key: "search:current",
    source: "search",
    title: trimmed,
    query: { q: trimmed },
    detail: `q=${trimmed}`,
  };
}

/**
 * The `POST /api/docs` body for a chosen list.
 *
 * `evergreen: true` because a column is configuration, not content: a board
 * whose Inbox column grew archive-or-act buttons for being six months old would
 * be the staleness ramp (SPEC.md §5) firing at the furniture. The seed's own
 * view documents carry it for the same reason.
 */
export function columnRequest(choice: NewListChoice, order: number): CreateDocInput {
  return {
    type: "view",
    title: choice.title,
    folder: VIEW_DOCUMENT_FOLDER,
    pinned: true,
    order,
    query: choice.query,
    evergreen: true,
    ...(choice.column === undefined ? {} : { column: choice.column }),
  };
}

/** Keeps a positioned menu on screen — the prototype's clamp, verbatim. */
export interface MenuPosition {
  readonly left: number;
  readonly top: number;
}

export const MENU_WIDTH = 280;
export const MENU_HEIGHT = 220;

export function clampMenuPosition(
  clientX: number,
  clientY: number,
  viewport: { readonly width: number; readonly height: number },
): MenuPosition {
  return {
    left: Math.min(viewport.width - MENU_WIDTH, Math.max(8, clientX - 40)),
    top: Math.min(viewport.height - MENU_HEIGHT, Math.max(8, clientY - 10)),
  };
}
