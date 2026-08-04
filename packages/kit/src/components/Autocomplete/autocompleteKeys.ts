/**
 * SPEC.md §11's **autocomplete key contract**, in one place.
 *
 * > All autocompletes in the app share one keyboard contract: arrows move the
 * > highlight (wrapping at both ends), `⇥` and `↵` both accept the highlighted
 * > item, and `esc` dismisses the menu leaving the typed text as it stands.
 *
 * Three menus answer to that sentence and none of them can share the rest of
 * each other's implementation: the composers' menu detects `@` / `/` / `[[` in
 * a plain string, the document editor's is a range in a ProseMirror document
 * owned by `@tiptap/suggestion`, and the column query editor's parses a query
 * grammar against a vocabulary read off the corpus. What they *can* share is
 * the sentence itself — and before this module they did not. The query editor
 * accepted on `⇥`; the other two let `⇥` walk focus out of the field
 * mid-completion, and nothing noticed for three issues because the three key
 * handlers had nothing in common but their shape (UI-053, user report
 * 2026-08-03).
 *
 * It lives in the kit because §10 makes the kit the plugin contract: a
 * completing input a plugin contributes must answer to the same keys, and a
 * plugin may import nothing else.
 */

/**
 * The part of a keydown this contract needs.
 *
 * Structural rather than `React.KeyboardEvent`, because the same function must
 * serve React's synthetic events (the composers and the query field) *and* the
 * native ones ProseMirror hands to `@tiptap/suggestion`'s `onKeyDown` (the
 * document editor). Both satisfy this.
 */
export interface AutocompleteKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/**
 * **The menu only ever claims an unmodified press.**
 *
 * The contract's keys are bare keys — `↑` `↓` `⇥` `↵` `esc` — and every chord
 * built on one of them belongs to somebody else. Two of those somebodies are
 * live in the same field: SPEC.md §11 gives the composer `⌘↵` ("the primary
 * action is always `⌘↵`") and `⇧⌘↵`, and the browser gives everyone `⇧⇥` for
 * reverse focus. Neither has any accept semantics, and a menu that answered
 * them would be a menu overruling the app's primary action from a popup the
 * user opened by typing an `@`.
 *
 * The rule lives **here**, on the menu, rather than in the composer's key
 * handler: the composer consults the menu's claim before it looks at anything
 * (`composerKeys.ts`), so a menu that says "this is not my key" needs no host
 * to know a menu exists — and that holds for the ProseMirror host and any
 * plugin's completing input just as it does for the global composer, none of
 * which would otherwise spell the exclusion the same way. (PR #20 review,
 * MINOR: `⌘↵` in the global composer accepted a completion instead of asking.)
 */
function isBarePress(event: AutocompleteKeyEvent): boolean {
  return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** The highlight's next home, wrapping at both ends. */
function wrapIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

export interface AutocompleteKeyOptions {
  /** A menu is on screen. False hands every key straight back to the host. */
  readonly isOpen: boolean;
  /**
   * Rows in the list. Zero means a menu that is visible but has nothing to
   * accept — only the editor's `[[` reaches that state, because its open-ness
   * is a live document range rather than a count.
   */
  readonly count: number;
  readonly activeIndex: number;
  /** Receives the already-wrapped index. */
  readonly setActiveIndex: (index: number) => void;
  /** Applies the highlighted row. Called only when `count > 0`. */
  readonly accept: () => void;
  /** Closes the menu, leaving whatever the user typed exactly as it stands. */
  readonly dismiss: () => void;
  /**
   * Whether `↵` belongs to the menu. Defaults to true, which is the contract;
   * the column query editor is the one host that qualifies it, and its own
   * reasoning is recorded there.
   */
  readonly enterAccepts?: boolean | undefined;
}

/**
 * Applies the contract to one keydown. Returns whether the key was consumed —
 * which is how a host tells that it may fall through to its own handling, and,
 * in the ProseMirror path, is *the* signal that stops the key.
 *
 * Nothing is consumed while the menu is closed, and nothing is consumed from a
 * modified press: see {@link isBarePress}.
 *
 * `preventDefault` is called on every key this consumes, and that is what keeps
 * `⇥` in the field: a completion menu that lets focus escape mid-trigger is the
 * bug this module exists to prevent. ProseMirror would prevent the default
 * itself for a handler that returned true, but the composers have no such
 * mechanism and calling it here means one rule instead of two.
 */
export function handleAutocompleteKeyDown(
  event: AutocompleteKeyEvent,
  options: AutocompleteKeyOptions,
): boolean {
  if (!options.isOpen || !isBarePress(event)) return false;
  const { activeIndex, count, setActiveIndex } = options;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setActiveIndex(wrapIndex(activeIndex, event.key === "ArrowDown" ? 1 : -1, count));
    return true;
  }

  if (event.key === "Tab" || (event.key === "Enter" && (options.enterAccepts ?? true))) {
    // Nothing to accept. `⇥` is still consumed — leaving the field is never
    // what someone halfway through a trigger meant — but `↵` falls through,
    // because a newline is a real alternative meaning of the key and the menu
    // has nothing better to offer in its place.
    if (count === 0 && event.key !== "Tab") return false;
    event.preventDefault();
    if (count > 0) options.accept();
    return true;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    // Stopped so the layer *behind* the menu does not also act on the press:
    // the reader's escape chain would close the document, and the query field's
    // own Escape would abandon the edit. One press closes one thing — the menu
    // first, whatever is underneath on the next press.
    event.stopPropagation();
    options.dismiss();
    return true;
  }

  return false;
}
