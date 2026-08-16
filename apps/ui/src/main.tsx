import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { loadPlugins } from "./plugins/registry";
// Tokens first: every rule below resolves `var(--…)` declared here.
import "@corpus/kit/tokens.css";
import "@corpus/kit/row.css";
import "@corpus/kit/markdown.css";
import "@corpus/kit/autocomplete.css";
import "@corpus/kit/composer.css";
import "@corpus/kit/weight.css";
import "./app/global.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Corpus UI: no #root element — index.html and main.tsx have diverged");
}

// Plugin discovery (SPEC.md §10) is kicked off, not awaited: the first render
// must not wait on module fetches (the shell's keyboard and focus behavior is
// live from the first frame). Components that resolve plugin slots subscribe
// to the registry and re-render when it settles. `loadPlugins` never throws —
// a broken manifest becomes a console-strip warning, not a blank page.
void loadPlugins();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
