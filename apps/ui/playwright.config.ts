import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const UI_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * `vite.config.ts` pins the dev server to 5173 (SPEC.md §3) and that stays the
 * default here. The override exists only so the suite can still run on a
 * machine where something else already holds the port — it passes `--port`
 * straight through to the same Vite config, proxy and all.
 */
const PORT = process.env.CORPUS_UI_PORT ?? "5173";
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The smoke suite runs against the real Vite dev server. It deliberately does
 * **not** start a workspace server: the shell must render, and say so honestly,
 * whether or not `127.0.0.1:8765` is up (SPEC.md §11 — the console strip is
 * where server state is reported). The proxy paths themselves are verified with
 * `curl` against a real origin and recorded in the issue's E2E log; re-run
 * against the real server in SERVER-003.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 2 : 0,
  reporter: process.env.CI !== undefined ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    cwd: UI_DIR,
    url: BASE_URL,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
