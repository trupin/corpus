import type { BoardCommands } from "./boardCommands";

/**
 * SPEC.md §11's keyboard scheme, declared **once**.
 *
 * The prototype binds its handlers in one place and writes its cheat-sheet in
 * another, and the two agree only for as long as someone keeps them agreeing.
 * Here the list below is the single source: {@link useShortcuts} binds handlers
 * from it, and `CheatSheet` renders `.kbd-row`s from it, so a binding that
 * exists is a binding that is documented, and there is no edit that adds one
 * without the other.
 *
 * **`esc`/`⌫` is declared here and dispatched elsewhere, on purpose.** Its
 * precedence is not "which shortcut matched" but "which layer is on top", and
 * that chain already exists — UI-005's `useEscapeLayer`, which the reader, focus
 * mode, the overlays and the popovers all register into. Re-implementing it as a
 * scope stack in this module would be a second precedence chain that looked
 * principled and drifted from the z-order. So the entry carries
 * {@link Shortcut.boundBy} `"escape-layer"`: the dispatcher skips it, the cheat
 * sheet still renders it, and the legend stays provably complete without
 * claiming this module handles the key.
 */

/**
 * Where a binding is live.
 *
 * - `global` — everywhere, including with an overlay open (⌘K, and only ⌘K).
 * - `board` — the board and everything drawn over it that is not a modal
 *   overlay: the column readers and focus mode. These keys are for acting on
 *   documents, and focus mode is a way of reading one, not a mode that suspends
 *   the scheme.
 * - `overlay` — a surface above the board owns the keyboard by construction (its
 *   own panel handles its keys), so the only entry in this scope is the one the
 *   escape layer dispatches. A modal overlay is one; so is an open **menu**,
 *   whose `↵` is its focused item's own default action (UI-028).
 */
export type ShortcutScope = "global" | "board" | "overlay";

/**
 * One key combination, matched generically.
 *
 * Declaring the chord rather than writing a `match(event)` predicate is what
 * lets the registry-integrity test *generate* a probe event per binding and
 * prove no two entries in a scope answer the same key — a hand-written matcher
 * can only be tested against the keys someone remembered to test.
 */
export interface KeyChord {
  /** Accepted `KeyboardEvent.key` values. */
  readonly keys: readonly string[];
  /** Required shift state; `undefined` means "either" (`?` is shifted on most layouts). */
  readonly shift?: boolean | undefined;
  /** `true` requires ⌘ or Ctrl; omitted requires neither. */
  readonly mod?: boolean | undefined;
  /** The `<kbd>` chip in the cheat sheet. Omitted when the description names the key. */
  readonly label?: string | undefined;
}

/** What a handler is allowed to do. Everything here is supplied by the shell. */
export interface ShortcutContext {
  readonly openCompose: () => void;
  readonly openSearch: () => void;
  readonly toggleCheatSheet: () => void;
  /** The board's imperative surface, published through `BoardCommandsProvider`. */
  readonly board: BoardCommands;
}

export interface Shortcut {
  readonly id: string;
  readonly chords: readonly KeyChord[];
  readonly scope: ShortcutScope;
  /**
   * Live while the caret is in an input, textarea or contenteditable. Defaults
   * to false — typing `c` into a document types a `c` (SPEC.md §11 implies it;
   * anything else makes every writing surface unusable). ⌘K is the exception.
   */
  readonly allowInInput?: boolean;
  /** Declared here, dispatched by UI-005's `useEscapeLayer`. See the module note. */
  readonly boundBy?: "escape-layer";
  /** Ordering band for the cheat sheet; never rendered as a heading (the panel is one flat grid). */
  readonly group: string;
  readonly description: string;
  /**
   * The event is passed because several entries bind a *pair* of keys whose
   * only difference is direction: one `rows.move` row rather than two is what
   * the prototype's legend shows, and splitting it to avoid a parameter would
   * put two rows in the cheat sheet the prototype has as one.
   */
  readonly run?: (context: ShortcutContext, event: KeyboardEvent) => void;
}

/** `-1` for the "backwards" key of a directional pair, `+1` for the forwards one. */
export function chordDirection(event: KeyboardEvent): -1 | 1 {
  return event.key === "ArrowUp" ||
    event.key === "ArrowLeft" ||
    event.key === "k" ||
    event.key === "["
    ? -1
    : 1;
}

export function matchesChord(chord: KeyChord, event: KeyboardEvent): boolean {
  if (!chord.keys.includes(event.key)) return false;
  if (event.altKey) return false;
  if ((chord.mod ?? false) !== (event.metaKey || event.ctrlKey)) return false;
  if (chord.shift !== undefined && chord.shift !== event.shiftKey) return false;
  return true;
}

export function matchesShortcut(shortcut: Shortcut, event: KeyboardEvent): boolean {
  return shortcut.chords.some((chord) => matchesChord(chord, event));
}

