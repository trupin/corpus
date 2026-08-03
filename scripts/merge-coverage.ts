import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { CoverageMapData } from "istanbul-lib-coverage";
import { CoverageReport } from "monocart-coverage-reports";
import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  COVERAGE_THRESHOLDS,
  E2E_COVERAGE_DIR,
  MERGED_COVERAGE_DIR,
  NODE_COVERAGE_DIR,
  UNIT_COVERAGE_DIR,
} from "./coverage-config.js";
import {
  attributionOf,
  browserDumpNames,
  coverageScope,
  emptyScopeFailure,
  formatMetricsTable,
  isRepoSourceEntry,
  projectExecutedLines,
  readBrowserDumps,
  rewriteEntrySources,
  summarize,
  thresholdFailures,
  toRepoRelative,
  type ExecutedLines,
  type SourceLineCoverage,
} from "./coverage-gate.js";

/**
 * The combined coverage gate (INFRA-004). Reads the unit run's istanbul output
 * and the e2e run's raw V8 output, merges them, writes one report and enforces
 * the 90% thresholds — the only place in the repo that enforces them.
 *
 *     npm run coverage        # unit → e2e → merge → gate
 *     npx tsx scripts/merge-coverage.ts   # merge → gate, on existing output
 *
 * `coverage:merge` runs this under `--max-old-space-size=8192` (INFRA-017). The
 * streaming reader below is what brought peak RSS on a 237-spec run down from
 * 4.0 GB to well under 1 GB, but the flag stays on top of it: V8's default old
 * space is derived from the host's RAM (~4 GB on a 16 GB GitHub runner), which
 * is the ceiling this hit, and the browser corpus grows with every spec added.
 * A cap is not a reservation, so it costs nothing on a machine that never needs
 * it; the trade-off it accepts is that a host with less than ~8 GB free would
 * now be killed by the OS rather than by a legible V8 heap error.
 */

const repoRoot = resolve(import.meta.dirname, "..");
function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Runs the raw V8 data through `monocart-coverage-reports`, which unpacks each
 * entry through its source map and reports per-source line hits. The `none`
 * reporter is deliberate: the merged istanbul report below is the artifact, and
 * a second on-disk report would be a second answer to the same question.
 *
 * Takes dump *names*, not dumps: the whole corpus does not fit in memory at once
 * (INFRA-017), so the dumps are pulled from disk one at a time by the loop below
 * and each is released before the next is parsed.
 */
async function executedLines(
  browserDirectory: string,
  dumpNames: readonly string[],
  nodeDirectory: string,
): Promise<ExecutedLines> {
  const inScope = coverageScope(COVERAGE_INCLUDE, COVERAGE_EXCLUDE);
  const report = new CoverageReport({
    logging: "error",
    reports: ["none"],
    outputDir: resolve(repoRoot, MERGED_COVERAGE_DIR, "v8-cache"),
    baseDir: repoRoot,
    entryFilter: isRepoSourceEntry,
    sourceFilter: inScope,
    clean: true,
    cleanCache: true,
  });

  for (const dump of readBrowserDumps(browserDirectory, dumpNames)) {
    // Filtered with the reporter's own `entryFilter` before rewriting rather than
    // after: those entries are the larger half of a dump, and rewriting them
    // would build a second copy of megabytes the reporter then discards.
    const entries = dump.entries
      .filter(isRepoSourceEntry)
      .map((entry) => rewriteEntrySources(entry, dump.root, repoRoot));
    // A test that never navigated to the app contributes nothing here, and the
    // reporter rejects an empty batch outright rather than treating it as
    // "nothing to add".
    if (entries.length === 0) continue;
    await report.add(entries);
  }
  if (countDumps(nodeDirectory) > 0) {
    await report.addFromDir(nodeDirectory);
  }

  const results = await report.generate();
  const lines = new Map<string, SourceLineCoverage>();
  for (const file of results?.files ?? []) {
    const path = isAbsolute(file.sourcePath)
      ? toRepoRelative(file.sourcePath, repoRoot)
      : file.sourcePath;
    if (!inScope(path)) continue;
    lines.set(path, { lines: file.data?.lines ?? {}, extras: file.data?.extras ?? {} });
  }
  return lines;
}

function countDumps(directory: string): number {
  return existsSync(directory) ? readdirSync(directory).length : 0;
}

