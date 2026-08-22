import { AutocompleteMenu, handleAutocompleteKeyDown, useRefCompletions } from "@corpus/kit";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { RefSuggestionState } from "./refSuggestion.js";

/**
 * The `[[` menu, in the document body — and, since UI-053, **the kit's** menu.
 *
 * What is left here is only what `@tiptap/suggestion` makes irreducibly
 * different from a composer's `[[`:
 *
 *  - the **trigger** is a range in a ProseMirror document, not an offset into a
 *    string, so `useAutocomplete`'s `detectTrigger` cannot see it;
 *  - the **insertion** replaces that range with a ref *node*, not with text, so
 *    `applyCompletion`'s `{ text, caret }` cannot express it;
 *  - the plugin owns **open-ness** — its state is derived from where the caret
 *    is, which is why closing needs `refSuggestion.ts`'s `dismissedAt` dance and
 *    why this menu, unlike a composer's, exists while it has no items to show.
 *
 * Everything a user can perceive comes from the kit: `useRefCompletions` is the
 * same list in the same order with the same rows, `AutocompleteMenu` is the same
 * DOM, and `handleAutocompleteKeyDown` is SPEC.md §10's one keyboard contract.
 * Before this the two `[[` menus were separate implementations that happened to
 * agree, and had already drifted — different limits, different `.d` column,
 * different highlight class, and neither of them accepting on `⇥`.
 *
 * Portalled to `document.body` and positioned `fixed` because the trigger sits
 * inside a column's scroller: anchored in place it would be clipped by the
 * scroll container the moment it opened near the bottom of a reader.
 */

/** Distance from the caret to the menu's top edge. */
const OFFSET_PX = 6;

export interface RefAutocompleteProps {
  readonly state: RefSuggestionState;
  /** Filled with the key handler while the menu is open; read by the plugin. */
  readonly keyHandler: { current: ((event: KeyboardEvent) => boolean) | null };
}

export function RefAutocomplete({ state, keyHandler }: RefAutocompleteProps): ReactElement | null {
  const { items, isPending } = useRefCompletions(state.query);

  const [highlighted, setHighlighted] = useState(0);
  // The list changes under the highlight on every keystroke; starting over is
  // the only behaviour that cannot leave it pointing past the end.
  useEffect(() => {
    setHighlighted(0);
  }, [state.query]);

  // The plugin reads one handler for the life of the trigger, so what the
  // handler reads has to be a box rather than a closure over this render.
  const live = useRef({ items, highlighted, select: state.select, close: state.close });
  live.current = { items, highlighted, select: state.select, close: state.close };

  useEffect(() => {
    keyHandler.current = (event) => {
      const current = live.current;
      // Returning true is how ProseMirror is told the key was consumed; the
      // contract also calls `preventDefault`, which is what actually keeps `⇥`
      // from moving focus out of the editor.
      return handleAutocompleteKeyDown(event, {
        isOpen: true,
        count: current.items.length,
        activeIndex: current.highlighted,
        setActiveIndex: setHighlighted,
        accept: () => {
          const chosen = current.items[current.highlighted];
          if (chosen !== undefined) current.select(chosen.token);
        },
        // The literal `[[` characters stay in the text — the user typed them,
        // and nothing has replaced them yet.
        dismiss: () => {
          current.close();
        },
      });
    };
    return () => {
      keyHandler.current = null;
    };
  }, [keyHandler]);

  const rect = state.clientRect;
  if (rect === null) return null;

  return createPortal(
    <AutocompleteMenu
      open
      items={items}
      activeIndex={highlighted}
      onHover={setHighlighted}
      onChoose={(index) => {
        const item = items[index];
        if (item !== undefined) state.select(item.token);
      }}
      style={{
        top: `${String(Math.round(rect.bottom + OFFSET_PX))}px`,
        left: `${String(Math.round(rect.left))}px`,
      }}
      label="Link a document"
      emptyLabel={isPending ? "searching…" : "no documents match"}
    />,
    document.body,
  );
}