/** The events a chord accepts, for tests and for the integrity check. */
export function chordProbes(chord: KeyChord): readonly KeyboardEventInit[] {
  return chord.keys.map((key) => ({
    key,
    shiftKey: chord.shift ?? false,
    metaKey: chord.mod === true,
  }));
}

/** Every probe the registry describes — one per accepted key of every chord. */
export function shortcutProbes(): readonly { shortcut: Shortcut; probe: KeyboardEventInit }[] {
  return SHORTCUTS.flatMap((shortcut) =>
    shortcut.chords.flatMap((chord) => chordProbes(chord).map((probe) => ({ shortcut, probe }))),
  );
}

/**
 * The scheme, in `design/index.html`'s cheat-sheet order — which is also
 * SPEC.md §11's enumeration order.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: "rows.move",
    chords: [
      { keys: ["ArrowUp"], shift: false, label: "↑" },
      { keys: ["ArrowDown"], shift: false, label: "↓" },
      { keys: ["k"], shift: false },
      { keys: ["j"], shift: false },
    ],
    scope: "board",
    group: "rows",
    description: "move rows (also j / k)",
    run: (context, event) => {
      context.board.moveRowCursor(chordDirection(event));
    },
  },
  {
    id: "rows.open",
    chords: [{ keys: ["Enter"], shift: false, label: "↵" }],
    scope: "board",
    group: "rows",
    description: "open document",
    run: (context) => {
      context.board.openRowAtCursor(false);
    },
  },
  {
    id: "rows.openFullScreen",
    chords: [{ keys: ["Enter"], shift: true, label: "⇧↵" }],
    scope: "board",
    group: "rows",
    description: "open in full screen",
    run: (context) => {
      context.board.openRowAtCursor(true);
    },
  },
  {
    id: "menu.open",
    /**
     * Both spellings of "open this item's menu": the dedicated menu key that
     * most PC keyboards carry, and `⇧F10`, which every platform accepts.
     */
    chords: [
      { keys: ["ContextMenu"], label: "menu" },
      { keys: ["F10"], shift: true, label: "⇧F10" },
    ],
    scope: "board",
    group: "rows",
    description: "actions for the highlighted row",
    run: (context) => {
      context.board.openContextMenu();
    },
  },
  {
    id: "layers.close",
    chords: [{ keys: ["Escape"], label: "esc" }, { keys: ["Backspace"] }],
    scope: "global",
    boundBy: "escape-layer",
    group: "layers",
    description: "close / back",
  },
  {
    id: "columns.switch",
    chords: [
      { keys: ["ArrowLeft"], shift: false, label: "←" },
      { keys: ["ArrowRight"], shift: false, label: "→" },
      { keys: ["["], shift: false },
      { keys: ["]"], shift: false },
    ],
    scope: "board",
    group: "columns",
    description: "switch column (also [ / ])",
    run: (context, event) => {
      context.board.switchColumn(chordDirection(event));
    },
  },
  {
    id: "columns.move",
    chords: [
      { keys: ["ArrowLeft"], shift: true, label: "⇧←" },
      { keys: ["ArrowRight"], shift: true, label: "⇧→" },
    ],
    scope: "board",
    group: "columns",
    description: "move column",
    run: (context, event) => {
      context.board.moveActiveColumn(chordDirection(event));
    },
  },
  {
    id: "doc.focusMode",
    chords: [{ keys: ["f"], shift: false, label: "f" }],
    scope: "board",
    group: "document",
    description: "focus mode",
    run: (context) => {
      context.board.toggleFocusMode();
    },
  },
  {
    id: "doc.archive",
    chords: [{ keys: ["e"], shift: false, label: "e" }],
    scope: "board",
    group: "document",
    description: "archive open / highlighted doc",
    run: (context) => {
      context.board.archiveTarget();
    },
  },
  {
    id: "doc.reply",
    chords: [{ keys: ["r"], shift: false, label: "r" }],
    scope: "board",
    group: "document",
    description: "reply in open thread",
    run: (context) => {
      context.board.focusReply();
    },
  },
  {
    id: "compose.open",
    chords: [{ keys: ["c"], shift: false, label: "c" }],
    scope: "board",
    group: "global",
    description: "Ask / Capture composer",
    run: (context) => {
      context.openCompose();
    },
  },
  {
    id: "search.open",
    chords: [{ keys: ["k", "K"], mod: true, label: "⌘K" }],
    scope: "global",
    allowInInput: true,
    group: "global",
    description: "search",
    run: (context) => {
      context.openSearch();
    },
  },
  {
    id: "cheatSheet.toggle",
    chords: [{ keys: ["?"], label: "?" }],
    /**
     * Global so the sheet can close itself — an overlay-scoped `?` could open
     * the legend and then be refused by its own overlay. Whether a *different*
     * overlay may be replaced by it is the shell's call, and the shell's answer
     * is no: `?` on top of the composer is ignored rather than stacking.
     */
    scope: "global",
    group: "global",
    description: "this cheat-sheet",
    run: (context) => {
      context.toggleCheatSheet();
    },
  },
];
