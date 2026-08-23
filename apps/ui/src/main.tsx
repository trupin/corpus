/*
 * **The kit's stylesheets are the base layer, so they are imported first**
 * (UI-156).
 *
 * The six lines below sit above `./app/App` on purpose, and moving them is a
 * visible change to what the reader sees. Vite injects a module's CSS in
 * module-graph order, so importing `App` first injected every rule in
 * `apps/ui` *before* every rule in `packages/kit` — and an app selector that
 * ties a kit selector on specificity then lost to it. The app's rules are
 * specializations of the kit's (`.turn-markdown` exists only to override
 * `.doc-body`), so the kit losing a tie is the intended cascade and the kit
 * winning one is the defect.
 *
 * Measured in a browser rather than read off a stylesheet, at 1280×720, across
 * the board, both readers, full screen, the search overlay, the compose panel,
 * both address cards, the `[[` autocomplete, the row and editor context menus,
 * the explorer and the console. **Exactly two ties are live**, and both are
 * `Reader.css` against `markdown.css`'s `.doc-body`:
 *
 *   .turn-markdown       font-family serif → var(--sans), 15px → 12.5px,
 *                        line-height 1.62 → 1.5, max-width 62ch → none
 *   .thread-conversation font-family serif → var(--sans), 15px → 12.5px
 *
 * Every other difference the sweep reported is a consequence of those two — a
 * turn's height, and a `ch` measure resolving against a different typeface. No
 * other surface moved at all.
 *
 * `./app/global.css` stays last: it is the app's own base (`html`, `body`,
 * scrollbars) and it wins over everything by being last, before and after this
 * change alike.
 *
 * The claim is asserted in `apps/ui/e2e/cascade-order.spec.ts`, which measures
 * a painted turn. A cascade tie is invisible to any test that does not read a
 * computed style, so nothing else in the suite would notice this flipping back.
 */
// Tokens first: every rule below resolves `var(--…)` declared here.
import "@corpus/kit/tokens.css";
import "@corpus/kit/row.css";
import "@corpus/kit/markdown.css";
import "@corpus/kit/autocomplete.css";
import "@corpus/kit/composer.css";
import "@corpus/kit/address.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/global.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Corpus UI: no #root element — index.html and main.tsx have diverged");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
