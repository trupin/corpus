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
 * **Paste carries both back.** The same rider, read in the other direction: the
 * item was `readText`, which holds one flavor, so pasting a Google Docs
 * selection through the menu arrived as unformatted prose while ⌘V arrived as
 * headings and lists. It now reads `text/html` when the clipboard has one and
 * hands it to the editor's paste path (see {@link readFlavors}).
 *
 * **The clipboard is asked, not assumed.** `navigator.clipboard` is
 * permission-gated and can refuse; every refusal is reported as a notice rather
 * than swallowed, because a Paste that quietly does nothing is indistinguishable
 * from a Paste that pasted nothing.
 */

/** One clipboard entry, in the parts the rich read needs of it. */
export interface SelectionClipboardItem {
  readonly types: readonly string[];
  getType(type: string): Promise<{ text(): Promise<string> }>;
}

/** What the menu needs of `navigator.clipboard`. */
export interface SelectionClipboard {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
  /** Multi-flavor write. Absent in browsers that only carry plain text. */
  write?(items: readonly ClipboardItem[]): Promise<void>;
  /** Multi-flavor read. Absent — or refused — in browsers that only carry text. */
  read?(): Promise<readonly SelectionClipboardItem[]>;
}

/** What a paste puts into the document: the rich form when there is one. */
interface PasteFlavors {
  readonly text: string;
  readonly html: string | null;
}

export interface SelectionMenuItemsProps {
  /** Both flavors of the selection, captured when the menu opened. */
  readonly copy: SelectionCopy;
  /** Comment on selection, bound to the captured range; `null` when unavailable. */
  readonly onComment: (() => void) | null;
  /**
   * Replaces the captured range — `""` for Cut, the clipboard's contents for
   * Paste. `html` is the clipboard's rich flavor when it carried one, and it
   * goes in through the editor's own paste path. `null` when the selection is
   * not in editable content.
   */
  readonly onReplace: ((text: string, html?: string | null) => void) | null;
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

/**
 * Both flavors off the clipboard where the browser holds both, the text alone
 * where it does not.
 *
 * The mirror of {@link writeFlavors}, and it exists for the same defect read the
 * other way (PR #19 review): the menu's Paste was `readText`, which carries
 * exactly one flavor, while ⌘V one keystroke away pastes the rich one through
 * the schema. Copying out of a word processor and pasting *in* through the menu
 * therefore lost every heading, bullet and bold word — UI-042's report, in the
 * opposite direction.
 *
 * A refused or absent `read` degrades to `readText` rather than failing: the
 * rich read is permission-gated separately in some browsers, and losing the
 * formatting beats losing the paste. A genuine refusal surfaces from `readText`,
 * which is refused for the same reason and is the caller's error path.
 */
async function readFlavors(clipboard: SelectionClipboard): Promise<PasteFlavors> {
  if (clipboard.read !== undefined) {
    try {
      for (const item of await clipboard.read()) {
        if (!item.types.includes("text/html")) continue;
        const html = await (await item.getType("text/html")).text();
        const text = item.types.includes("text/plain")
          ? await (await item.getType("text/plain")).text()
          : "";
        if (html !== "") return { text, html };
      }
    } catch {
      // Deliberate: the plain read below is the fallback, and its own refusal is
      // what the caller reports. Two notices for one gesture would be noise.
    }
  }
  return { text: await clipboard.readText(), html: null };
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
        meta: "replaces the selection with the clipboard's contents",
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
              const flavors = await readFlavors(clipboard);
              onReplace(flavors.text, flavors.html);
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
