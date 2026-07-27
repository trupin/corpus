import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

/**
 * Browser- and process-side coverage collection for the e2e suite (INFRA-004).
 *
 * Every spec imports `test` from here rather than from `@playwright/test`: the
 * auto fixture below wraps each test in Chromium's CDP
 * `startJSCoverage`/`stopJSCoverage` and dumps the raw V8 entries to disk.
 * `scripts/merge-coverage.ts` source-maps them back to `<workspace>/src/**` and
 * merges them into the unit run's report, which is where the 90% gate lives.
 *
 * `resetOnNavigation: false` is load-bearing: several specs reload the page, and
 * the default would throw away everything executed before the reload.
 */

const UI_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(UI_DIR, "../../..");

/** Kept in step with `E2E_COVERAGE_DIR` in `scripts/coverage-config.ts`. */
export const E2E_COVERAGE_DIR =
  process.env.CORPUS_E2E_COVERAGE_DIR ?? resolve(REPO_ROOT, "coverage-raw/browser-v8");

/** Kept in step with `NODE_COVERAGE_DIR` in `scripts/coverage-config.ts`. */
export const NODE_COVERAGE_DIR =
  process.env.CORPUS_NODE_COVERAGE_DIR ?? resolve(REPO_ROOT, "coverage-raw/node-v8");

/**
 * The Vite root the dev server serves from, repo-relative. A browser URL of
 * `/src/shell/theme.ts` is this workspace's `src/shell/theme.ts`; the merge step
 * cannot know that from the URL alone, so the suite records it.
 */
const VITE_ROOT = relative(REPO_ROOT, resolve(UI_DIR, "..")).split(/[\\/]/).join("/");

/**
 * The seam for AC 2: any Node process a spec spawns (a `corpus` server, a
 * `corpus` CLI invocation) inherits this and drops raw V8 coverage into the
 * directory the merge step already reads. Nothing in the shipped suite spawns
 * one yet — `playwright.config.ts` starts Vite and nothing else — so today this
 * is a seam with no caller, deliberately (INFRA-004, sprint-008 Open Conflict 12).
 *
 *     const child = spawn(bin, args, { env: { ...process.env, ...nodeCoverageEnv() } });
 */
export function nodeCoverageEnv(): { NODE_V8_COVERAGE: string } {
  mkdirSync(NODE_COVERAGE_DIR, { recursive: true });
  return { NODE_V8_COVERAGE: NODE_COVERAGE_DIR };
}

export const test = base.extend<{ browserCoverage: void }>({
  browserCoverage: [
    async ({ page, browserName }, use) => {
      // `page.coverage` is Chromium-only. The suite runs one chromium project;
      // a project on another engine would contribute nothing, which the merge
      // step's own per-file report is what makes visible.
      const collecting = browserName === "chromium";
      if (collecting) {
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
      }

      await use();

      if (!collecting) return;
      const entries = await page.coverage.stopJSCoverage();
      mkdirSync(E2E_COVERAGE_DIR, { recursive: true });
      writeFileSync(
        resolve(E2E_COVERAGE_DIR, `${randomUUID()}.json`),
        JSON.stringify({ root: VITE_ROOT, entries }),
        "utf8",
      );
    },
    { auto: true },
  ],
});

export { expect };
