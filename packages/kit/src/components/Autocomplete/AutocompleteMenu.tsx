import type { CSSProperties, ReactElement } from "react";
import type { AutocompleteItem } from "./useAutocomplete.js";

/**
 * `design/index.html`'s `.ac-menu` / `.ac-item`, and nothing else: the menu is
 * presentational, the state lives in {@link useAutocomplete}, and the two are
 * separate because the document editor mounts it against a ProseMirror
 * selection while the composers mount it against an `<input>`.
 *
 * Rendered inline (not portalled) with `position: fixed` supplied by the
 * stylesheet; the host positions it by passing `style`.
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
}

export function AutocompleteMenu({
  open,
  items,
  activeIndex,
  onHover,
  onChoose,
  style,
  label,
}: AutocompleteMenuProps): ReactElement | null {
  if (!open || items.length === 0) return null;
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
      {items.map((item, index) => (
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
      ))}
    </div>
  );
}
