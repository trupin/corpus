import { Extension, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import type { Editor } from "@tiptap/react";
import { DOC_REF_NAME } from "./markdown/refNode.js";

/**
 * `[[` — SPEC.md §11's "smart input everywhere", in the document body.
 *
 * The trigger is handled as a ProseMirror plugin rather than by watching the
 * DOM, because the thing being tracked is a *range in the document*: text typed
 * after `[[` has to stay attached to it while the user edits around it, and an
 * insertion has to replace exactly those characters. A DOM listener over a
 * contenteditable would lose the range the first time anything reflowed.
 *
 * The menu itself is React (`RefAutocomplete`, over `@corpus/kit`'s) and owns
 * the list and the highlight, because the list is a query. The plugin publishes
 * *where* and *what was typed*; the component decides what to show and hands
 * back a key handler so ↑/↓/⇥/↵/esc are answered before ProseMirror sees them.
 */

/** Everything the menu needs, published on every change to the trigger's state. */
export interface RefSuggestionState {
  /** Text typed after `[[`, for the title search. */
  readonly query: string;
  /** Where the trigger sits on screen, for positioning. */
  readonly clientRect: DOMRect | null;
  /** Replaces the trigger range with a ref node. */
  readonly select: (docId: string) => void;
  /** Dismisses the menu, leaving the literal `[[` characters in the text. */
  readonly close: () => void;
}

export interface RefSuggestionOptions {
  /** Called with the state while the trigger is open, and with `null` when it closes. */
  readonly onStateChange: (state: RefSuggestionState | null) => void;
  /**
   * The menu's key handler, in a box. `true` means the menu consumed the key —
   * which is how esc closes the menu instead of the reader (the escape chain
   * already ignores keys inside a contenteditable, and this keeps ↑/↓ from
   * moving the caret and ⇥ from moving focus out of the editor).
   */
  readonly keyHandler: { current: ((event: KeyboardEvent) => boolean) | null };
}

/** SPEC.md §11's trigger for "documents by title". */
export const REF_TRIGGER = "[[";

/**
 * Replaces the trigger's range with the reference node.
 *
 * **No trailing space.** The obvious nicety — a space after the atom so the
 * caret is clearly outside it — writes a trailing space at the end of a
 * paragraph when the reference is the last thing in it, and markdown cannot
 * represent that: the printer's only faithful spelling is the character
 * reference `&#x20;`, which is what then lands in the user's file. Observed on
 * disk before this comment existed. ProseMirror already places the caret after
 * the atom, so the space bought nothing.
 */
export function insertRef(editor: Editor, range: Range, docId: string): void {
  editor
    .chain()
    .focus()
    .insertContentAt(range, { type: DOC_REF_NAME, attrs: { id: docId, alias: null } })
    .run();
}

export function createRefSuggestion(options: RefSuggestionOptions): Extension {
  /**
   * The trigger position the user dismissed with esc.
   *
   * `@tiptap/suggestion` has no "close" command — its state is derived from
   * where the caret is, so a menu closed by esc would reopen on the very next
   * transaction. `allow` is the documented seam: refusing the trigger at the
   * position that was dismissed keeps it shut, and a `[[` typed anywhere else
   * opens normally.
   */
  let dismissedAt: number | null = null;

  return Extension.create({
    name: "corpusRefSuggestion",

    addProseMirrorPlugins() {
      const suggestion: SuggestionOptions = {
        editor: this.editor,
        char: REF_TRIGGER,
        allow: ({ range }) => dismissedAt === null || range.from !== dismissedAt,
        // Titles have spaces in them, and `[[mortgage op` has to keep matching.
        allowSpaces: true,
        // The trigger is legitimate anywhere inline text is — mid-sentence,
        // inside a list item, after an opening parenthesis.
        allowedPrefixes: null,
        startOfLine: false,
        // The list is a query the menu owns; the plugin only reports the range.
        items: () => [],
        command: ({ editor, range, props }) => {
          insertRef(editor, range, String((props as { id?: string }).id ?? ""));
        },
        render: () => {
          const publish = (props: {
            query: string;
            clientRect?: (() => DOMRect | null) | null;
            range: Range;
            editor: Editor;
            command: (attributes: { id: string }) => void;
          }): void => {
            options.onStateChange({
              query: props.query,
              clientRect: props.clientRect?.() ?? null,
              select: (docId) => {
                dismissedAt = null;
                props.command({ id: docId });
              },
              close: () => {
                dismissedAt = props.range.from;
                // A no-op transaction is what makes the plugin re-evaluate
                // `allow` and close; there is no meta channel to close it with.
                props.editor.view.dispatch(props.editor.state.tr);
              },
            });
          };
          return {
            onStart: publish,
            onUpdate: publish,
            onKeyDown: (props) => options.keyHandler.current?.(props.event) ?? false,
            onExit: () => {
              options.onStateChange(null);
            },
          };
        },
      };
      return [Suggestion(suggestion)];
    },
  });
}
