import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
// Tokens first: every rule below resolves `var(--…)` declared here.
import "@corpus/kit/tokens.css";
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