async function main(): Promise<void> {
  const unitFile = resolve(repoRoot, UNIT_COVERAGE_DIR, "coverage-final.json");
  if (!existsSync(unitFile)) {
    log(`coverage: no unit coverage at ${UNIT_COVERAGE_DIR}/coverage-final.json.`);
    log("coverage: run `npm run test:coverage` first, or use `npm run coverage`.");
    process.exitCode = 1;
    return;
  }

  const rawUnit = JSON.parse(readFileSync(unitFile, "utf8")) as CoverageMapData;
  const unit: CoverageMapData = {};
  for (const [absolute, file] of Object.entries(rawUnit)) {
    const path = toRepoRelative(absolute, repoRoot);
    unit[path] = { ...file, path };
  }

  const browserDirectory = resolve(repoRoot, E2E_COVERAGE_DIR);
  const dumpNames = browserDumpNames(browserDirectory);
  if (dumpNames.length === 0) {
    log(`coverage: no browser coverage in ${E2E_COVERAGE_DIR}.`);
    log("coverage: run `npm run e2e` first, or use `npm run coverage`.");
    process.exitCode = 1;
    return;
  }

  const nodeDirectory = resolve(repoRoot, NODE_COVERAGE_DIR);
  const nodeDumps = countDumps(nodeDirectory);

  const lines = await executedLines(browserDirectory, dumpNames, nodeDirectory);
  const projected = projectExecutedLines(unit, lines);

  const summary = summarize(projected.data, repoRoot);

  // Before anything is written or reported: a report of no files would pass the
  // gate at 100% and be indistinguishable from a covered repo (INFRA-009).
  const scopeFailure = emptyScopeFailure(summary);
  if (scopeFailure !== null) {
    log(`ERROR: ${scopeFailure}`);
    process.exitCode = 1;
    return;
  }

  const outputDirectory = resolve(repoRoot, MERGED_COVERAGE_DIR);
  rmSync(resolve(outputDirectory, "v8-cache"), { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, "coverage-final.json"), JSON.stringify(projected.data));
  writeFileSync(
    resolve(outputDirectory, "coverage-summary.json"),
    JSON.stringify(
      {
        total: summary.total,
        workspaces: Object.fromEntries(summary.workspaces),
      },
      null,
      2,
    ),
  );

  const attribution = [...lines]
    .map(([path, coverage]) => attributionOf(path, coverage))
    .sort((a, b) => b.executed - a.executed || a.path.localeCompare(b.path));
  writeFileSync(
    resolve(outputDirectory, "e2e-attribution.json"),
    JSON.stringify(attribution, null, 2),
  );

  log("");
  log("Combined coverage — unit (Vitest) + e2e (Playwright/Chromium V8)");
  log(
    `  inputs: ${String(Object.keys(unit).length)} files from ${UNIT_COVERAGE_DIR}/coverage-final.json, ` +
      `${String(dumpNames.length)} browser dumps from ${E2E_COVERAGE_DIR}, ` +
      `${String(nodeDumps)} NODE_V8_COVERAGE dumps from ${NODE_COVERAGE_DIR}`,
  );
  log(
    `  e2e attributed coverage to ${String(lines.size)} in-scope source files, top 8 by executed lines:`,
  );
  for (const file of attribution.slice(0, 8)) {
    log(
      `    ${file.path}  ${String(file.executed)}/${String(file.executable)} lines (${file.pct.toFixed(1)}%)`,
    );
  }
  if (projected.outOfScope.length > 0) {
    // Named, not counted: a source file the browser executed that the unit run
    // never saw usually means the suite talked to a server serving a different
    // checkout. That is invisible in every metric — the specs still pass and the
    // percentages still look right.
    log(
      `  WARNING: ${String(projected.outOfScope.length)} file(s) the browser covered are absent from the unit report —`,
    );
    log("  a server serving a different checkout is the usual cause:");
    for (const path of projected.outOfScope.slice(0, 10)) log(`    ${path}`);
  }
  if (projected.gains.length === 0) {
    log("  e2e raised no file above what the unit run already covers");
  } else {
    log("  raised by the browser run (statements/functions/branches):");
    for (const gain of projected.gains.slice(0, 15)) {
      log(
        `    ${gain.path}  +${String(gain.statements)}/+${String(gain.functions)}/+${String(gain.branches)}`,
      );
    }
  }
  log("");
  log(formatMetricsTable(summary));
  log("");
  log(`  report: ${MERGED_COVERAGE_DIR}/coverage-final.json`);

  const failures = thresholdFailures(summary.total, COVERAGE_THRESHOLDS);
  if (failures.length > 0) {
    log("");
    for (const failure of failures) {
      log(
        `ERROR: coverage for ${failure.metric} (${failure.pct.toFixed(2)}%, ` +
          `${String(failure.covered)}/${String(failure.total)}) does not meet threshold ` +
          `(${String(failure.threshold)}%) for the merged report`,
      );
    }
    process.exitCode = 1;
    return;
  }

  log("");
  log(
    `coverage: merged gate passed — all four metrics at or above ${String(COVERAGE_THRESHOLDS.lines)}%.`,
  );
}

await main();
