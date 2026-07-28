import { useEffect, useRef } from "react";
import { isOverlayOpen } from "../shell/overlays";
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

/** The scope that owns the keyboard right now, from the DOM rather than from state. */
export function currentScope(): ShortcutScope {
  return isOverlayOpen() ? "overlay" : "board";
}

/** The entry a press resolves to, or `null`. Exported so a test can ask without a DOM event loop. */
export function resolveShortcut(
  event: KeyboardEvent,
  options: { readonly scope: ShortcutScope; readonly editing: boolean },
): Shortcut | null {
  for (const shortcut of SHORTCUTS) {
    if (shortcut.boundBy !== undefined) continue;
    if (shortcut.scope !== "global" && shortcut.scope !== options.scope) continue;
    if (options.editing && shortcut.allowInInput !== true) continue;
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

      const shortcut = resolveShortcut(event, {
        scope: currentScope(),
        editing: isWritingSurface(document.activeElement),
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
