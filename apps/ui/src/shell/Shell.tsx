import { useWeightLevels } from "@corpus/kit";
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { BoardsProvider, useBoardSurface } from "../board/BoardsProvider";
import { BoardNavigationProvider } from "../board/openInColumn";
import { ComposeOverlay } from "../compose/ComposeOverlay";
import { Explorer } from "../explorer/Explorer";
import { ExplorerProvider, useExplorer } from "../explorer/ExplorerProvider";
import { Console } from "../console/Console";
import { useEditSessionFlusher } from "../editor/editSessionFlush";
import { BoardCommandsProvider, useBoardCommands } from "../keyboard/boardCommands";
import { CheatSheet } from "../keyboard/CheatSheet";
import { ImageViewerHost } from "../image/ImageViewerHost";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import type { ShortcutContext } from "../keyboard/shortcuts";
import { useShortcuts } from "../keyboard/useShortcuts";
import { SearchOverlay } from "../search/SearchOverlay";
import { Board } from "./Board";
import { BoardBar } from "./BoardBar";
import { ToastProvider, useToast } from "./Toasts";
import { Topbar } from "./Topbar";
import "./Shell.css";

export { isOverlayOpen } from "./overlays";

/**
 * Top bar · board bar · board · console, in that document order (SPEC.md §10).
 *
 * The toast surface wraps rather than joins them: it is `position: fixed`
 * chrome, and putting it inside `.app` would make it a fourth region of a
 * layout the spec says has three. The board-navigation and board-command
 * providers wrap for a different reason — the overlays and the keyboard live
 * above all three regions and have to be able to act *on the board*, which is a
 * sibling. The context-menu host wraps for the third: there is at most one open
 * menu in the app, and the shortcut registry opens one on the keyboard
 * highlight from up here, three components above the row it acts on.
 *
 * **Which overlay is open is the shell's state**, because there is at most one:
 * search, the composer and the cheat sheet are the same layer, and opening one
 * from another replaces it rather than stacking (UI-009's rule). Every binding
 * that opens one comes from the shortcut registry — this component owns no
 * keydown listener of its own any more.
 */

type Layer = "search" | "compose" | "cheatSheet";

export function Shell(): ReactElement {
  return (
    <ToastProvider>
      {/* Above the board and the overlays alike: which board is showing decides
          what the board renders, and the search overlay's "save as view" adds a
          column to it (SPEC.md §10, rider 2). It sits inside the toasts because
          every board-document write reports itself through one. */}
      <BoardsProvider>
        <BoardNavigationProvider>
          <BoardCommandsProvider>
            <ContextMenuProvider>
              {/* One explorer layout, read by the panel, the bar's toggle and
                  `⌘B` alike — see `ExplorerProvider`. */}
              <ExplorerProvider>
                {/* Outermost of the surface hosts: an image can be clicked in the
                  board, in a thread and in focus mode, and the viewer opens over
                  all of them. */}
                <ImageViewerHost>
                  <ShellSurfaces />
                </ImageViewerHost>
              </ExplorerProvider>
            </ContextMenuProvider>
          </BoardCommandsProvider>
        </BoardNavigationProvider>
      </BoardsProvider>
    </ToastProvider>
  );
}

/**
 * Split from {@link Shell} only so it sits *inside* the providers: the shortcut
 * context needs the board's commands and the toast surface, and a component
 * cannot consume a context it renders.
 */
function ShellSurfaces(): ReactElement {
  const [layer, setLayer] = useState<Layer | null>(null);
  /** Focus goes back where it came from — the search bar, the board, or a reader. */
  const opener = useRef<HTMLElement | null>(null);
  const board = useBoardCommands();
  const boards = useBoardSurface();
  const explorer = useExplorer();
  const toast = useToast();

  const open = useCallback((next: Layer) => {
    setLayer((current) => {
      if (current === null) {
        opener.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setLayer(null);
    opener.current?.focus();
  }, []);

  const openSearch = useCallback(() => {
    open("search");
  }, [open]);

  const openCompose = useCallback(() => {
    open("compose");
  }, [open]);

  /**
   * `?` toggles the legend, and is **ignored** while a different overlay is up:
   * one overlay at a time, and a cheat sheet that replaced the composer would
   * throw away what the user was typing to show them how to type it.
   */
  const toggleCheatSheet = useCallback(() => {
    setLayer((current) => {
      if (current === "cheatSheet") return null;
      if (current !== null) return current;
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return "cheatSheet";
    });
  }, []);

  /** `⌘1`…`⌘9` — the nth tab of the bar, and nothing when there is no nth tab. */
  const showNthBoard = useCallback(
    (index: number) => {
      const target = boards.boards[index];
      if (target !== undefined) boards.showBoard(target.id);
    },
    [boards],
  );

  const toggleExplorer = explorer.toggle;

  const context = useMemo<ShortcutContext>(
    () => ({ openCompose, openSearch, toggleCheatSheet, showNthBoard, toggleExplorer, board }),
    [board, openCompose, openSearch, showNthBoard, toggleCheatSheet, toggleExplorer],
  );

  useShortcuts(context);
  /*
   * The weight levels this workspace declares (SPEC.md §10's rider), warmed once
   * here so every composer reads them from cache.
   *
   * The shell rather than a composer, and deliberately: `CommentPopover` opens
   * on a selection and must draw its control in its **first** paint — a control
   * that appeared a round trip after the popover opened would move things under
   * the pointer, which is what UI-073 and UI-074 are the standing warning about.
   * The queries are the ordinary document ones, so this costs one list and one
   * read for the whole session and refreshes itself when the skill is edited.
   */
  useWeightLevels();
  /*
   * SPEC.md §4's close path lives here rather than in a reader because it fires
   * *after* the reader is gone — a surface released, a save that settled behind
   * the unmount, the tab closing. Something that outlives every reader has to
   * hold the client it is issued through.
   */
  useEditSessionFlusher();

  return (
    <>
      <div className="app">
        <Topbar onOpenSearch={openSearch} onOpenCompose={openCompose} />
        <BoardBar />
        {/*
         * Column zero and the board, side by side (SPEC.md §10, rider 1). The
         * explorer is a **sibling** of the board rather than an overlay: it
         * takes width from it the way the console below takes height, so
         * nothing it shows ever covers the left-most column.
         */}
        <div className="main">
          <Explorer />
          <Board />
        </div>
        <Console />
      </div>
      {layer === "search" ? <SearchOverlay onClose={close} /> : null}
      {layer === "compose" ? <ComposeOverlay onClose={close} onNotify={toast} /> : null}
      {layer === "cheatSheet" ? <CheatSheet onClose={close} /> : null}
    </>
  );
}
