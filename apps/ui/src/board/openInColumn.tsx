import type { DocRow } from "@corpus/contract";
import { folderOf } from "@corpus/kit";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import type { BoardColumn } from "./viewDoc";

/**
 * "Open this document, wherever it lives" — the one implementation of scroll,
 * flash and open (SPEC.md §11).
 *
 * Three surfaces need it and none of them is inside the board: the search
 * overlay's `↵` (UI-009), the console's `↗ open` (UI-011), and UI-010's
 * keyboard. They are all siblings of `<Board>` in the shell, so the capability
 * is published through a context and *registered* by the board, which is the
 * only component that knows which columns exist, where they are on screen, and
 * which document each one has open.
 *
 * The alternative — each caller reaching into the board's local state — is how a
 * second scroll-and-flash implementation gets written, and then two surfaces
 * disagree about which column a document belongs to.
 */

/** What resolution needs to know about a document. */
export interface OpenSubject {
  /** Folder relative to `data/docs/`, without a trailing slash; `null` at the root. */
  readonly folder: string | null;
  readonly type: string;
  readonly status: string;
}

export interface OpenTarget {
  readonly docId: string;
  /**
   * The document's own placement, when the caller has it. A search result and a
   * board row both do; a job knows only an `originId`, and omitting this is
   * legal — resolution then falls through to the first column rather than
   * costing a request the caller did not ask for.
   */
  readonly subject?: OpenSubject | null;
  /**
   * The column to open in, when the caller is *looking at* the document rather
   * than resolving where it lives — the keyboard's `↵` on a highlighted row
   * (SPEC.md §11: "open the highlighted document **in its column**").
   *
   * Resolution is skipped when this is given, because a row's column is not a
   * guess: it is the column that fetched it, and a row visible in a narrower
   * column than the one `resolveColumn` would pick must not jump elsewhere under
   * the cursor. Everything else about the act — the scroll, the flash, the push
   * onto that column's navigation stack — is the same code path.
   */
  readonly columnId?: string | null;
  /** Focus *and* select the title on arrival — the omnibox's "ready to type". */
  readonly selectTitle?: boolean;
}

export interface BoardNavigation {
  /** Resolves a home column, scrolls it in, flashes it, opens the document. */
  readonly open: (target: OpenTarget) => void;
  /** Scrolls a column into view and flashes it — save-as-view's new column. */
  readonly revealColumn: (columnId: string) => void;
}

const NO_BOARD: BoardNavigation = {
  open: () => undefined,
  revealColumn: () => undefined,
};

interface NavigationContext {
  readonly navigation: BoardNavigation;
  readonly register: (handlers: BoardNavigation | null) => void;
}

const BoardNavigationContext = createContext<NavigationContext>({
  navigation: NO_BOARD,
  register: () => undefined,
});

/**
 * Mounted above the shell's three regions, so the top bar's overlay and the
 * console can both reach the board without importing it.
 */
export function BoardNavigationProvider({
  children,
}: {
  readonly children?: ReactNode;
}): ReactElement {
  const handlers = useRef<BoardNavigation | null>(null);

  const register = useCallback((next: BoardNavigation | null) => {
    handlers.current = next;
  }, []);

  // Stable identity: a caller holding `open` across renders keeps working, and
  // an unmounted board degrades to a no-op rather than to a thrown error.
  const navigation = useMemo<BoardNavigation>(
    () => ({
      open: (target) => handlers.current?.open(target),
      revealColumn: (columnId) => handlers.current?.revealColumn(columnId),
    }),
    [],
  );

  const value = useMemo(() => ({ navigation, register }), [navigation, register]);

  return (
    <BoardNavigationContext.Provider value={value}>{children}</BoardNavigationContext.Provider>
  );
}

/**
 * The consumer seam. `useOpenInColumn().open({docId, subject})` is how every
 * surface outside the board opens a document.
 */
export function useOpenInColumn(): BoardNavigation {
  return useContext(BoardNavigationContext).navigation;
}

/** The board's side of the seam: publishes its own scroll/flash/open. */
export function useRegisterBoardNavigation(handlers: BoardNavigation): void {
  const { register } = useContext(BoardNavigationContext);
  useEffect(() => {
    register(handlers);
    return () => {
      register(null);
    };
  }, [handlers, register]);
}

/** A search result or a board row, as resolution sees it. */
export function docSubject(row: Pick<DocRow, "path" | "type" | "status">): OpenSubject {
  const folder = folderOf(row.path).replace(/\/+$/, "");
  return { folder: folder === "" ? null : folder, type: row.type, status: row.status };
}

/** `finance/housing` is inside `finance`, but `financial` is not. */
function isInside(folder: string, scope: string): boolean {
  return folder === scope || folder.startsWith(`${scope}/`);
}

function columnFolder(column: BoardColumn): string | null {
  return column.folder === null ? null : column.folder.replace(/\/+$/, "");
}

function listValues(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === "") return [];
  return raw.split(",").map((value) => value.trim());
}

/**
 * Which column a document belongs to, in a stated precedence.
 *
 * A column is a **candidate** only if the document could actually appear in it:
 * its `folder:` scope contains the document, and its `type:`/`status:` filters
 * do not exclude it. Among the candidates:
 *
 * 1. **Folder** — the most specific folder column wins. Placement is the primary
 *    organization (SPEC.md §11), so a document in `finance/housing` belongs to
 *    the Housing column over the Finance one, and to either over a type filter
 *    that also happens to match.
 * 2. **Type / status** — a column filtering on both outranks one filtering on
 *    either, which outranks an unfiltered column.
 * 3. **The first column** — when no column would have it at all. A document
 *    whose home column was archived still opens somewhere, because "nothing
 *    happened" is the worst possible answer to `↵`.
 *
 * `null` only when the board has no columns at all, which is the genuinely
 * empty case the ghost column already speaks for.
 */
export function resolveColumn(
  columns: readonly BoardColumn[],
  subject: OpenSubject | null,
): string | null {
  if (columns.length === 0) return null;
  if (subject === null) return columns[0]?.id ?? null;

  let best: BoardColumn | null = null;
  let bestScore = -1;

  for (const column of columns) {
    const scope = columnFolder(column);
    const types = listValues(column.filter["type"]);
    const statuses = listValues(column.filter["status"]);

    // A filter the document contradicts disqualifies the column outright: a
    // `type: thread` column must never be where a note opens, and a column
    // scoped to another folder must never claim a document that is not in it.
    if (scope !== null && (subject.folder === null || !isInside(subject.folder, scope))) continue;
    if (types.length > 0 && !types.includes(subject.type)) continue;
    if (statuses.length > 0 && !statuses.includes(subject.status)) continue;

    // Placement outranks any type or status filter, and a deeper folder outranks
    // a shallower one — `finance/housing` beats `finance` beats "notes".
    const score =
      (scope === null ? 0 : 1000 + scope.length * 10) +
      (types.length > 0 ? 2 : 0) +
      (statuses.length > 0 ? 1 : 0);
    if (score > bestScore) {
      best = column;
      bestScore = score;
    }
  }

  // No column would have it. Somewhere still beats nowhere: an `↵` that does
  // nothing is the worst answer, and the flash says where it landed.
  return best?.id ?? columns[0]?.id ?? null;
}

/** How long a column's accent border stays lit after being scrolled to. */
export const COLUMN_FLASH_MS = 1500;
