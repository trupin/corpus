import { mkdirSync, rmSync } from "node:fs";
import { E2E_COVERAGE_DIR, NODE_COVERAGE_DIR } from "./coverage";

/**
 * Playwright `globalSetup`. Wipes both raw V8 dump directories before the suite
 * runs so a merge can never pick up entries from an earlier run — the merged
 * gate has to be a function of this run and nothing else. That includes
 * `NODE_V8_COVERAGE` output from spawned processes, which is otherwise the
 * easiest way to leave yesterday's numbers in today's report.
 */
export default function globalSetup(): void {
  for (const directory of [E2E_COVERAGE_DIR, NODE_COVERAGE_DIR]) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
  }
}
