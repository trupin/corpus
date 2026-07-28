import { useTree } from "@corpus/kit";
import { useEffect, useRef, type ReactElement } from "react";
import {
  folderChoices,
  PRESET_CHOICES,
  searchChoice,
  type MenuPosition,
  type NewListChoice,
} from "./newList";

/**
 * The new-list picker (SPEC.md §11): a positioned menu offering a folder, a
 * preset view, a plugin column type, or the current search.
 *
 * Folders and their counts come from `GET /api/tree` — the real hierarchy, not
 * a guess — so what the menu offers is what the workspace actually contains.
 * Every choice creates a pinned view document; the picker itself creates
 * nothing, it just says which.
 */

export interface NewListPickerProps {
  readonly position: MenuPosition;
  /** UI-009's search state. Empty means the "from current search" entry is absent. */
  readonly searchQuery: string;
  readonly onChoose: (choice: NewListChoice) => void;
  readonly onClose: () => void;
}

function ChoiceItem({
  choice,
  onChoose,
}: {
  readonly choice: NewListChoice;
  readonly onChoose: (choice: NewListChoice) => void;
}): ReactElement {
  const glyph = choice.source === "folder" ? "📁" : choice.source === "search" ? "🔎" : "🧵";
  return (
    <button
      type="button"
      className="ac-item"
      role="menuitem"
      data-newlist={choice.key}
      onClick={() => {
        onChoose(choice);
      }}
    >
      <span aria-hidden="true">{glyph}</span> <span className="k">{choice.title}</span>
      <span className="d">{choice.detail}</span>
    </button>
  );
}

export function NewListPicker({
  position,
  searchQuery,
  onChoose,
  onClose,
}: NewListPickerProps): ReactElement {
  const tree = useTree();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (menu.current?.contains(event.target as Node) === true) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const folders = folderChoices(tree.data);
  const search = searchChoice(searchQuery);

  return (
    <div
      ref={menu}
      className="ac-menu open"
      role="menu"
      aria-label="New list"
      style={{ left: `${String(position.left)}px`, top: `${String(position.top)}px` }}
    >
      {folders.map((choice) => (
        <ChoiceItem key={choice.key} choice={choice} onChoose={onChoose} />
      ))}
      {PRESET_CHOICES.map((choice) => (
        <ChoiceItem key={choice.key} choice={choice} onChoose={onChoose} />
      ))}
      {search === null ? null : <ChoiceItem choice={search} onChoose={onChoose} />}
      {/* The registry is PLUGINS-001's; the affordance is the prototype's, and
          it stays inert until there is something real to list. */}
      <div className="ac-item ac-item-note">
        <span className="d">plugin column types appear here too (e.g. a todos board)</span>
      </div>
    </div>
  );
}
