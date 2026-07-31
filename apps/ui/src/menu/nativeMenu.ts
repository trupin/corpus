/**
 * Which menu a right-click gets, in the two halves that are the same everywhere
 * (SPEC.md §11).
 *
 * The native browser menu survives *"inside the editor and any editable field
 * **when nothing is selected**, and anywhere no Corpus item is under the
 * cursor"* — spellcheck is the concrete case, and losing it is a regression a
 * user notices immediately. A **selection in the document body** gets Corpus's
 * own menu instead, because Comment on selection is worth more there than Look
 * Up (user decision, 2026-07-30).
 *
 * **A selection never suppresses an item's menu** (user report, 2026-07-30).
 * The rule used to be "any non-empty selection anywhere keeps the native menu",
 * which meant a row's menu vanished whenever text was selected somewhere else
 * on the page — including the word the browser auto-selects under the
 * right-click itself, which made row menus fail "sometimes" with no visible
 * cause. Selections are now judged against the **target**, never globally.
 *
 * The "no Corpus item under the cursor" half stays each surface's own business:
 * it knows what its items are.
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

/** Editable hosts only — what decides whether Cut and Paste are offered. */
const EDITABLE_HOSTS = "input, textarea, [contenteditable=''], [contenteditable='true']";

/** A plugin owns its whole surface, menus included (SPEC.md §10). */
const PLUGIN_SURFACE = "[data-plugin-surface]";

/**
 * The document body, in all three of its renders — the editor's
 * contenteditable, `MarkdownView`, and a thread's conversation. The selection
 * menu is offered inside it and nowhere else: a selection in a row title or in
 * the console belongs to the item under it.
 */
const BODY_HOST = ".doc-body";

export interface NativeMenuContext {
  /** The event target. */
  readonly target: EventTarget | null;
}

/**
 * The browser's menu wins here.
 *
 * Takes no selection: an item's menu opens over a stray selection, and the
 * document body's own selection menu is decided by {@link selectionMenuTarget}
 * before this is ever asked.
 */
export function keepsNativeMenu({ target }: NativeMenuContext): boolean {
  if (!(target instanceof Element)) return true;
  return target.closest(NATIVE_HOSTS) !== null;
}

/**
 * The parts of `Selection` this rule reads.
 *
 * Structural rather than the DOM type so a test can hand over a range it built
 * itself: jsdom carries `Range` faithfully and `Selection` only partly, and the
 * rule is about the range.
 */
export interface SelectionSource {
  readonly isCollapsed: boolean;
  readonly rangeCount: number;
  toString(): string;
  getRangeAt(index: number): { readonly commonAncestorContainer: Node };
}

export interface SelectionMenuTarget {
  /**
   * The selected text, read before the menu opens — opening one moves focus,
   * and a Copy that read the selection on activation would copy nothing.
   */
  readonly text: string;
  /** The selection sits in editable content: Cut and Paste are offered. */
  readonly editable: boolean;
}

/**
 * The selection the right-click landed on, or `null` for every other case.
 *
 * Three things have to hold: there is a non-whitespace selection, it lives in a
 * document body, and the pointer is **on** it rather than merely on the same
 * page. The last is what keeps a selection in one paragraph from turning a
 * right-click five paragraphs down into a selection menu — and what makes the
 * auto-selected word under the cursor behave like the deliberate selection it
 * visually is.
 */
export function selectionMenuTarget(
  target: EventTarget | null,
  selection: SelectionSource | null = globalThis.getSelection?.() ?? null,
): SelectionMenuTarget | null {
  if (!(target instanceof Element)) return null;
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString();
  // Whitespace cannot be quoted (SPEC.md §6's `exact` is `min(1)`) and is never
  // what someone meant to select.
  if (text.trim() === "") return null;

  const container = selection.getRangeAt(0).commonAncestorContainer;
  const host = container instanceof Element ? container : container.parentElement;
  if (host === null) return null;

  const body = host.closest(BODY_HOST);
  if (body === null || body.closest(PLUGIN_SURFACE) !== null) return null;
  if (!body.contains(target)) return null;
  // The selection's own subtree, against the pointer's: either may contain the
  // other (the target is an element, the range is often inside one text node).
  if (!host.contains(target) && !target.contains(host)) return null;

  return { text, editable: body.closest(EDITABLE_HOSTS) !== null };
}
