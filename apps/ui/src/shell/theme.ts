/**
 * Theme state. The prototype (`design/index.html`) has no toggle — it follows
 * the OS only — so this module is the one piece of the design system the port
 * adds rather than transcribes.
 *
 * Three modes, and `system` is the absence of an override: it removes
 * `data-theme` entirely so the `@media (prefers-color-scheme: dark)` block in
 * `@corpus/kit/tokens.css` keeps tracking the OS *live*, with no reload and no
 * resolved value frozen into the DOM.
 */

export const THEME_MODES = ["system", "light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * Namespaced so a workspace served from the same origin as other local tools
 * cannot collide. Duplicated in `index.html`'s pre-paint script — see
 * `theme.test.ts`, which fails if the two drift.
 */
export const THEME_STORAGE_KEY = "corpus.theme";

export const THEME_ATTRIBUTE = "data-theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

const NEXT_THEME_MODE: Record<ThemeMode, ThemeMode> = {
  system: "light",
  light: "dark",
  dark: "system",
};

/** Toggle order: `system → light → dark → system`. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return NEXT_THEME_MODE[mode];
}

/**
 * `localStorage` throws in Safari's private mode and in sandboxed frames.
 * Remembering a theme is a convenience, never a correctness requirement, so an
 * unavailable store degrades to "no persistence" instead of breaking the shell.
 */
function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Anything unrecognised — a stale key, a hand-edited value — reads as `system`. */
export function readStoredTheme(storage: Storage | null = storageOrNull()): ThemeMode {
  if (storage === null) return "system";
  let stored: string | null;
  try {
    stored = storage.getItem(THEME_STORAGE_KEY);
  } catch {
    return "system";
  }
  return isThemeMode(stored) ? stored : "system";
}

export function writeStoredTheme(mode: ThemeMode, storage: Storage | null = storageOrNull()): void {
  if (storage === null) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Quota exceeded or storage disabled mid-session: the mode still applies
    // to this document, it just will not survive a reload.
  }
}

export function applyTheme(root: HTMLElement, mode: ThemeMode): void {
  if (mode === "system") {
    root.removeAttribute(THEME_ATTRIBUTE);
  } else {
    root.setAttribute(THEME_ATTRIBUTE, mode);
  }
}

const THEME_LABELS: Record<ThemeMode, string> = {
  system: "system",
  light: "light",
  dark: "dark",
};

/** Glyphs, not words: the toggle sits in a 11px mono chip in the top bar. */
const THEME_GLYPHS: Record<ThemeMode, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export function themeGlyph(mode: ThemeMode): string {
  return THEME_GLYPHS[mode];
}

/** Accessible name for the toggle: states the current mode and the next one. */
export function themeToggleLabel(mode: ThemeMode): string {
  return `Theme: ${THEME_LABELS[mode]} — switch to ${THEME_LABELS[nextThemeMode(mode)]}`;
}
