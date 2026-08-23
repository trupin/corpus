import { plural } from "../input.js";
import type { DocumentOnDisk } from "./corpus.js";
import {
  defineMigration,
  fromFlag,
  shellQuote,
  type MigrationContext,
  type RegisteredMigration,
} from "./registry.js";

/**
 * `views-to-board` — the first registry entry (CLI-061).
 *
 * Rider 2, signed 2026-08-22: **a board is a `type: board` document** whose
 * frontmatter lists its columns, and a `type: view` document is a saved query
 * and nothing more — it has no `pinned` and no `order`. Phase 41 removed both
 * keys rather than deprecating them, by the user's decision the same day, on the
 * condition that `corpus upgrade` names the migration (issues/PLAN.md, Phase 41).
 * This file is that condition.
 *
 * What the removal costs a workspace written before it is specific and total:
 * the board used to be "every view with `pinned: true`, sorted by `order`", and
 * nothing reads either key now, so a workspace whose three seed views are pinned
 * and which has no board document **shows an empty board**. The commands below
 * are what put it back — and they put back a *working* board, not merely a
 * `pinned`-free one: the created board is `--default-open true`, so the board
 * that receives every open that names no board is the one that was just built.
 *
 * The keys themselves are harmless where they remain. SPEC.md §5's frontmatter
 * is an open shape: an unrecognised key parses, round-trips and is kept, so a
 * leftover `pinned:` costs a workspace nothing. That is why unsetting it is the
 * migration's **optional** half and never its point — the point is the board.
 */

/** The frontmatter key a board lists its columns under, exactly as the file writes it. */
const COLUMNS_KEY = "columns";

/** Where a board document goes when this migration creates one. */
const BOARD_FOLDER = "boards";

/** The title the created board gets. Renamed later like any document's. */
const BOARD_TITLE = "Board";

interface ViewsToBoardHit {
  /** Views a board must be made to list, in the order they should appear. */
  readonly stranded: readonly DocumentOnDisk[];
  /** Views whose `pinned`/`order` is dead weight and breaks nothing. */
  readonly tidy: readonly DocumentOnDisk[];
  /** The board to extend, or `null` when this workspace has none to extend. */
  readonly board: DocumentOnDisk | null;
  /** `board`'s current columns, in file order — empty when there is no board. */
  readonly existingColumns: readonly string[];
}

export const viewsToBoard: RegisteredMigration = defineMigration<ViewsToBoardHit>({
  id: "views-to-board",

  detect(context: MigrationContext): ViewsToBoardHit | null {
    const documents = context.corpus.documents;
    const boards = documents.filter((document) => document.type === "board");
    // Every board's columns, archived boards included: an archived board still
    // lists its views, and it can be restored — reporting its columns as
    // stranded would tell the operator to build a second board over the same
    // views (the issue's own edge case).
    const listed = new Set(boards.flatMap((board) => columnsOf(board)));

    const stranded: DocumentOnDisk[] = [];
    const tidy: DocumentOnDisk[] = [];
    for (const view of documents) {
      if (view.type !== "view") continue;
      // Unaddressable: no `id` means no `corpus doc edit <id>`, and a command
      // that cannot be pasted is worse than silence.
      if (view.id === null) continue;
      const carriesPinnedKey = "pinned" in view.frontmatter;
      const carriesOrderKey = "order" in view.frontmatter && view.frontmatter.order !== null;
      if (!carriesPinnedKey && !carriesOrderKey) continue;
      const relied = view.frontmatter.pinned === true || carriesOrderKey;
      if (relied && !listed.has(view.id)) stranded.push(view);
      else tidy.push(view);
    }

    // The entry fires on the half that is **broken**. A leftover key on a view
    // a board already lists is tidy-up, and tidy-up alone is not a migration.
    if (stranded.length === 0) return null;

    const board = pickBoard(boards);
    return {
      stranded: [...stranded].sort(byBoardOrder),
      tidy: [...tidy].sort(byBoardOrder),
      board,
      existingColumns: board === null ? [] : columnsOf(board),
    };
  },

  statement(hit: ViewsToBoardHit): string {
    const count = plural(hit.stranded.length, "view document");
    return (
      "`pinned` and a view's `order` are no longer read — a column appears on a board because " +
      "that board's own `columns` list names its id (SPEC.md §10, rider 2) — and " +
      `${count} here still ${hit.stranded.length === 1 ? "relies" : "rely"} on them` +
      (hit.board === null
        ? ", with no board document in this workspace to list them, so the board bar is empty."
        : `, while no board lists ${hit.stranded.length === 1 ? "it" : "them"}.`)
    );
  },

  instruct(hit: ViewsToBoardHit, context: MigrationContext): readonly string[] {
    const from = fromFlag(context.actor);
    const ids = hit.stranded.map((view) => view.id ?? "");
    const board =
      hit.board === null
        ? `corpus doc create --type board --title ${shellQuote(BOARD_TITLE)} ` +
          `--folder ${BOARD_FOLDER} --columns ${ids.join(",")} --default-open true${from}`
        : // `--columns` is the whole list, not an append: the flag sets the key,
          // and order is the value. Existing columns first, in the order the
          // board already has them, so nothing on the board moves.
          `corpus doc edit ${hit.board.id ?? ""} --columns ${dedupe([...hit.existingColumns, ...ids]).join(",")}${from}`;
    return [board, ...hit.stranded.map((view) => unsetCommand(view, from))];
  },

  optional(hit: ViewsToBoardHit, context: MigrationContext): readonly string[] {
    return hit.tidy.map((view) => unsetCommand(view, fromFlag(context.actor)));
  },
});

