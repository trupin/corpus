/**
 * `npm run test:slow` — the runner for the budget-fraction report (INFRA-020).
 *
 * Reads a vitest JSON report produced with `--includeTaskLocation`, joins every
 * test to the budget its own source declares, and prints those at or above
 * {@link SLOW_TEST_BUDGET_FRACTION} of it. The reasoning about the threshold and
 * the parsing lives in `scripts/slow-tests.ts`. This file only reads files,
 * prints, and sets an exit code.
 *
 * ## It reports. It deliberately does not gate.
 *
 * The numerator is a wall-clock measurement taken on a shared machine. A
 * blocking form would go red because a runner was busy — which is precisely the
 * failure INFRA-020 exists to stop, reproduced inside the check meant to prevent
 * it. So this exits 0 on findings, and CI runs it as a reporting step.
 *
 * Making it block is a gate-policy decision and belongs to the user, not to this
 * file. What the data supports today is naming the class on every run so nobody
 * has to rediscover it with a hand-written grep — which is how the `20_000`
 * miss recorded in `scripts/slow-tests.ts` happened in the first place.
 *
 * Exit 1 is reserved for the report being missing or unreadable: a run that
 * measured nothing must say so rather than print a clean summary it did not
 * earn.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessRun,
  formatAssessment,
  readVitestReport,
  SLOW_TEST_BUDGET_FRACTION,
} from "./slow-tests.js";

const repoRoot = resolve(import.meta.dirname, "..");

/** Where `npm run test:slow` and the CI step both put the JSON report. */
const DEFAULT_REPORT = "coverage-raw/vitest-results.json";

const [given] = process.argv.slice(2);
const reportPath = resolve(repoRoot, given ?? DEFAULT_REPORT);

function fail(reason: string): never {
  process.stderr.write(`test:slow ✗ ${reason}\n`);
  process.stderr.write(
    "test:slow ✗ Nothing was measured, so nothing is being reported. Produce the report with\n" +
      "test:slow ✗   npm run test:slow\n" +
      "test:slow ✗ or point this script at a vitest JSON report written with --includeTaskLocation.\n",
  );
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  fail(`could not read ${reportPath}: ${error instanceof Error ? error.message : String(error)}`);
}

const tests = readVitestReport(parsed);
if (tests.length === 0) fail(`${reportPath} holds no test results this scan can read`);

const located = tests.filter((test) => test.line !== undefined).length;
if (located === 0) {
  fail(
    `${reportPath} carries no task locations — re-run vitest with --includeTaskLocation, ` +
      "without which no test can be joined to the budget it declares",
  );
}

const assessment = assessRun(
  tests,
  (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
  },
  SLOW_TEST_BUDGET_FRACTION,
);

for (const line of formatAssessment(assessment, repoRoot)) {
  process.stdout.write(`${line}\n`);
}
