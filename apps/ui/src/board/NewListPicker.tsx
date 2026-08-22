import { useTree } from "@corpus/kit";
import { useEffect, useLayoutEffect, useRef, type ReactElement } from "react";
import {
  folderChoices,
  PRESET_CHOICES,
  searchChoice,
  type MenuPosition,
  type NewListChoice,
} from "./newList";

/**
 * The new-list picker (SPEC.md §10): a positioned menu offering a folder, a
 * preset view, or the current search.
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
  const glyph =
    choice.icon ?? (choice.source === "folder" ? "📁" : choice.source === "search" ? "🔎" : "🧵");
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

/**
 * How far above the bottom of the window the menu's own bottom edge stops, in
 * px — the offset it already keeps from the control that opened it
 * (`.ghost-col`'s placement), read back as a margin so the menu does not sit
 * flush against the edge of the screen.
 */
const MENU_MARGIN = 8;

export function NewListPicker({
  position,
  searchQuery,
  onChoose,
  onClose,
}: NewListPickerProps): ReactElement {
  const tree = useTree();
  const menu = useRef<HTMLDivElement>(null);

  /**
   * **The menu is as tall as the room below it** — SPEC.md §10's rider
   * authorized 2026-08-21 (SHARED-061), *"a bound is derived from the room, not
   * chosen as a number"* (UI-142).
   *
   * `.ac-menu` caps every positioned menu at 200px, which is the right register
   * for a **completion** list — a corpus-driven list nobody scrolls, they type
   * to filter it. This menu is not one. Its items are the workspace's folders,
   * the presets and the current search: a short, bounded list, and
   * the one a person meets first, because the ghost column is what an empty
   * board offers. Measured before this fix, with seven items and nothing
   * unusual:
   *
   *     1280×720    menu 272×200   219px of items in a 198px box   361px of room below
   *     1728×1080   menu 272×200   219px of items in a 198px box   541px of room below
   *
   * The same clipped box at both, with the window half empty, and an item cut in
   * half at the fold — SHARED-061's second question answered yes.
   *
   * The room is the distance from the menu's own top edge to the bottom of the
   * window, which CSS cannot ask because the top is an inline style the board
   * computes from the pointer. So it is measured here and handed back as
   * `--newlist-room-h`. `position: fixed` makes `getBoundingClientRect().top`
   * viewport-relative whatever ancestor it resolves against, so this reading is
   * right even where a transformed ancestor is in the way.
   *
   * It cannot make the menu overflow: the bound **is** the room, so the menu can
   * only grow into space that is already on screen. Where the room is smaller
   * than the list it still scrolls, and that is the honest case.
   */
  useLayoutEffect(() => {
    const node = menu.current;
    if (node === null) return undefined;
    const fit = (): void => {
      const top = node.getBoundingClientRect().top;
      const room = Math.max(0, window.innerHeight - top - MENU_MARGIN);
      node.style.setProperty("--newlist-room-h", `${String(Math.round(room))}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
    };
  }, [position.top, position.left]);

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
      className="ac-menu open new-list"
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
    </div>
  );
}