/**
 * Both keys, always, on every view the migration names.
 *
 * Unsetting a key the document does not carry is a no-op that exits 0 (CLI-060),
 * so one shape covers a view that carries `pinned` only, `order` only, or both —
 * and the block stays re-runnable, which is what makes an interrupted migration
 * recoverable by pasting it again.
 */
function unsetCommand(view: DocumentOnDisk, from: string): string {
  return `corpus doc edit ${view.id ?? ""} --unset pinned --unset order${from}`;
}

/** A board's `columns`, as strings, ignoring anything that is not one. */
function columnsOf(board: DocumentOnDisk): readonly string[] {
  const value = board.frontmatter[COLUMNS_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

/**
 * The board a stranded view is added to when this workspace has one.
 *
 * The board bar's own order, so the answer is the board a person would call
 * "the first one": the `default-open` board if there is one, then `order`
 * ascending with nulls last, then title, then id (the tiebreak SPEC.md §10 and
 * `apps/server/src/docs/query.ts` already document). Archived boards sort last —
 * they count as listing their views, but adding a column to one would put the
 * migration's work somewhere the operator cannot see it.
 *
 * **A kanban is not a candidate at all.** Its columns are derived one per stage
 * from its `kanban` block and are not view documents (rider 6), so `--columns`
 * on one would write a key that board does not render. A workspace whose only
 * boards are kanbans gets a new board instead, which is the honest answer.
 */
function pickBoard(boards: readonly DocumentOnDisk[]): DocumentOnDisk | null {
  const addressable = boards.filter(
    (board) => board.id !== null && !("kanban" in board.frontmatter),
  );
  if (addressable.length === 0) return null;
  return [...addressable].sort(byBoardPreference)[0] ?? null;
}

function byBoardPreference(a: DocumentOnDisk, b: DocumentOnDisk): number {
  const archived = rank(isArchived(a)) - rank(isArchived(b));
  if (archived !== 0) return archived;
  const open =
    rank(b.frontmatter["default-open"] === true) - rank(a.frontmatter["default-open"] === true);
  if (open !== 0) return open;
  return byBoardOrder(a, b);
}

function isArchived(document: DocumentOnDisk): boolean {
  return document.frontmatter.status === "archived";
}

function rank(flag: boolean): number {
  return flag ? 1 : 0;
}

/**
 * `order` ascending with **nulls last**, then title, then id — the documented
 * board tiebreak, and the order the acceptance criteria states the migration's
 * columns in.
 *
 * Compared on lower-cased titles rather than through `localeCompare`, which
 * varies with the machine's ICU locale: this list ends up inside a command the
 * operator pastes, and a command that differs between two machines reading the
 * same files is a command nobody can check.
 */
function byBoardOrder(a: DocumentOnDisk, b: DocumentOnDisk): number {
  const left = orderOf(a);
  const right = orderOf(b);
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  if (left !== null && right !== null && left !== right) return left - right;
  const titles = compare((a.title ?? "").toLowerCase(), (b.title ?? "").toLowerCase());
  return titles === 0 ? compare(a.id ?? "", b.id ?? "") : titles;
}

function orderOf(document: DocumentOnDisk): number | null {
  const value = document.frontmatter.order;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dedupe(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}
