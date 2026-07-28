import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { BoardNavigationProvider } from "../board/openInColumn";
import { Console } from "../console/Console";
import { SearchOverlay } from "../search/SearchOverlay";
import { Board } from "./Board";
import { ToastProvider } from "./Toasts";
import { Topbar } from "./Topbar";
import "./Shell.css";

/**
 * Top bar · board · console, in that document order (SPEC.md §11). No sidebar.
 *
 * The toast surface wraps rather than joins them: it is `position: fixed`
 * chrome, and putting it inside `.app` would make it a fourth region of a
 * layout the spec says has three. The board-navigation provider wraps for a
 * different reason — the search overlay lives above all three regions and has
 * to be able to open a document *in the board*, which is a sibling.
 *
 * **Whether the overlay is open is the shell's state**, because ⌘K is the one
 * key that must work from anywhere, including from inside a reader. It is the
 * only global key binding this issue adds; everything else the overlay does is
 * bound to its own panel, so an open overlay owns the keyboard by construction
 * rather than by a precedence check (UI-010 formalises the rest of the chain).
 */
export function Shell(): ReactElement {
  const [searchOpen, setSearchOpen] = useState(false);
  /** Focus goes back where it came from — the search bar, or the reader. */
  const opener = useRef<HTMLElement | null>(null);

  const openSearch = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    opener.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      // ⌘K while it is already open re-focuses rather than toggling: the browser
      // and every editor treat it as "go to search", never as "go away".
      if (!searchOpen) openSearch();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openSearch, searchOpen]);

  return (
    <ToastProvider>
      <BoardNavigationProvider>
        <div className="app">
          <Topbar onOpenSearch={openSearch} />
          <Board />
          <Console />
        </div>
        {searchOpen ? <SearchOverlay onClose={closeSearch} /> : null}
      </BoardNavigationProvider>
    </ToastProvider>
  );
}

/**
 * Whether an overlay currently owns the keyboard.
 *
 * UI-010's composer and cheat sheet need to know, and the honest answer is "is
 * one mounted" rather than a flag someone has to remember to clear.
 */
export function isOverlayOpen(): boolean {
  return document.querySelector(".overlay.open") !== null;
}
