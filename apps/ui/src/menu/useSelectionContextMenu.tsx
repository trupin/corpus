import type { RowNotice } from "@corpus/kit";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useCallback, type MouseEvent } from "react";
import { rangeStillReads, STALE_SELECTION_NOTICE } from "../editor/selection";
import { useContextMenu } from "./ContextMenuHost";
import { selectionMenuTarget } from "./nativeMenu";
import { captureCopy } from "./selectionCopy";
import { SelectionMenuItems } from "./SelectionMenuItems";

/**
 * The document body's right-click on a **selection** (SPEC.md §10).
 *
 * Hosted on the document view, so the column reader and focus mode get the same
 * menu from the same code — as they do for everything else the view renders.
 *
 * **It opens on every document-body selection**, and lets the items thin out:
 * §10 says Copy always, Comment where there is something to anchor to, Cut and
 * Paste in editable content. A thread's conversation, a `view`, and a document
 * a `view`'s stored query therefore gets a Copy-only menu rather than falling
 * back to the browser's. Declining there — which is what this hook did until
 * PR #13's review — dropped the event on the reader's handler, and the *item*
 * menu opened on a text selection: neither Copy nor the native menu.
 *
 * Everything is captured **at open time**: the selected text, the comment
 * action's range, and the range Cut and Paste act on. Opening a menu moves
 * focus out of the body, and an action that re-read the selection when it was
 * activated would act on a selection that no longer exists. Captured positions
 * are **verified before they are used** — see {@link captureReplace}.
 */

export interface SelectionContextMenuOptions {
  /** The body's editor, when the body is one; `null` otherwise. */
  readonly editor: Editor | null;
  /**
   * The commenting seam: the live selection as an action, or `null`.
   *
   * Takes the right-clicked node because a rendered body has no single owner to
   * ask. A document's editor holds one selection and ignores the argument; a
   * thread's conversation is many `MarkdownView`s and the target is what says
   * which turn — and which card — the words belong to (UI-051).
   */
  readonly captureComment: (target: EventTarget | null) => (() => void) | null;
  readonly onNotify: (notice: RowNotice) => void;
}

/** The menu's accessible name — every other menu in the app names its subject. */
export const SELECTION_MENU_LABEL = "Actions for the selection";

/**
 * Cut and Paste, as one operation on the range that was selected.
 *
 * **Plain text goes in as plain text.** A text transaction rather than TipTap's
 * `insertContentAt`, which parses its string as HTML: pasting `a <b` into a
 * document must paste those four characters, not open an element.
 *
 * **Rich text goes in through the editor's own paste path** (PR #19 review).
 * `EditorView.pasteHTML` is the function ProseMirror's `paste` handler calls, so
 * the menu's Paste runs `transformPastedHTML` and the schema's parse rules that
 * ⌘V runs — the mirror image of what `selectionCopy.ts` does for Copy, and for
 * the same reason: the two gestures are one act, and a menu Paste that dropped
 * every heading and bullet ⌘V keeps would be the defect UI-042 fixed, pointing
 * the other way.
 *
 * **The captured positions are checked before they are used** (PR #13 review,
 * MINOR). A menu can sit open while the agent's write arrives over SSE and
 * `DocEditor` adopts a new body; the positions then index into a document that
 * no longer has that text at them — or, on a shrunken document, into nothing at
 * all, which is a `RangeError` out of `textBetween`. Re-reading the captured
 * text is the cheap proof that the range still means what it meant, and a
 * refusal the user can act on beats a Cut that deletes the wrong sentence.
 */
export function captureReplace(
  editor: Editor | null,
  onStale: () => void,
): ((text: string, html?: string | null) => void) | null {
  if (editor === null || editor.isDestroyed || !editor.isEditable) return null;
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const captured = editor.state.doc.textBetween(from, to, "\n", "");
  return (text: string, html?: string | null) => {
    if (editor.isDestroyed) return;
    const { state, view } = editor;
    if (!rangeStillReads(state.doc, from, to, captured)) {
      onStale();
      return;
    }
    if (html != null && html !== "") {
      // `pasteHTML` replaces the selection, so the captured range has to *be*
      // the selection first: the menu took focus out of the body, and the
      // editor's own selection is wherever it last was.
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
      view.pasteHTML(html);
    } else {
      view.dispatch(text === "" ? state.tr.delete(from, to) : state.tr.insertText(text, from, to));
    }
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
      const comment = captureComment(event.target);
      const stale = (): void => {
        onNotify({ tone: "error", message: STALE_SELECTION_NOTICE });
      };
      const replace = found.editable ? captureReplace(editor, stale) : null;
      // Both flavors, read now for the same reason the text is: opening the
      // menu moves focus, and the editor's slice and the DOM range both stop
      // describing the words the user pointed at.
      const copy = captureCopy(editor, found.text);

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
            copy={copy}
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
