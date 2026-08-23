import type { OpenPayload, OpenRequest, RevealTarget } from "@corpus/kit";
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

/**
 * "Open this document, wherever the caller is" — the one seam every surface
 * outside the board opens documents through (SPEC.md §10, rider 3).
 *
 * Since rider 3, **every open lands in a path**. A caller that names a column
 * is looking at a row, and the path hangs off it; a caller that only knows a
 * document — the search overlay's `↵`, the console's `↗ open`, a lane-scope
 * row, a link inside full screen, "open in" another board — lands as a **loose
 * path at the left edge** of the showing board. There is no home-column
 * resolution any more: the folder/type precedence this module used to carry
 * (`resolveColumn`) died with the rider, because a loose path is a place of its
 * own and no longer a guess about which column a document "belongs" to.
 *
 * The surfaces that need this are all siblings of `<Board>` in the shell, so
 * the capability is published through a context and *registered* by the board,
 * which is the only component that holds the strip.
 */

export interface OpenTarget {
  readonly docId: string;
  /**
   * The column whose row the caller is looking at — the keyboard's `↵`, a row
   * click. The path opens directly to its right, hung off that row (rider 3).
   * Checked against the live column set: an SSE frame may have removed the
   * column between the keystroke and this call, and the open then lands loose.
   */
  readonly columnId?: string | null;
  /**
   * The origin the path should record, when it is not simply "this row"
   * — UI-150's explorer passes `{ view: "explorer", doc }`. A view that is not
   * a live column slot lands the path loose at the left edge, which is where
   * the explorer's preview path lives anyway.
   */
  readonly origin?: { readonly view: string; readonly doc: string } | null;
  /**
   * Forces the landing: `"left"` opens a loose path at the left edge even when
   * a column is named. Omitted, the placement is derived — `"origin"` when a
   * live column is named, `"left"` otherwise.
   */
  readonly placement?: "origin" | "left";
  /** Focus *and* select the title on arrival — the omnibox's "ready to type". */
  readonly selectTitle?: boolean;
  /**
   * Where inside the document to land (UI-037): an item of its text, or one of
   * its threads. Rides the path column's first `NavEntry`, exactly as it rode
   * the column reader's.
   */
  readonly reveal?: RevealTarget | undefined;
}

/**
 * The one place a bare id and a full request are reconciled.
 *
 * Both spellings exist because both are honest: a row click knows a document
 * and nothing else, while a comment, a backlink or a thread-context link knows
 * exactly where inside it to land. Normalising at the seam means every surface
 * below it handles one shape (SPEC.md §10's `onOpen`, sprint-023 OC5).
 */
export function openRequest(payload: OpenPayload): OpenRequest {
  return typeof payload === "string" ? { docId: payload } : payload;
}

export interface BoardNavigation {
  /** Opens the document in a path, scrolls its column in and flashes it. */
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
 * The consumer seam. `useOpenInColumn().open({docId})` is how every surface
 * outside the board opens a document — and since rider 3, where it lands is a
 * path, loose at the left edge unless the caller named the row it came from.
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

/** How long a column's accent border stays lit after being scrolled to. */
export const COLUMN_FLASH_MS = 1500;
