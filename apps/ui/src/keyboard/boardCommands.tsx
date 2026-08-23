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
 * What the keyboard can ask the board to do (SPEC.md §10).
 *
 * The shortcut dispatcher is mounted by the shell, and the board is the shell's
 * sibling — the same geometry `useOpenInColumn` already solves for "open this
 * document, wherever it lives". So this is the same seam, for the same reason:
 * the board publishes an imperative surface, and the keyboard calls it. The
 * alternative is the dispatcher reaching into board state, and then two things
 * know which column is active.
 *
 * Deliberately *narrow*. Every entry here is one of §10's bindings, phrased as
 * the act rather than as the key, so the registry stays the only place a key
 * appears and this stays the only place the board's behaviour does.
 */
/** The three ways `↵` opens a row (SPEC.md §10, rider 3). */
export type OpenRowMode = "path" | "here" | "fullScreen";

export interface BoardCommands {
  /** `↑`/`↓`, `j`/`k`: moves the row cursor in the active column, clamped at both ends. */
  readonly moveRowCursor: (delta: -1 | 1) => void;
  /**
   * `↵` opens the highlighted row in a **path** off its row; `⌥↵` opens it
   * here, in the column's own reader; `⇧↵` opens it directly in full screen.
   */
  readonly openRowAtCursor: (mode: OpenRowMode) => void;
  /** `⇧esc`, and the bar's "close paths": every path on the showing board. */
  readonly closeAllPaths: () => void;
  /** `←`/`→`, `[`/`]`: switches the active column, clamped at both ends. */
  readonly switchColumn: (delta: -1 | 1) => void;
  /** `⇧←`/`⇧→`: moves the active column by rewriting the board document's `columns`. */
  readonly moveActiveColumn: (delta: -1 | 1) => void;
  /** `f`: toggles focus mode on the open document; a no-op when nothing is open. */
  readonly toggleFocusMode: () => void;
  /** `e`: archives the open document, or the row under the cursor. */
  readonly archiveTarget: () => void;
  /** `r`: focuses the reply composer of the open document's visible thread. */
  readonly focusReply: () => void;
  /** The menu key / `⇧F10`: opens the context menu on the keyboard highlight. */
  readonly openContextMenu: () => void;
}

const NO_BOARD: BoardCommands = {
  moveRowCursor: () => undefined,
  openRowAtCursor: () => undefined,
  closeAllPaths: () => undefined,
  switchColumn: () => undefined,
  moveActiveColumn: () => undefined,
  toggleFocusMode: () => undefined,
  archiveTarget: () => undefined,
  focusReply: () => undefined,
  openContextMenu: () => undefined,
};

interface CommandsContext {
  readonly commands: BoardCommands;
  readonly register: (commands: BoardCommands | null) => void;
}

const BoardCommandsContext = createContext<CommandsContext>({
  commands: NO_BOARD,
  register: () => undefined,
});

export function BoardCommandsProvider({
  children,
}: {
  readonly children?: ReactNode;
}): ReactElement {
  const registered = useRef<BoardCommands | null>(null);

  const register = useCallback((next: BoardCommands | null) => {
    registered.current = next;
  }, []);

  /**
   * A stable façade: the dispatcher binds one keydown listener for the life of
   * the app, and a new object per board render would re-bind it on every
   * keystroke that moved a cursor.
   */
  const commands = useMemo<BoardCommands>(
    () => ({
      moveRowCursor: (delta) => registered.current?.moveRowCursor(delta),
      openRowAtCursor: (mode) => registered.current?.openRowAtCursor(mode),
      closeAllPaths: () => registered.current?.closeAllPaths(),
      switchColumn: (delta) => registered.current?.switchColumn(delta),
      moveActiveColumn: (delta) => registered.current?.moveActiveColumn(delta),
      toggleFocusMode: () => registered.current?.toggleFocusMode(),
      archiveTarget: () => registered.current?.archiveTarget(),
      focusReply: () => registered.current?.focusReply(),
      openContextMenu: () => registered.current?.openContextMenu(),
    }),
    [],
  );

  const value = useMemo(() => ({ commands, register }), [commands, register]);

  return <BoardCommandsContext.Provider value={value}>{children}</BoardCommandsContext.Provider>;
}

/** The consumer seam — the shortcut dispatcher's `context.board`. */
export function useBoardCommands(): BoardCommands {
  return useContext(BoardCommandsContext).commands;
}

/** The board's side: publishes what the keyboard may ask of it. */
export function useRegisterBoardCommands(commands: BoardCommands): void {
  const { register } = useContext(BoardCommandsContext);
  useEffect(() => {
    register(commands);
    return () => {
      register(null);
    };
  }, [commands, register]);
}
