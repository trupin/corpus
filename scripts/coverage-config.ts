/**
 * The single description of what the coverage gate measures (INFRA-004).
 *
 * `vitest.config.ts` shapes the unit run's raw output from these globs and
 * `scripts/merge-coverage.ts` shapes the browser run's from the same ones, so
 * the merged report and the unit report describe the same file set. The
 * thresholds live here and are enforced in exactly one place — the merged gate.
 * A second enforcement site would be a gate that can disagree with itself.
 */

/** Repo-relative, POSIX. Matched against paths relative to the repository root. */
export const COVERAGE_INCLUDE = ["apps/*/src/**", "packages/*/src/**"];

/**
 * Bin shims are thin process glue (argv in, stdout out) with no logic of their
 * own — the logic they delegate to is covered directly. Generated
 * `*.generated.ts` modules are type-only declarations with no runtime
 * statements to cover; their generator is tested instead.
 *
 * The `.d.ts` entry is not redundant: naming `coverage.exclude` at all
 * *replaces* Vitest's defaults, so the declaration-file exclusion those defaults
 * carried has to be restated here. A `.d.ts` has no runtime statements.
 */
export const COVERAGE_EXCLUDE = [
  "**/*.test.{ts,tsx}",
  "apps/*/src/bin/**",
  "**/*.generated.ts",
  "**/*.d.ts",
];

export const COVERAGE_METRICS = ["lines", "statements", "functions", "branches"] as const;

export type CoverageMetric = (typeof COVERAGE_METRICS)[number];

export const COVERAGE_THRESHOLDS: Record<CoverageMetric, number> = {
  lines: 90,
  statements: 90,
  functions: 90,
  branches: 90,
};

/** Vitest's `reportsDirectory`: raw istanbul JSON from the unit run lands here. */
export const UNIT_COVERAGE_DIR = "coverage";

/**
 * Raw V8 entries dumped by the Playwright fixture, one JSON file per test.
 * Wiped by the suite's global setup so a merge never reads a previous run.
 *
 * Deliberately outside `coverage/`: Vitest empties its whole `reportsDirectory`
 * on every run, so raw e2e output kept in there would vanish the moment anyone
 * ran the unit half second.
 */
export const E2E_COVERAGE_DIR = "coverage-raw/browser-v8";

/**
 * `NODE_V8_COVERAGE` output from Node processes the e2e suite spawns. Nothing
 * in the shipped suite spawns one yet (sprint-008 Open Conflict 12); the merge
 * step reads the directory when it is populated and says so when it is not.
 */
export const NODE_COVERAGE_DIR = "coverage-raw/node-v8";

/** The merged report — the only artifact the 90% gate is computed from. */
export const MERGED_COVERAGE_DIR = "coverage/merged";
