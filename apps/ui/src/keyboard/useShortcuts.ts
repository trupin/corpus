import { useEffect, useRef } from "react";
import { isMenuOpen, isOverlayOpen } from "../shell/overlays";
import {
  matchesShortcut,
  SHORTCUTS,
  type Shortcut,
  type ShortcutContext,
  type ShortcutScope,
} from "./shortcuts";

/**
 * Binds {@link SHORTCUTS} to one global listener (SPEC.md §11).
 *
 * One listener, from one list. The prototype scatters `document.onkeydown`
 * branches across its surfaces, and the shipped tree had already grown two of
 * them — the shell's ⌘K and the board's `⇧←`/`⇧→` — before this issue. Every
 * additional listener is another thing that can consume a key the layer above it
 * should have had, and none of them appears in any legend.
 *
 * What this deliberately does **not** own is `esc`/`⌫`: that chain is
 * `useEscapeLayer`'s, and entries marked `boundBy: "escape-layer"` are skipped
 * here (see `shortcuts.ts`).
 *
 * Nor does it own `↵` while a control has focus: pressing that control is what
 * `↵` means there, and cancelling the key is what stopped every button in the
 * app from being pressable by keyboard. {@link ownsActivationKeys} is the test,
 * `Shortcut.yieldsToFocusedControl` marks the entries it applies to, and
 * `shortcuts.ts` carries the rule and the alternatives rejected (UI-032).
 */

/** The attribute a writing surface sets on its root to opt every key out. */
export const SHORTCUTS_OFF = '[data-shortcuts="off"]';

const EDITABLE = `input, textarea, select, [contenteditable=""], [contenteditable="true"], ${SHORTCUTS_OFF}`;

/**
 * Whether the keyboard belongs to something the user is typing in.
 *
 * **Read from `document.activeElement`, never from `event.target`.** ProseMirror
 * re-targets its key events, so a `c` typed into the document editor arrives
 * with a target that is not the editable node — and a guard written against the
 * target lets `c` open the composer mid-sentence (TEST-157, the single most
 * likely regression in this issue). What is focused is not re-targetable.
 */
export function isWritingSurface(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.closest(EDITABLE) !== null;
}

/**
 * The board's own row control, exempted below **by name**.
 *
 * `@corpus/kit`'s `Row` is a `role="button"`, `tabindex="0"` element, and a
 * plugin `ListItem` may render a real `<button>` — either way it carries these
 * two attributes, because that pair is what the row cursor already reads
 * (`useRowCursor.columnRows`). So the exemption is expressed in the same terms
 * the rest of the board expresses a row in, rather than in a marker a row could
 * be written without.
 */
export const BOARD_ROW = ".row[data-row-doc]";

/**
 * Controls that press themselves on `↵`: a native default action, or an ARIA
 * role whose keyboard contract is "`↵` activates it".
 *
 * Elements that take *typing* are deliberately absent — an `<input>` or a
 * `contenteditable` is a writing surface, and {@link isWritingSurface} already
 * suppresses every binding but ⌘K inside one.
 *
 * A few of these roles — `switch`, `checkbox`, `radio` — are Space-first in
 * ARIA, and are listed anyway. The asymmetry is deliberate: including one that
 * takes only Space costs a `↵` that does nothing on it, while leaving one out
 * costs the board acting behind a control the user is looking at, which is the
 * defect this exists to close.
 */
const ACTIVATION_CONTROL = [
  "button",
  "summary",
  "a[href]",
  "area[href]",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="treeitem"]',
].join(", ");

/**
 * Whether the focused element owns `↵` because pressing it *is* what `↵` does
 * there — UI-032's rule, stated in full on `Shortcut.yieldsToFocusedControl`.
 *
 * **Matched on the element itself, never with `closest`.** Focus lands on the
 * control, so climbing gains nothing and costs the case that matters: a
 * quick-action `<button>` *inside* a row would climb to the row, be read as the
 * board's own control, and lose its `↵` — which is the defect, one level in.
 */
export function ownsActivationKeys(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.matches(BOARD_ROW)) return false;
  return element.matches(ACTIVATION_CONTROL);
}

/**
 * The scope that owns the keyboard right now, from the DOM rather than from state.
 *
 * An open **menu** counts as one of those surfaces (UI-028). `overlay` is the
 * scope's name for "a surface above the board is handling its own keys", and a
 * menu is exactly that: its arrows and `esc` are its own, and `↵` is its
 * items' — a `<button>`'s default action, which only survives if nothing at
 * this level claims the key first.
 */
export function currentScope(): ShortcutScope {
  return isOverlayOpen() || isMenuOpen() ? "overlay" : "board";
}

/** The entry a press resolves to, or `null`. Exported so a test can ask without a DOM event loop. */
export function resolveShortcut(
  event: KeyboardEvent,
  options: {
    readonly scope: ShortcutScope;
    readonly editing: boolean;
    /** {@link ownsActivationKeys} of `document.activeElement` (UI-032). */
    readonly controlFocused: boolean;
  },
): Shortcut | null {
  for (const shortcut of SHORTCUTS) {
    if (shortcut.boundBy !== undefined) continue;
    if (shortcut.scope !== "global" && shortcut.scope !== options.scope) continue;
    if (options.editing && shortcut.allowInInput !== true) continue;
    if (options.controlFocused && shortcut.yieldsToFocusedControl === true) continue;
    if (matchesShortcut(shortcut, event)) return shortcut;
  }
  return null;
}

export function useShortcuts(context: ShortcutContext): void {
  const live = useRef(context);
  live.current = context;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // An IME commit arrives as a keystroke that was never a keystroke
      // (SPEC.md §11 says nothing about it; every text surface does). `keyCode`
      // 229 is the pre-`isComposing` spelling browsers still emit.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.defaultPrevented) return;

      // One read of the focus, answering two questions about it.
      const focused = document.activeElement;
      const shortcut = resolveShortcut(event, {
        scope: currentScope(),
        editing: isWritingSurface(focused),
        controlFocused: ownsActivationKeys(focused),
      });
      if (shortcut === null) return;
      event.preventDefault();
      shortcut.run?.(live.current, event);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
