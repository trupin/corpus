import type { KeyboardEvent } from "react";

/**
 * SPEC.md §11's **composer key contract**, in one place.
 *
 * > `↵` always inserts a newline and never submits; the primary action is
 * > always `⌘↵`; a secondary action, where one exists, is `⇧⌘↵`. Every submit
 * > control names its key, and an IME composition commit never submits.
 *
 * It lives in the kit rather than in `apps/ui` because the sentence binds *every*
 * composer — "and any composer a plugin contributes" — and a plugin may import
 * nothing else (§10). Before this module the app had five composers spelling the
 * contract four different ways, one of which (`NewChildThread`) sent a comment on
 * an IME composition commit because it was missing a guard its siblings had.
 * That is what five copies of a keyboard convention costs, so there is one.
 *
 * **What is deliberately not here.** The query editor's `↵` *commits the query*
 * (`apps/ui/src/board/query/QueryEditor.tsx`) and the board's `↵` opens the
 * highlighted row. Neither is a composer, neither uses this, and neither is
 * bound by the contract — a composer is a surface whose content is prose the
 * user is writing.
 */

/** The chord every composer's primary action answers to (`Send`, `Comment`, `Ask`). */
export const COMPOSER_PRIMARY_KEY = "⌘↵";

/** The chord a secondary action answers to, where a composer has one (`Capture`). */
export const COMPOSER_SECONDARY_KEY = "⇧⌘↵";

/** What `↵` does now, for the hints that used to advertise `⇧↵`. */
export const COMPOSER_NEWLINE_HINT = "↵ newline";

export interface ComposerKeyOptions {
  /**
   * `⌘↵` (and `Ctrl+↵`, where the platform's chord is that one). Called only
   * when the composer can actually submit — the callback owns that check, as it
   * does for the click on the same button.
   */
  readonly onPrimary: () => void;
  /** `⇧⌘↵`. Omitted by every composer that has one submit, which is most of them. */
  readonly onSecondary?: () => void;
  /** `esc`. Omitted by composers that let the key fall through to the escape chain. */
  readonly onEscape?: () => void;
  /**
   * An open autocomplete menu's claim on the key (`useAutocomplete`'s
   * `handleKeyDown`), consulted **before** the contract: while the menu is open
   * `↵` accepts the highlighted completion instead of inserting a newline, and
   * the menu's own `preventDefault` is what keeps the newline from also being
   * inserted. Dismissing the menu closes it, the claim stops returning true, and
   * `↵` means newline again.
   */
  readonly claim?: (event: KeyboardEvent) => boolean;
}

/**
 * Applies the contract to one `keydown`. Returns whether the key was consumed,
 * so a host with further handling of its own can tell.
 *
 * A plain `↵` — and `⇧↵`, which used to be the newline everywhere — is
 * deliberately **not** consumed and **not** prevented: the browser's own
 * insertion is the behaviour, and preventing it to re-insert `\n` by hand would
 * break undo history and IME.
 */
export function handleComposerKeyDown(event: KeyboardEvent, options: ComposerKeyOptions): boolean {
  // An IME commit arrives as `Enter` with `isComposing` set. It ends the
  // composition and nothing else: not a submit, not a completion, not a close.
  if (event.nativeEvent.isComposing) return false;

  if (options.claim?.(event) === true) return true;

  if (event.key === "Escape") {
    if (options.onEscape === undefined) return false;
    event.preventDefault();
    // The escape chain skips writing surfaces, so this only stops a host that
    // handles the key itself (a card, a popover) from closing underneath.
    event.stopPropagation();
    options.onEscape();
    return true;
  }

  if (event.key !== "Enter") return false;
  // The whole point: unmodified `↵` belongs to the text.
  if (!event.metaKey && !event.ctrlKey) return false;

  if (event.shiftKey) {
    if (options.onSecondary === undefined) return false;
    event.preventDefault();
    options.onSecondary();
    return true;
  }

  event.preventDefault();
  options.onPrimary();
  return true;
}
