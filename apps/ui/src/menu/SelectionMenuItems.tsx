import type { RowNotice } from "@corpus/kit";
import type { ReactElement } from "react";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";
import type { SelectionCopy } from "./selectionCopy";

/**
 * A text selection's own actions (SPEC.md §11): **Comment on selection** first,
 * then the clipboard basics — Copy always, Cut and Paste in editable content.
 *
 * Comment is not a second commenting path. It is the floating toolbar's own
 * act, reached from a different gesture: the caller hands over the already
 * captured action, so the selector, the composer and the anchor are UI-007's
 * exactly as they are for 💬 (SPEC.md §6).
 *
 * **Copy carries both flavors** (SPEC.md §11 clipboard rider). It used to be
 * `writeText`, which can hold exactly one — so the menu's Copy put plain text
 * and nothing else on the clipboard while ⌘C two keystrokes away put full
 * structure, and pasting into a word processor lost every heading, every bullet
 * and every bold word. `write` with a `ClipboardItem` is the only API that
 * carries more than one flavor; `writeText` remains the fallback for a browser
 * without it and for a selection with no rich form (see {@link writeFlavors}).
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
  /** Multi-flavor write. Absent in browsers that only carry plain text. */
  write?(items: readonly ClipboardItem[]): Promise<void>;
}

export interface SelectionMenuItemsProps {
  /** Both flavors of the selection, captured when the menu opened. */
  readonly copy: SelectionCopy;
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

/**
 * Both flavors where the browser can hold both, plain text where it cannot.
 *
 * The degradations are deliberate and ordered. No rich form (a selection in a
 * surface that has none) or no `write` (a browser whose clipboard is
 * text-only): `writeText`, which is what shipped before and is still correct.
 * A `write` that **rejects** falls back to `writeText` rather than failing the
 * copy outright — Safari refuses `ClipboardItem`s built across an `await`, and
 * a copy that loses its formatting beats a copy that loses the text too.
 */
async function writeFlavors(clipboard: SelectionClipboard, copy: SelectionCopy): Promise<void> {
  const rich = copy.html;
  if (rich === null || rich === "" || clipboard.write === undefined) {
    await clipboard.writeText(copy.text);
    return;
  }
  try {
    await clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([rich], { type: "text/html" }),
        "text/plain": new Blob([copy.text], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await clipboard.writeText(copy.text);
  }
}

export function SelectionMenuItems({
  copy,
  onComment,
  onReplace,
  close,
  onNotify,
}: SelectionMenuItemsProps): ReactElement {
  const clipboard: SelectionClipboard | null = globalThis.navigator?.clipboard ?? null;

  const write = async (): Promise<boolean> => {
    if (clipboard === null) {
      onNotify({ tone: "error", message: "This browser gives the page no clipboard access." });
      return false;
    }
    try {
      await writeFlavors(clipboard, copy);
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
    meta: "the selection, with its formatting, to the clipboard",
    run: () => {
      // Voided deliberately: the menu closes in this tick and the outcome is
      // reported as a notice, which outlives it.
      void write();
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
          // and was deleted anyway is text the user has lost. Cut is the same
          // act as Copy plus a delete, so it goes through the same write and
          // leaves the same two flavors — a cut that pasted worse than a copy
          // would be its own defect.
          void write().then((copied) => {
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
