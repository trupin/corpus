import type { Editor } from "@tiptap/react";
import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

/**
 * The floating `.sel-toolbar` — **B**, *I*, a divider, and 💬 Comment.
 *
 * Element for element from `design/index.html`, including the order: the two
 * format buttons, the hairline, then the comment button in `--accent-ink` at
 * weight 600, because commenting is the act the surface is really for.
 *
 * **It opens only over an editable surface.** `editor.isEditable` is the gate
 * and it is the whole of it — a toolbar offering to bold text that cannot be
 * bolded is a control that lies. Since SPEC.md §11's *the board is never
 * read-only*, that gate is never closed by a document's state; it still answers
 * for an editor that has been torn down or put into a non-editing surface.
 *
 * The 💬 button does not touch the document. It hands the selection to its
 * caller and stops there — the thread, the anchor and the highlight are
 * UI-007's, and a body mutated here would put markup in a file SPEC.md §6
 * promises stays clean.
 */

/** Gap between the selection's top edge and the toolbar. The prototype's 44px block. */
const OFFSET_PX = 44;

/** Keeps the pill inside the viewport. */
const MARGIN_PX = 8;

/** Below this a "selection" is a stray drag, not an intent. */
const MIN_SELECTION = 2;

export interface SelectionToolbarProps {
  readonly editor: Editor | null;
  readonly onComment: () => void;
}

interface Placement {
  readonly top: number;
  readonly left: number;
}

export function selectionPlacement(
  rect: { readonly top: number; readonly left: number; readonly width: number },
  toolbarWidth: number,
  viewportWidth: number,
): Placement {
  const centered = rect.left + rect.width / 2 - toolbarWidth / 2;
  return {
    top: Math.max(MARGIN_PX, rect.top - OFFSET_PX),
    left: Math.max(MARGIN_PX, Math.min(viewportWidth - toolbarWidth - MARGIN_PX, centered)),
  };
}

export function SelectionToolbar({
  editor,
  onComment,
}: SelectionToolbarProps): ReactElement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [quoted, setQuoted] = useState(false);
  // Re-read on every transaction: which marks are active changes as the caret
  // moves inside the selection, and the buttons report state (TEST-30).
  const [, bump] = useState(0);

  useEffect(() => {
    if (editor === null) return undefined;

    const update = (): void => {
      if (!editor.isEditable) {
        setPlacement(null);
        return;
      }
      const { from, to, empty } = editor.state.selection;
      if (empty || to - from < MIN_SELECTION) {
        setPlacement(null);
        return;
      }
      // A selection of nothing but whitespace cannot anchor a thread: `exact`
      // is `min(1)` on the wire and a selector of spaces would resolve against
      // every indent in the document (sprint-011 TEST-103).
      setQuoted(editor.state.doc.textBetween(from, to, "\n", "").trim() !== "");
      // `coordsAtPos` reads layout. A position that is momentarily not in the
      // DOM — a node view still mounting, a decoration being replaced —
      // throws, and a toolbar is not worth taking the reader down for.
      let rect: { top: number; left: number; width: number };
      try {
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const left = Math.min(start.left, end.left);
        rect = {
          top: Math.min(start.top, end.top),
          left,
          width: Math.max(0, Math.max(start.right, end.right) - left),
        };
      } catch {
        setPlacement(null);
        return;
      }
      // The pill is content-sized; the prototype's own fallback is 170px and it
      // only decides horizontal centring.
      setPlacement(selectionPlacement(rect, 170, window.innerWidth));
      bump((count) => count + 1);
    };

    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    // A scroll moves the selection out from under a `fixed` pill; the prototype
    // closes it rather than chasing it.
    const close = (): void => {
      setPlacement(null);
    };
    window.addEventListener("scroll", close, true);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      window.removeEventListener("scroll", close, true);
    };
  }, [editor]);

  if (editor === null || placement === null) return null;

  return createPortal(
    <div
      className="sel-toolbar open"
      role="toolbar"
      aria-label="Selection actions"
      data-sel-toolbar
      style={{
        top: `${String(Math.round(placement.top))}px`,
        left: `${String(Math.round(placement.left))}px`,
      }}
      // Taking focus would collapse the selection the toolbar acts on.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <button
        type="button"
        data-fmt="bold"
        title="Bold"
        aria-pressed={editor.isActive("bold")}
        className={editor.isActive("bold") ? "on" : undefined}
        onClick={() => {
          editor.chain().focus().toggleBold().run();
        }}
      >
        <b>B</b>
      </button>
      <button
        type="button"
        data-fmt="italic"
        title="Italic"
        aria-pressed={editor.isActive("italic")}
        className={editor.isActive("italic") ? "on" : undefined}
        onClick={() => {
          editor.chain().focus().toggleItalic().run();
        }}
      >
        <i>I</i>
      </button>
      <span className="divider" />
      <button
        type="button"
        className="comment-btn"
        data-sel-comment
        disabled={!quoted}
        title={quoted ? "Comment on the selection" : "Select some text to comment on"}
        onClick={onComment}
      >
        💬 Comment
      </button>
    </div>,
    document.body,
  );
}
