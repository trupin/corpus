/**
 * Whether an overlay currently owns the keyboard.
 *
 * **The signal is the DOM, not a flag.** Several surfaces can be the top layer
 * — the search overlay, the compose panel, the cheat sheet — and a boolean
 * somewhere would be one more thing every one of them has to remember to clear
 * on unmount. Asking "is one mounted" cannot go stale.
 *
 * The contract that makes it true is a class pair: **every modal surface renders
 * `.overlay.open` as its scrim** (`design/index.html`'s markup). A panel that
 * manages its own visibility and skips those classes silently lies to every
 * caller of this function.
 *
 * It lives in its own module rather than in `Shell.tsx` so the shortcut
 * dispatcher — which `Shell` mounts — can read it without an import cycle.
 */
export function isOverlayOpen(): boolean {
  return document.querySelector(".overlay.open") !== null;
}

/**
 * The selector every menu surface in the app already asserts about itself.
 *
 * ARIA, not a private marker: the context-menu frame, the reader's ⋯ sheet, the
 * 💬 popover, the new-list picker and the search overlay's chip pickers all
 * declare `role="menu"` because that is what they are, and a signal they cannot
 * forget to set is worth more than one they must remember to.
 */
export const MENU_SURFACE = '[role="menu"]';

/**
 * Whether an open menu owns the keyboard.
 *
 * UI-028. A menu is a layer drawn over the board, and while it is up its items
 * are what the keyboard is talking to — SPEC.md §10: "`esc` dismisses, arrows
 * navigate, `↵` activates". The arrows worked because {@link ContextMenu}
 * handles them itself and the dispatcher skips an already-defaulted event; `↵`
 * did not, because a `<button>` activates on `↵` through its *default action*,
 * which runs after every listener — and the board's `rows.open` (`↵`) matched
 * first and called `preventDefault()`. The action never ran and the menu never
 * closed, in every menu in the app.
 *
 * The fix is not an `Enter` branch in the menu — that would leave `c`, `j`/`k`
 * and every other board key still acting on the board *behind* the open menu.
 * It is that a menu, like a modal overlay, takes the board's keys out of scope
 * while it is open, and the keys it declares to handle are then the only ones
 * that act.
 */
export function isMenuOpen(): boolean {
  return document.querySelector(MENU_SURFACE) !== null;
}
