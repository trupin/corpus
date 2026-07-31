/**
 * Where the browser's own menu is the useful one, and therefore survives
 * (SPEC.md §11): *"on a text selection, inside the editor and any editable
 * field, and anywhere no Corpus item is under the cursor"*.
 *
 * Copy on a selection and spellcheck inside the editor are the concrete cases,
 * and losing either is a regression a user notices immediately. The "no Corpus
 * item under the cursor" half is each surface's own business — it knows what
 * its items are — so it is not decided here; what is decided here is the two
 * halves that are the same everywhere.
 */

/** Editable hosts, plus the plugin surfaces v1 leaves alone (sign-off item 4). */
const NATIVE_HOSTS = [
  "input",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[data-plugin-surface]",
].join(", ");

export interface NativeMenuContext {
  /** The event target. */
  readonly target: EventTarget | null;
  /** The document's current selection text, if any. */
  readonly selection: string;
}

export function keepsNativeMenu({ target, selection }: NativeMenuContext): boolean {
  if (selection.trim() !== "") return true;
  if (!(target instanceof Element)) return true;
  return target.closest(NATIVE_HOSTS) !== null;
}

/** The selection as the DOM reports it; `""` when there is none or none is readable. */
export function selectionText(): string {
  return globalThis.getSelection?.()?.toString() ?? "";
}
