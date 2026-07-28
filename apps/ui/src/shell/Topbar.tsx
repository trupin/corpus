import type { ReactElement } from "react";
import { ThemeToggle } from "./ThemeToggle";
import "./Topbar.css";

const SEARCH_PLACEHOLDER = "Search corpus — documents, threads, skills…";

function SearchIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export interface TopbarProps {
  /** Opens the search overlay. ⌘K does the same thing, through the shortcut registry. */
  readonly onOpenSearch?: () => void;
  /** Opens the Ask/Capture composer — the same act as `c` (SPEC.md §11). */
  readonly onOpenCompose?: () => void;
}

/**
 * Wordmark · centred search affordance · Ask/Capture (SPEC.md §11). Agent and
 * queue status belong to the console strip and are deliberately absent here.
 *
 * The search affordance is a **button**, not an input: the query input lives in
 * the overlay panel (`design/index.html`), and a second one here would be two
 * places to type the same search. The compose button is the same shape for the
 * same reason, and it carries its `c` hint because a shortcut nobody can see is
 * a shortcut nobody uses.
 */
export function Topbar({ onOpenSearch, onOpenCompose }: TopbarProps = {}): ReactElement {
  return (
    <header className="topbar">
      <div className="wordmark">
        Corpus <small>workbench</small>
      </div>
      <button
        type="button"
        className="searchbar"
        aria-label="Search corpus"
        onClick={() => {
          onOpenSearch?.();
        }}
      >
        <SearchIcon />
        <span>{SEARCH_PLACEHOLDER}</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="topbar-actions">
        <ThemeToggle />
        <button
          type="button"
          className="btn-compose"
          onClick={() => {
            onOpenCompose?.();
          }}
        >
          ＋ Ask / Capture <kbd>c</kbd>
        </button>
      </div>
    </header>
  );
}
