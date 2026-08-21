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
 * The suite runs against the real Vite dev server and **cannot reach a
 * workspace server at all** (INFRA-028): the `webServer` below starts Vite with
 * no proxy target, so `/api`, `/attachments` and `/events` are refused inside
 * the dev server rather than forwarded anywhere. Specs that need data stub the
 * transport in the browser; the rest assert what the shell does when nothing
 * answers (SPEC.md §11 — the console strip is where server state is reported).
 *
 * That used to depend on `127.0.0.1:8765` happening to be free, which made a
 * local run and a CI run test different systems. The proxy paths themselves are
 * verified with `curl` against a real origin and recorded in the issue's E2E
 * log.
 */
export default defineConfig({
  testDir: "./e2e",
  // Clears the raw V8 dump directory the coverage fixture writes into, so the
  // merged gate (INFRA-004) never reads a previous run's entries.
  globalSetup: "./e2e/coverage-setup.ts",
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
    // `dev:isolated` is plain `vite`, and `vite.config.ts` proxies nothing
    // unless `CORPUS_SERVER_ORIGIN` names a target (INFRA-028). `npm run dev` is
    // the script that names `127.0.0.1:8765`, and the suite deliberately does
    // not go through it: a dev server with no proxy target cannot reach a
    // workspace server, whatever is listening on the machine.
    command: `npm run dev:isolated -- --port ${PORT} --strictPort`,
    cwd: UI_DIR,
    // Neutralises an exported `CORPUS_SERVER_ORIGIN` — the workaround this
    // issue replaces — so a developer's shell cannot re-point the suite at a
    // live server. The empty value reads as "unset" in `vite.config.ts`.
    env: { CORPUS_SERVER_ORIGIN: "" },
    url: BASE_URL,
    // Never reuse: whatever already answers on this port may be serving a
    // different checkout, and the suite would test it and — since INFRA-004 —
    // attribute its coverage to the merged gate. Observed live: a run in this
    // worktree collected coverage for `apps/ui/src/dev/DataProbe.tsx`, a file
    // that exists only in a parallel agent's worktree, with all 13 specs green.
    // `--strictPort` now turns that into a loud port conflict instead.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
