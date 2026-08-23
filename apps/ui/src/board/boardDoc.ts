import type { DocRow } from "@corpus/contract";
import { readStoredWidth } from "./columnWidth";

/**
 * The board-document contract, read (SPEC.md §10, rider 2 — "a board is a
 * `type: board` document").
 *
 * Everything a board *is* — its title, the ids of the view documents that are
 * its columns, its position among boards, whether it receives opens that name no
 * board, and its kanban block — lives in that document's frontmatter and reaches
 * the client as first-class fields on the collection row (CONTRACT-074). This
 * module turns one such row into the shape the board bar renders.
 *
 * **Nothing here invents a board.** A workspace with no `type: board` document
 * has no boards, and the bar says so rather than conjuring one — which is what
 * makes `corpus upgrade`'s migration (SPEC.md §2.4) the thing that creates them.
 */

/** A kanban block as the wire carries it (UI-152 renders it; this only carries it). */
export type KanbanSpec = NonNullable<DocRow["kanban"]>;

export interface Board {
  /** The board document's id. The board has no identity of its own. */
  readonly id: string;
  readonly title: string;
  /**
   * Its position among boards, or `null` for a file carrying no `order` key —
   * such a board is placed by the tiebreak below, never dropped.
   */
  readonly order: number | null;
  /**
   * The ids of the `type: view` documents that are its columns, **in file
   * order**. Not deduplicated: a file that lists the same view twice gets two
   * columns, because that is what the file says (UI-148's edge case).
   */
  readonly columnIds: readonly string[];
  /** Set on a kanban board, whose columns are stages rather than views (rider 6). */
  readonly kanban: KanbanSpec | null;
  /** True on the one board that receives every open that names no board. */
  readonly defaultOpen: boolean;
  /** A kanban board's scope query. `null` on an ordinary board. */
  readonly query: Readonly<Record<string, unknown>> | null;
  /**
   * The width this board's **derived** columns render at (SPEC.md §10), or
   * `null` for the default.
   *
   * A view column's width is its own view document's, because a view is a
   * document and may sit on two boards at two widths. A kanban's stages are not
   * documents, so the one file that can hold their width is the board — and one
   * width for every stage is also what a kanban wants: columns a person compares
   * side by side should be the same size.
   */
  readonly width: number | null;
}

/** Where board documents are filed, matching the workspace the seed ships. */
export const BOARD_DOCUMENT_FOLDER = "boards";

export function toBoard(row: DocRow): Board {
  return {
    id: row.id,
    title: row.title,
    order: row.order,
    columnIds: row.columns ?? [],
    kanban: row.kanban,
    defaultOpen: row.defaultOpen,
    query: row.query,
    width: readStoredWidth(row.extra),
  };
}

/**
 * The server's documented tiebreak under `sort=order` (CONTRACT-074,
 * SERVER-138): `order` ascending with **nulls last**, then `title` case-
 * insensitively, then `id`.
 *
 * Re-applied here for the reason `compareColumns` used to be: it makes the
 * ordering testable without a server, and it is what decides UI-148's first edge
 * case — two boards carrying the same `order` render in the same sequence on
 * every load rather than in whatever sequence the array arrived in.
 */
export function compareBoards(left: Board, right: Board): number {
  if (left.order !== right.order) {
    if (left.order === null) return 1;
    if (right.order === null) return -1;
    return left.order - right.order;
  }
  const leftTitle = left.title.toLocaleLowerCase();
  const rightTitle = right.title.toLocaleLowerCase();
  if (leftTitle !== rightTitle) return leftTitle < rightTitle ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Which board a browser shows (SPEC.md §10, rider 2 as amended 2026-08-22).
 *
 * Three steps, in this order, and the order is the rule: the board this browser
 * last chose, then the one carrying `default-open`, then the first in `order`.
 * A remembered board that is archived or deleted is no longer in `boards`, so it
 * falls through to exactly the same answer a fresh browser gets — which is the
 * whole reason the remembered id is checked against the live list rather than
 * trusted.
 */
export function resolveBoard(boards: readonly Board[], remembered: string | null): Board | null {
  if (remembered !== null) {
    const chosen = boards.find((board) => board.id === remembered);
    if (chosen !== undefined) return chosen;
  }
  return boards.find((board) => board.defaultOpen) ?? boards[0] ?? null;
}

/**
 * The board that receives an open naming no board — the explorer's target
 * (SPEC.md §10, rider 2 as amended 2026-08-22: "`default-open` receives every
 * open that names no board, falling back to the first in `order`").
 *
 * The same two steps {@link resolveBoard} takes once it has no remembered id,
 * named separately because they answer a different question: which board is
 * *showing* is this browser's, and which board *receives* is the corpus's. The
 * seed makes the difference visible — `default-open` sits on Files, which is
 * third in `order`, so a fallback that assumed "the first tab" picks the wrong
 * board on the shipped workspace (UI-148).
 */
export function defaultOpenBoard(boards: readonly Board[]): Board | null {
  return resolveBoard(boards, null);
}
