import { defineConfig } from "vitest/config";
import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  UNIT_COVERAGE_DIR,
} from "./scripts/coverage-config.js";

export default defineConfig({
  test: {
    // `.tsx` is included for `apps/ui`, whose components are tested with React
    // Testing Library. Those files opt into jsdom with a per-file
    // `@vitest-environment` docblock; everything else stays on Node.
    include: [
      "apps/**/src/**/*.test.{ts,tsx}",
      "packages/**/src/**/*.test.{ts,tsx}",
      // Repo tooling lives outside the workspaces (CLAUDE.md → Repository
      // Structure) but is still tested by `npm test`.
      "scripts/**/*.test.ts",
      // The rehearsal *harness* is ordinary code with ordinary unit tests.
      // The rehearsal *pass* (`npm run rehearse`) spawns agents and is
      // deliberately not vitest and not in any gate (INFRA-033).
      "rehearsals/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      // Globs come from `scripts/coverage-config.ts` so the unit run and the
      // merged run describe the same file set.
      //
      // Naming `include` is also what keeps an untested file at 0% instead of
      // vanishing from the report. Vitest 3 spelled that `coverage.all`, on by
      // default; Vitest 4 removed the option and made `include` the switch —
      // with no `include` a v4 run reports only files some test loaded, which
      // would let a whole untested module raise the average by disappearing.
      // So this glob is load-bearing for the gate, not just a filter.
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
      // This run emits raw istanbul-format coverage-final.json and enforces
      // NOTHING: INFRA-004 moved the 90% bar onto the merged unit+e2e report,
      // computed by `scripts/merge-coverage.ts` (`npm run coverage`). Two gates
      // that can disagree is the outcome that would be worse than no gate.
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: UNIT_COVERAGE_DIR,
    },
  },
});
