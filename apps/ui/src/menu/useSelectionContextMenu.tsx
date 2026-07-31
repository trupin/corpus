import type { RowNotice } from "@corpus/kit";
import type { Editor } from "@tiptap/react";
import { useCallback, type MouseEvent } from "react";
import { useContextMenu } from "./ContextMenuHost";
import { selectionMenuTarget } from "./nativeMenu";
import { SelectionMenuItems } from "./SelectionMenuItems";

/**
 * The document body's right-click on a **selection** (SPEC.md §11).
 *
 * Hosted on the document view, so the column reader and focus mode get the same
 * menu from the same code — as they do for everything else the view renders.
 *
 * **It declines rather than opens a poorer menu.** With no comment action and
 * no editing (a thread's conversation, a `view`'s query, a document held under
 * someone else's lock), all this could offer is Copy — strictly less than the
 * browser's own menu, which also has Look Up and Translate. So it lets the
 * event through, and the native menu appears. The trade §11 accepts is losing
 * those *in exchange for* Comment on selection; paying it for nothing would be
 * a straight downgrade.
 *
 * Everything is captured **at open time**: the selected text, the comment
 * action's range, and the range Cut and Paste act on. Opening a menu moves
 * focus out of the body, and an action that re-read the selection when it was
 * activated would act on a selection that no longer exists.
 */

export interface SelectionContextMenuOptions {
  /** The body's editor, when the body is one; `null` otherwise. */
  readonly editor: Editor | null;
  /** The commenting seam: the live selection as an action, or `null`. */
  readonly captureComment: () => (() => void) | null;
  readonly onNotify: (notice: RowNotice) => void;
}

/** The menu's accessible name — every other menu in the app names its subject. */
export const SELECTION_MENU_LABEL = "Actions for the selection";

/**
 * Cut and Paste, as one operation on the range that was selected.
 *
 * A plain-text transaction rather than TipTap's `insertContentAt`, which parses
 * its string as HTML: pasting `a <b` into a document must paste those four
 * characters, not open an element.
 */
export function captureReplace(editor: Editor | null): ((text: string) => void) | null {
  if (editor === null || editor.isDestroyed || !editor.isEditable) return null;
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  return (text: string) => {
    if (editor.isDestroyed) return;
    const { state, view } = editor;
    view.dispatch(text === "" ? state.tr.delete(from, to) : state.tr.insertText(text, from, to));
    view.focus();
  };
}

export function useSelectionContextMenu({
  editor,
  captureComment,
  onNotify,
}: SelectionContextMenuOptions): (event: MouseEvent<HTMLElement>) => void {
  const menu = useContextMenu();

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const found = selectionMenuTarget(event.target);
      if (found === null) return;
      const comment = captureComment();
      const replace = found.editable ? captureReplace(editor) : null;
      if (comment === null && replace === null) return;

      event.preventDefault();
      // The reader's own handler sits on an ancestor and would open the
      // document's menu over this one.
      event.stopPropagation();
      menu.open({
        label: SELECTION_MENU_LABEL,
        clientX: event.clientX,
        clientY: event.clientY,
        items: (close) => (
          <SelectionMenuItems
            text={found.text}
            onComment={comment}
            onReplace={replace}
            close={close}
            onNotify={onNotify}
          />
        ),
      });
    },
    [captureComment, editor, menu, onNotify],
  );
}
