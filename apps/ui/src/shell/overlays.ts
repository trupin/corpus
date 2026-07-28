/**
 * Whether an overlay currently owns the keyboard.
 *
 * **The signal is the DOM, not a flag.** Four surfaces can be the top layer —
 * the search overlay, the compose panel, the cheat sheet, and whatever a plugin
 * mounts — and a boolean somewhere would be one more thing every one of them has
 * to remember to clear on unmount. Asking "is one mounted" cannot go stale.
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
