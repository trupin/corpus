import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOKENS_CSS = fileURLToPath(new URL("../../../packages/kit/src/tokens.css", import.meta.url));

const css = readFileSync(TOKENS_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Reads a token straight out of `@corpus/kit`'s stylesheet, so the e2e
 * assertions compare the browser against the *declared* design system rather
 * than against a colour copied into a spec file — which would drift silently.
 */
export function token(themeSelector: string, name: string): string {
  const block = new RegExp(`${themeSelector}\\s*\\{([^}]*)\\}`).exec(css);
  if (block === null) throw new Error(`No token block for ${themeSelector}`);
  const declaration = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block[1] ?? "");
  if (declaration === null) throw new Error(`No ${name} in ${themeSelector}`);
  return (declaration[1] ?? "").trim();
}

/** `#rrggbb` → the `rgb(r, g, b)` form `getComputedStyle` returns in Chromium. */
export function hexToRgb(hex: string): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (match === null) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const [, r, g, b] = match;
  return `rgb(${String(parseInt(r ?? "", 16))}, ${String(parseInt(g ?? "", 16))}, ${String(parseInt(b ?? "", 16))})`;
}

export const LIGHT_BG = hexToRgb(token(':root\\[data-theme="light"\\]', "--bg"));
export const DARK_BG = hexToRgb(token(':root\\[data-theme="dark"\\]', "--bg"));
export const LIGHT_ACCENT = hexToRgb(token(':root\\[data-theme="light"\\]', "--accent"));
