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
  coverageScope,
  formatMetricsTable,
  projectExecutedLines,
  rewriteEntrySources,
  summarize,
  thresholdFailures,
  toRepoRelative,
  type ExecutedLines,
  type SourceLineCoverage,
  type V8Entry,
} from "./coverage-gate.js";

/**
 * The combined coverage gate (INFRA-004). Reads the unit run's istanbul output
 * and the e2e run's raw V8 output, merges them, writes one report and enforces
 * the 90% thresholds — the only place in the repo that enforces them.
 *
 *     npm run coverage        # unit → e2e → merge → gate
 *     npx tsx scripts/merge-coverage.ts   # merge → gate, on existing output
 */

const repoRoot = resolve(import.meta.dirname, "..");
function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

interface E2EDump {
  root: string;
  entries: V8Entry[];
}

function readBrowserEntries(directory: string): E2EDump[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const dump = JSON.parse(readFileSync(resolve(directory, name), "utf8")) as Partial<E2EDump>;
      if (typeof dump.root !== "string" || !Array.isArray(dump.entries)) {
        throw new Error(
          `${E2E_COVERAGE_DIR}/${name} is not a coverage dump this version writes. ` +
            "Re-run `npm run e2e` — its global setup clears the directory.",
        );
      }
      return { root: dump.root, entries: dump.entries };
    });
}

/**
 * Runs the raw V8 data through `monocart-coverage-reports`, which unpacks each
 * entry through its source map and reports per-source line hits. The `none`
 * reporter is deliberate: the merged istanbul report below is the artifact, and
 * a second on-disk report would be a second answer to the same question.
 */
async function executedLines(browser: E2EDump[], nodeDirectory: string): Promise<ExecutedLines> {
  const inScope = coverageScope(COVERAGE_INCLUDE, COVERAGE_EXCLUDE);
  const report = new CoverageReport({
    logging: "error",
    reports: ["none"],
    outputDir: resolve(repoRoot, MERGED_COVERAGE_DIR, "v8-cache"),
    baseDir: repoRoot,
    // Vite's own client, HMR runtime and prebundled deps are not repo sources;
    // dropping them here saves unpacking megabytes of source maps that
    // `sourceFilter` would discard anyway.
    entryFilter: (entry: { url: string }) =>
      !entry.url.includes("/node_modules/") &&
      !entry.url.includes("/@vite/") &&
      !entry.url.includes("/@react-refresh"),
    sourceFilter: inScope,
    clean: true,
    cleanCache: true,
  });

  for (const dump of browser) {
    // A test that never navigated to the app produces an empty entry list, which
    // the reporter rejects outright rather than treating as "nothing to add".
    if (dump.entries.length === 0) continue;
    await report.add(dump.entries.map((entry) => rewriteEntrySources(entry, dump.root, repoRoot)));
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
  const browser = readBrowserEntries(browserDirectory);
  if (browser.length === 0) {
    log(`coverage: no browser coverage in ${E2E_COVERAGE_DIR}.`);
    log("coverage: run `npm run e2e` first, or use `npm run coverage`.");
    process.exitCode = 1;
    return;
  }

  const nodeDirectory = resolve(repoRoot, NODE_COVERAGE_DIR);
  const nodeDumps = countDumps(nodeDirectory);

  const lines = await executedLines(browser, nodeDirectory);
  const projected = projectExecutedLines(unit, lines);

  const summary = summarize(projected.data, repoRoot);

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
      `${String(browser.length)} browser dumps from ${E2E_COVERAGE_DIR}, ` +
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
