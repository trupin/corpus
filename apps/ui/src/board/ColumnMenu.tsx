import { useEffect, useRef, type ReactElement } from "react";

/**
 * The column `⋯` menu (SPEC.md §11). The prototype leaves it a stub; these are
 * the three acts that change a column, and each one edits the column's own view
 * document.
 *
 * **Unpin archives.** It is not a delete: SPEC.md §9.2 makes deletion
 * user-only and explicit, and archiving is "a reversible flip, never a
 * deletion" — the view document stays on disk, out of the default lists, and
 * can be brought back. A board that destroyed a document when a user tidied a
 * column would be losing work silently.
 */

export interface ColumnMenuProps {
  readonly title: string;
  readonly position: { readonly left: number; readonly top: number };
  readonly onRename: () => void;
  readonly onEditQuery: () => void;
  readonly onUnpin: () => void;
  readonly onClose: () => void;
}

export function ColumnMenu({
  title,
  position,
  onRename,
  onEditQuery,
  onUnpin,
  onClose,
}: ColumnMenuProps): ReactElement {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (menu.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    // Capture, so a click that also opens something else still closes this.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menu}
      className="ac-menu open"
      role="menu"
      aria-label={`List options for ${title}`}
      style={{ left: `${String(position.left)}px`, top: `${String(position.top)}px` }}
    >
      <button type="button" className="ac-item" role="menuitem" onClick={onRename}>
        Rename<span className="d">edits the view document&rsquo;s title</span>
      </button>
      <button type="button" className="ac-item" role="menuitem" onClick={onEditQuery}>
        Edit query<span className="d">edits its stored filters</span>
      </button>
      <button type="button" className="ac-item" role="menuitem" onClick={onUnpin}>
        Unpin<span className="d">archives it — never deletes</span>
      </button>
    </div>
  );
}
