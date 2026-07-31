import type { RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * A text selection's own actions (SPEC.md §11): **Comment on selection** first,
 * then the clipboard basics — Copy always, Cut and Paste in editable content.
 *
 * Comment is not a second commenting path. It is the floating toolbar's own
 * act, reached from a different gesture: the caller hands over the already
 * captured action, so the selector, the composer and the anchor are UI-007's
 * exactly as they are for 💬 (SPEC.md §6).
 *
 * **The clipboard is asked, not assumed.** `navigator.clipboard` is
 * permission-gated and can refuse; every refusal is reported as a notice rather
 * than swallowed, because a Paste that quietly does nothing is indistinguishable
 * from a Paste that pasted nothing.
 */

/** What the menu needs of `navigator.clipboard`. */
export interface SelectionClipboard {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export interface SelectionMenuItemsProps {
  /** The selected text, captured when the menu opened. */
  readonly text: string;
  /** Comment on selection, bound to the captured range; `null` when unavailable. */
  readonly onComment: (() => void) | null;
  /**
   * Replaces the captured range — `""` for Cut, the clipboard's text for
   * Paste. `null` when the selection is not in editable content.
   */
  readonly onReplace: ((text: string) => void) | null;
  readonly close: () => void;
  readonly onNotify: (notice: RowNotice) => void;
}

/**
 * The refusal, in the app's own sentence.
 *
 * The trailing stop goes: a `DOMException` ends its message with one ("…Read
 * permission denied."), and the notice continues past it.
 */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : "the browser refused it";
  return message.replace(/\.\s*$/, "");
}

export function SelectionMenuItems({
  text,
  onComment,
  onReplace,
  close,
  onNotify,
}: SelectionMenuItemsProps): ReactElement {
  const clipboard: SelectionClipboard | null = globalThis.navigator?.clipboard ?? null;

  const write = async (value: string): Promise<boolean> => {
    if (clipboard === null) {
      onNotify({ tone: "error", message: "This browser gives the page no clipboard access." });
      return false;
    }
    try {
      await clipboard.writeText(value);
      return true;
    } catch (error) {
      onNotify({ tone: "error", message: `Could not copy — ${reason(error)}` });
      return false;
    }
  };

  const actions: MenuAction[] = [];

  if (onComment !== null) {
    actions.push({
      id: "comment",
      label: "💬 Comment on selection",
      meta: "opens a thread anchored to these words",
      run: () => {
        onComment();
      },
    });
  }

  actions.push({
    id: "copy",
    label: "Copy",
    meta: "the selected text, to the clipboard",
    run: () => {
      // Voided deliberately: the menu closes in this tick and the outcome is
      // reported as a notice, which outlives it.
      void write(text);
    },
  });

  if (onReplace !== null) {
    actions.push(
      {
        id: "cut",
        label: "Cut",
        meta: "copies the text and removes it from the document",
        run: () => {
          // Removed only once the clipboard has it: text that failed to copy
          // and was deleted anyway is text the user has lost.
          void write(text).then((copied) => {
            if (copied) onReplace("");
          });
        },
      },
      {
        id: "paste",
        label: "Paste",
        meta: "replaces the selection with the clipboard's text",
        run: () => {
          void (async () => {
            if (clipboard === null) {
              onNotify({
                tone: "error",
                message: "This browser gives the page no clipboard access.",
              });
              return;
            }
            try {
              onReplace(await clipboard.readText());
            } catch (error) {
              onNotify({
                tone: "error",
                message: `Could not paste — ${reason(error)}. Reading the clipboard needs the browser's permission; ⌘V still works.`,
              });
            }
          })();
        },
      },
    );
  }

  return <MenuItems actions={actions} onDone={close} />;
}
