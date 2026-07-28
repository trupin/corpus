import { useDocs } from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { RefSuggestionState } from "./refSuggestion.js";

/**
 * The `[[` menu — the prototype's `.ac-menu` / `.ac-item`, keyboard first.
 *
 * The list is `useDocs`, filtered by the text typed after the trigger: SPEC.md
 * §11 is explicit that there is no separate registry anywhere in the smart
 * input, so a document becomes suggestable by existing and by nothing else.
 *
 * Portalled to `document.body` and positioned `fixed` because the trigger sits
 * inside a column's scroller: anchored in place it would be clipped by the
 * scroll container the moment it opened near the bottom of a reader.
 */

/** Enough to choose from; the query is a title search, not a browser. */
const LIMIT = 8;

/** Distance from the caret to the menu's top edge. */
const OFFSET_PX = 6;

export interface RefAutocompleteProps {
  readonly state: RefSuggestionState;
  /** Filled with the key handler while the menu is open; read by the plugin. */
  readonly keyHandler: { current: ((event: KeyboardEvent) => boolean) | null };
}

interface Suggestion {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
}

export function RefAutocomplete({ state, keyHandler }: RefAutocompleteProps): ReactElement | null {
  const query = state.query.trim();
  const docs = useDocs({ ...(query === "" ? {} : { q: query }), limit: LIMIT });
  const items: readonly Suggestion[] = (docs.data?.items ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.type,
  }));

  const [highlighted, setHighlighted] = useState(0);
  // The list changes under the highlight on every keystroke; starting over is
  // the only behaviour that cannot leave it pointing past the end.
  useEffect(() => {
    setHighlighted(0);
  }, [state.query]);

  const select = useRef(state.select);
  select.current = state.select;
  const close = useRef(state.close);
  close.current = state.close;
  const current = useRef({ items, highlighted });
  current.current = { items, highlighted };

  useEffect(() => {
    keyHandler.current = (event) => {
      const { items: list, highlighted: index } = current.current;
      if (event.key === "ArrowDown") {
        setHighlighted(list.length === 0 ? 0 : (index + 1) % list.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setHighlighted(list.length === 0 ? 0 : (index - 1 + list.length) % list.length);
        return true;
      }
      if (event.key === "Enter") {
        const chosen = list[index];
        if (chosen === undefined) return false;
        select.current(chosen.id);
        return true;
      }
      if (event.key === "Escape") {
        // Consumed here so it neither reaches the reader's escape layer nor
        // leaves the menu open. The literal `[[` characters stay in the text —
        // the user typed them, and nothing has replaced them yet.
        close.current();
        return true;
      }
      return false;
    };
    return () => {
      keyHandler.current = null;
    };
  }, [keyHandler]);

  const rect = state.clientRect;
  if (rect === null) return null;

  return createPortal(
    <div
      className="ac-menu open"
      role="listbox"
      aria-label="Link a document"
      data-ref-autocomplete
      style={{
        top: `${String(Math.round(rect.bottom + OFFSET_PX))}px`,
        left: `${String(Math.round(rect.left))}px`,
      }}
    >
      {items.length === 0 ? (
        <div className="ac-item ac-empty" role="presentation">
          {docs.isPending ? "searching…" : "no documents match"}
        </div>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === highlighted}
            className={index === highlighted ? "ac-item on" : "ac-item"}
            // `mousedown` would move focus out of the editor and close the
            // suggestion before the click landed.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onMouseEnter={() => {
              setHighlighted(index);
            }}
            onClick={() => {
              state.select(item.id);
            }}
          >
            <span className="k">{item.title}</span>
            <span className="d">{item.kind}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
