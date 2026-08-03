import type { Editor } from "@tiptap/react";

/**
 * What the selection menu's Copy puts on the clipboard (SPEC.md §11 clipboard
 * rider, signed 2026-08-02).
 *
 * **Why this exists at all.** UI-042's reproduction found the rider satisfied
 * for ⌘C and completely unmet for the menu: `SelectionMenuItems` copied with
 * `navigator.clipboard.writeText(selection.toString())`, so the right-click
 * Copy put a single `text/plain` flavor on the clipboard and nothing else.
 * Pasted into a word processor that is the user's report verbatim — *all*
 * formatting lost — and it is the same gesture §11 puts Copy on. One menu item
 * away from the editor's own copy, with none of the editor's fidelity.
 *
 * **Two paths, because the body has two renders.** Inside the editor, the copy
 * is the editor's own: `EditorView.serializeForClipboard` is the very function
 * ProseMirror's `copy` handler calls, so the menu and ⌘C put byte-identical
 * flavors on the clipboard by construction — including the `docRef` rule and
 * the markdown text flavor `DocEditor` configures. Nothing is re-derived here,
 * so the two can never drift.
 *
 * Outside it — a thread's conversation, a `MarkdownView` render, a document
 * under someone else's lock — there is no ProseMirror document to serialize.
 * The rendered DOM is the document there, so the range's own
 * `cloneContents()` is the rich flavor and `selection.toString()` stays the
 * plain one, exactly as before. It is a lesser answer than markdown, and it is
 * the honest one: those surfaces render markdown to HTML and the HTML is all
 * that exists at the point of the copy.
 */

export interface SelectionCopy {
  /** The plain flavor: the document's markdown in the editor, the text elsewhere. */
  readonly text: string;
  /** The rich flavor, or `null` when the selection has none to offer. */
  readonly html: string | null;
}

/** The one range question the copy path asks, plus the contents it takes. */
export interface CopyRange {
  readonly commonAncestorContainer: Node;
  cloneContents(): DocumentFragment;
}

/**
 * The parts of `Selection` this reads. Structural rather than the DOM type for
 * the reason `nativeMenu.ts` gives: jsdom carries `Range` faithfully and
 * `Selection` only partly, and the rule is about the range.
 */
export interface CopySelectionSource {
  readonly rangeCount: number;
  getRangeAt(index: number): CopyRange;
}

/**
 * Chrome the reader can see but a copy must not carry: the fence's copy button
 * (`@corpus/kit`'s `CodeFence`) is a control, not prose, and pasting a document
 * that has grown the word "Copy" in the middle of a code block is a defect the
 * user would report as one.
 */
const NOT_PROSE = "button";

/**
 * The flavors for the selection that is open right now.
 *
 * `text` is the already-captured `selection.toString()` — the menu reads it
 * before opening, because opening moves focus — and stays the answer wherever
 * the editor is not the one holding the selection.
 */
export function captureCopy(
  editor: Editor | null,
  text: string,
  selection: CopySelectionSource | null = globalThis.getSelection?.() ?? null,
): SelectionCopy {
  const ranges =
    selection === null
      ? []
      : Array.from({ length: selection.rangeCount }, (_unused, index) =>
          selection.getRangeAt(index),
        );

  const fromEditor = editorCopy(editor, ranges[0]);
  return fromEditor ?? { text, html: renderedHtml(ranges) };
}

/**
 * The editor's own clipboard flavors, or `null` when the selection is not the
 * editor's.
 *
 * **The containment test is not belt-and-braces.** A reader can hold an open
 * editor while the selection sits in a thread card beside it, and
 * `editor.state.selection` keeps whatever range it last held — so asking the
 * editor without asking where the selection *is* copies a stale span of the
 * document instead of the words under the pointer.
 */
function editorCopy(editor: Editor | null, range: CopyRange | undefined): SelectionCopy | null {
  if (editor === null || editor.isDestroyed || range === undefined) return null;
  if (!editor.view.dom.contains(range.commonAncestorContainer)) return null;
  const selection = editor.state.selection;
  if (selection.empty) return null;
  const serialized = editor.view.serializeForClipboard(selection.content());
  return { text: serialized.text, html: serialized.dom.innerHTML };
}

/** The selected markup as a rendered surface holds it, or `null` when it is empty. */
function renderedHtml(ranges: readonly CopyRange[]): string | null {
  if (ranges.length === 0 || typeof document === "undefined") return null;
  const host = document.createElement("div");
  for (const range of ranges) host.append(range.cloneContents());
  for (const control of [...host.querySelectorAll(NOT_PROSE)]) control.remove();
  const html = host.innerHTML;
  return html === "" ? null : html;
}
