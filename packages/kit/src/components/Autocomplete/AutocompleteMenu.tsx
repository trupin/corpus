import type { CSSProperties, ReactElement } from "react";
import type { AutocompleteItem } from "./useAutocomplete.js";

/**
 * `design/index.html`'s `.ac-menu` / `.ac-item`, and nothing else: the menu is
 * presentational, the state lives in {@link useAutocomplete}, and the two are
 * separate because the document editor mounts it against a ProseMirror
 * selection while the composers mount it against an `<input>` — both render
 * *this*, so the two `[[` menus cannot look different from each other (UI-053).
 *
 * Rendered inline (not portalled) with `position: fixed` supplied by the
 * stylesheet; the host positions it by passing `style`, and portals it itself
 * where a transformed ancestor would otherwise clip it.
 */
export interface AutocompleteMenuProps {
  readonly open: boolean;
  readonly items: readonly AutocompleteItem[];
  readonly activeIndex: number;
  readonly onHover: (index: number) => void;
  readonly onChoose: (index: number) => void;
  /** Positioning is the host's: the menu knows nothing about where it sits. */
  readonly style?: CSSProperties | undefined;
  readonly label?: string | undefined;
  /**
   * The unchoosable row shown *instead of* the items when there are none.
   *
   * Supplied only by a menu whose open-ness is not derived from having items —
   * the document editor's `[[`, which is a live ProseMirror range that
   * `@tiptap/suggestion` keeps active while the caret sits inside it, and so has
   * an empty state to report. A composer's menu has no existence apart from its
   * items (`useAutocomplete`'s `isOpen` says so), so it leaves this unset and
   * renders nothing.
   */
  readonly emptyLabel?: string | undefined;
}

export function AutocompleteMenu({
  open,
  items,
  activeIndex,
  onHover,
  onChoose,
  style,
  label,
  emptyLabel,
}: AutocompleteMenuProps): ReactElement | null {
  if (!open) return null;
  if (items.length === 0 && emptyLabel === undefined) return null;
  return (
    <div
      className="ac-menu open"
      role="listbox"
      aria-label={label ?? "Completions"}
      style={style}
      // The composer keeps focus and the keyboard; a mousedown that stole it
      // would blur the input and close the menu before the click landed.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      {items.length === 0 ? (
        <div className="ac-item ac-empty" role="presentation">
          {emptyLabel}
        </div>
      ) : (
        items.map((item, index) => (
          <button
            type="button"
            key={item.key}
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "ac-item active" : "ac-item"}
            onMouseEnter={() => {
              onHover(index);
            }}
            onClick={() => {
              onChoose(index);
            }}
          >
            <span className="k">{item.label}</span>
            <span className="d">{item.description}</span>
          </button>
        ))
      )}
    </div>
  );
}
