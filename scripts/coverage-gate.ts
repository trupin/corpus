import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { CoverageMapData, Range } from "istanbul-lib-coverage";
import picomatch from "picomatch";
import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  COVERAGE_METRICS,
  type CoverageMetric,
  COVERAGE_THRESHOLDS,
} from "./coverage-config.js";

/**
 * The merge behind `npm run coverage` (INFRA-004).
 *
 * Two producers describe the same source files and they do not agree on where a
 * statement starts: Vitest's v8 provider derives an istanbul map from the module
 * graph it transformed, while a browser run is V8 byte ranges unpacked through
 * Vite's dev source maps. Merging those two istanbul maps with
 * `CoverageMap.merge` keys statements by location, so the disagreement shows up
 * as *extra* statements rather than as shared hits — measured on this repo it
 * moved statements from 15856 to 16250 and dropped the percentage. A gate that
 * falls when you add coverage is worse than no gate.
 *
 * So the unit run's istanbul map is the structure, and the browser run
 * contributes hits onto it: an item is credited to the browser when every line
 * it spans was fully executed there. Consequences, all deliberate:
 *
 *  - totals never move, so the file universe stays the unit run's include-based
 *    one and a file no runner loaded still reports 0%;
 *  - coverage can only rise, so e2e can never make the bar harder to clear;
 *  - a partially executed line (`"1/2"` in V8 terms) credits nothing, so an
 *    untaken ternary arm or a short-circuited `&&` is not counted as covered.
 */

// `istanbul-lib-coverage` is CommonJS with no named ESM exports for Node to
// detect. One interop site, here, rather than one per consumer.
const { createCoverageMap } = createRequire(import.meta.url)(
  "istanbul-lib-coverage",
) as typeof import("istanbul-lib-coverage");

/** Per-source line data as `monocart-coverage-reports` reports it for V8 input. */
export interface SourceLineCoverage {
  /** Line number → hit count, or `"1/2"`-style string when partially executed. */
  lines: Record<string, number | string>;
  /** Line number → `b`lank, `c`omment or `i`gnored. Not executable, so neutral. */
  extras: Record<string, string>;
}

export type ExecutedLines = ReadonlyMap<string, SourceLineCoverage>;

export interface MetricTotals {
  covered: number;
  total: number;
  pct: number;
}

export type Metrics = Record<CoverageMetric, MetricTotals>;

export interface ProjectionGain {
  path: string;
  statements: number;
  functions: number;
  branches: number;
}

export interface ProjectionResult {
  data: CoverageMapData;
  /** Files whose coverage the browser run raised, largest gain first. */
  gains: ProjectionGain[];
  /** Files the browser covered that the unit run's include globs do not name. */
  outOfScope: string[];
}

/** `apps/ui/src/shell/theme.ts` → `apps/ui`; anything shallower → `.`. */
export function workspaceOf(repoRelativePath: string): string {
  const parts = repoRelativePath.split("/");
  const [group, name] = parts;
  if (parts.length < 3 || group === undefined || name === undefined) return ".";
  if (group !== "apps" && group !== "packages") return ".";
  return `${group}/${name}`;
}

export function toRepoRelative(absolutePath: string, repoRoot: string): string {
  return relative(repoRoot, absolutePath).split(sep).join("/");
}

/**
 * Resolves a source-map `sources` entry, seen from a dev-server URL, to a
 * repo-relative path. Vite serves the Vite root at `/` and everything outside it
 * under `/@fs/<absolute path>`; its own virtual modules (`/@vite/client`,
 * `/@react-refresh`) belong to no source file at all.
 */
export function resolveServedSource(
  sourceUrl: URL,
  viteRoot: string,
  repoRoot: string,
): string | null {
  const path = sourceUrl.pathname;
  if (path.startsWith("/@fs/")) {
    const candidate = toRepoRelative(path.slice("/@fs".length), repoRoot);
    return candidate.startsWith("..") ? null : candidate;
  }
  if (path.startsWith("/@")) return null;
  return posix.join(viteRoot, path.replace(/^\/+/, ""));
}

/**
 * Assembled from pieces rather than written out: a literal inline-source-map
 * pragma anywhere in a source file makes Vite and Node try to load *this* file's
 * source map from whatever follows it, which is a warning on every load.
 */
export const SOURCE_MAP_PRAGMA = `//# ${"sourceMappingURL"}=`;

const INLINE_SOURCE_MAP = new RegExp(
  `${SOURCE_MAP_PRAGMA}data:application/json;(?:charset=[^;]+;)?base64,([A-Za-z0-9+/=]+)`,
);

export interface V8Entry {
  url: string;
  source?: string;
  [key: string]: unknown;
}

/**
 * Rewrites an entry's inline source map so its `sources` are repo-relative.
 * Vite's dev transform emits bare file names (`"App.tsx"`) and `../../src/...`
 * hops out of a `dist/`, neither of which survives being read outside the
 * browser: without this the merge attributes coverage to `App.tsx` and to
 * `localhost-5273/...`, which match no include glob and are silently dropped.
 */
export function rewriteEntrySources(entry: V8Entry, viteRoot: string, repoRoot: string): V8Entry {
  const { source } = entry;
  if (typeof source !== "string") return entry;
  const match = INLINE_SOURCE_MAP.exec(source);
  if (match === null) return entry;
  const [, encoded] = match;
  if (encoded === undefined) return entry;

  let map: { sources?: unknown; sourceRoot?: unknown };
  try {
    map = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as typeof map;
  } catch {
    return entry;
  }
  if (!Array.isArray(map.sources)) return entry;

  map.sources = map.sources.map((candidate: unknown) => {
    if (typeof candidate !== "string") return candidate;
    let resolved: URL;
    try {
      resolved = new URL(candidate, entry.url);
    } catch {
      return candidate;
    }
    return resolveServedSource(resolved, viteRoot, repoRoot) ?? candidate;
  });
  // `sources` are now repo-relative; a leftover root would be prefixed onto them.
  delete map.sourceRoot;

  const rewritten = Buffer.from(JSON.stringify(map), "utf8").toString("base64");
  return {
    ...entry,
    source: `${source.slice(0, match.index)}${SOURCE_MAP_PRAGMA}data:application/json;base64,${rewritten}`,
  };
}

/**
 * One browser dump, as the Playwright fixture in `apps/ui/e2e/coverage.ts`
 * writes it: the raw V8 entries of a single spec, plus the Vite root their URLs
 * are relative to (the merge cannot infer that from a URL alone).
 */
export interface E2EDump {
  root: string;
  entries: V8Entry[];
}

/**
 * Whether an entry can map back to a repo source file at all. Vite's own client,
 * its HMR runtime and its prebundled deps are not repo sources, and they are the
 * larger half of every dump: dropping them saves unpacking megabytes of source
 * maps that `sourceFilter` would discard anyway.
 *
 * Exported so the merge can apply it *before* building its rewritten copy of a
 * dump's entries, rather than only handing it to the reporter as `entryFilter` —
 * the same predicate in both places, so pre-filtering cannot change the result.
 */
export function isRepoSourceEntry(entry: { url: string }): boolean {
  return (
    !entry.url.includes("/node_modules/") &&
    !entry.url.includes("/@vite/") &&
    !entry.url.includes("/@react-refresh")
  );
}

/**
 * The dump files in a directory, in the order they are to be merged. Sorted
 * because the fixture names them by UUID: without it the merge order is
 * `readdir` order, which is neither stable nor reproducible across machines.
 */
export function browserDumpNames(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

/**
 * Parses the dumps one at a time (INFRA-017).
 *
 * A generator, not an array, and that is the whole point: one spec's dump is
 * ~9 MB of script text and source maps, a 237-spec suite writes 2.2 GB of them,
 * and the previous version parsed every one into a single array before the
 * consumer added the first to the reporter. That held the entire corpus live as
 * JS objects for the length of the merge — `CI / validate` died on it with
 * `Reached heap limit Allocation failed`. The consumer needs exactly one dump at
 * a time, so each is read on demand and is collectable as soon as the next is
 * pulled.
 *
 * The shape check is structural rather than a Zod parse on purpose: these
 * objects are megabytes of V8 byte ranges, and re-validating every range would
 * cost more time and more memory than the merge they feed.
 *
 * Reading on demand does mean the listing can go stale: the names are taken
 * once, the reads span the whole merge, and `npm run e2e`'s global setup empties
 * this directory. That surfaces as an unreadable file rather than a wrong
 * number, so it is reported as what it is instead of as a raw `fs` stack.
 */
export function* readBrowserDumps(
  directory: string,
  names: readonly string[],
): Generator<E2EDump, void, undefined> {
  for (const name of names) {
    const path = resolve(directory, name);

    let contents: string;
    try {
      contents = readFileSync(path, "utf8");
    } catch (cause) {
      throw new Error(
        `${path} was listed for this merge but could not be read. ` +
          "A concurrent `npm run e2e` empties this directory in its global setup — " +
          "re-run the merge once it has finished.",
        { cause },
      );
    }

    const dump = JSON.parse(contents) as Partial<E2EDump>;
    if (typeof dump.root !== "string" || !Array.isArray(dump.entries)) {
      throw new Error(
        `${path} is not a coverage dump this version writes. ` +
          "Re-run `npm run e2e` — its global setup clears the directory.",
      );
    }
    yield { root: dump.root, entries: dump.entries };
  }
}

/** The coverage scope, as the same globs the unit run is configured with. */
export function coverageScope(include: string[], exclude: string[]): (path: string) => boolean {
  const included = picomatch(include);
  const excluded = picomatch(exclude);
  return (path) => included(path) && !excluded(path);
}

/**
 * True when every line the span touches was fully executed. Blank, comment and
 * ignored lines carry no verdict and neither block nor grant coverage; a line
 * that is absent from both maps was never instrumented, so it cannot be claimed.
 */
export function spanExecuted(coverage: SourceLineCoverage, start: number, end: number): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return false;
  let executable = 0;
  for (let line = start; line <= end; line += 1) {
    const key = String(line);
    if (key in coverage.extras) continue;
    const hits = coverage.lines[key];
    if (typeof hits !== "number" || hits <= 0) return false;
    executable += 1;
  }
  return executable > 0;
}

export interface Attribution {
  path: string;
  executed: number;
  executable: number;
  pct: number;
}

/**
 * What the browser (or a `NODE_V8_COVERAGE` process) actually reached, per file,
 * before any merging. This is the number that distinguishes "e2e contributed
 * nothing because the unit run already covered it" from "e2e contributed nothing
 * because the source maps did not resolve" — two states every summary metric
 * renders identically.
 */
export function attributionOf(path: string, coverage: SourceLineCoverage): Attribution {
  const hits = Object.values(coverage.lines);
  const executed = hits.filter((count) => typeof count === "number" && count > 0).length;
  return { path, executed, executable: hits.length, pct: percent(executed, hits.length) };
}

function lineSpan(range: Range | undefined): [number, number] | null {
  if (range === undefined) return null;
  const { start, end } = range;
  if (typeof start.line !== "number" || typeof end.line !== "number") return null;
  return [start.line, end.line];
}

/** A zero-width location is an implicit path (an absent `else`), not real code. */
function isImplicitPath(range: Range): boolean {
  return (
    range.start.line === range.end.line &&
    range.start.column === range.end.column &&
    typeof range.start.column === "number"
  );
}

export function projectExecutedLines(
  unit: CoverageMapData,
  executed: ExecutedLines,
): ProjectionResult {
  const data: CoverageMapData = structuredClone(unit);
  const gains: ProjectionGain[] = [];
  const covered = new Set(Object.keys(data));

  for (const [path, file] of Object.entries(data)) {
    const lines = executed.get(path);
    if (lines === undefined) continue;

    const gain: ProjectionGain = { path, statements: 0, functions: 0, branches: 0 };

    for (const [index, hits] of Object.entries(file.s)) {
      if (hits > 0) continue;
      const span = lineSpan(file.statementMap[index]);
      if (span !== null && spanExecuted(lines, span[0], span[1])) {
        file.s[index] = 1;
        gain.statements += 1;
      }
    }

    // `loc` (the whole body), not `decl`: the declaration line of an uncalled
    // function can still be covered by an enclosing range, which would credit a
    // function that never ran. Requiring the whole body understates instead —
    // the safe direction for a gate.
    for (const [index, hits] of Object.entries(file.f)) {
      if (hits > 0) continue;
      const span = lineSpan(file.fnMap[index]?.loc);
      if (span !== null && spanExecuted(lines, span[0], span[1])) {
        file.f[index] = 1;
        gain.functions += 1;
      }
    }

    for (const [index, paths] of Object.entries(file.b)) {
      const locations = file.branchMap[index]?.locations ?? [];
      paths.forEach((hits, position) => {
        if (hits > 0) return;
        const location = locations[position];
        if (location === undefined || isImplicitPath(location)) return;
        const span = lineSpan(location);
        if (span !== null && spanExecuted(lines, span[0], span[1])) {
          paths[position] = 1;
          gain.branches += 1;
        }
      });
    }

    if (gain.statements + gain.functions + gain.branches > 0) gains.push(gain);
  }

  gains.sort(
    (a, b) =>
      b.statements + b.functions + b.branches - (a.statements + a.functions + a.branches) ||
      a.path.localeCompare(b.path),
  );

  return {
    data,
    gains,
    outOfScope: [...executed.keys()].filter((path) => !covered.has(path)).sort(),
  };
}

/**
 * Nothing to cover is fully covered — a file with no branches must not drag the
 * branch total to 0%. The cost is that an *empty* report clears every threshold,
 * which is why `emptyScopeFailure` guards the one place that could be empty for a
 * reason other than "there is genuinely nothing there" (INFRA-009).
 */
function percent(covered: number, total: number): number {
  return total === 0 ? 100 : (covered / total) * 100;
}

function emptyMetrics(): Metrics {
  return Object.fromEntries(
    COVERAGE_METRICS.map((metric) => [metric, { covered: 0, total: 0, pct: 100 }]),
  ) as Metrics;
}

function addInto(target: Metrics, metric: CoverageMetric, covered: number, total: number): void {
  const slot = target[metric];
  slot.covered += covered;
  slot.total += total;
  slot.pct = percent(slot.covered, slot.total);
}

export interface CoverageSummary {
  total: Metrics;
  workspaces: Map<string, Metrics>;
  /** How many source files the report describes. Zero is a configuration error. */
  files: number;
}

export function summarize(data: CoverageMapData, repoRoot: string): CoverageSummary {
  const map = createCoverageMap(data);
  const total = emptyMetrics();
  const workspaces = new Map<string, Metrics>();
  let files = 0;

  for (const absolute of map.files()) {
    files += 1;
    const path = isAbsolute(absolute) ? toRepoRelative(absolute, repoRoot) : absolute;
    const workspace = workspaceOf(path);
    const bucket = workspaces.get(workspace) ?? emptyMetrics();
    workspaces.set(workspace, bucket);

    const summary = map.fileCoverageFor(absolute).toSummary().toJSON();
    for (const metric of COVERAGE_METRICS) {
      const { covered, total: fileTotal } = summary[metric];
      addInto(total, metric, covered, fileTotal);
      addInto(bucket, metric, covered, fileTotal);
    }
  }

  return {
    total,
    workspaces: new Map([...workspaces].sort(([a], [b]) => a.localeCompare(b))),
    files,
  };
}

/**
 * The gate's sanity check on its own scope (INFRA-009).
 *
 * Every threshold is a percentage, and every percentage of nothing is 100 — so a
 * `COVERAGE_INCLUDE` typo, a renamed workspace, or a unit run whose report never
 * reached the merge all produce a report of zero files that clears a 90% bar
 * four times over. Measuring nothing is never a pass: it is the one outcome the
 * percentages cannot distinguish from perfection, so it is refused by counting
 * files instead, and the globs are named because they are what has to change.
 */
export function emptyScopeFailure(
  summary: CoverageSummary,
  include: readonly string[] = COVERAGE_INCLUDE,
  exclude: readonly string[] = COVERAGE_EXCLUDE,
): string | null {
  if (summary.files > 0) return null;
  return (
    "the merged report describes 0 source files, so every metric is a vacuous 100%. " +
    `Nothing matched the coverage scope — include [${include.join(", ")}] ` +
    `minus exclude [${exclude.join(", ")}]. ` +
    "Fix the globs in scripts/coverage-config.ts, or find out why the unit run covered nothing."
  );
}

export interface ThresholdFailure {
  metric: CoverageMetric;
  pct: number;
  threshold: number;
  covered: number;
  total: number;
}

export function thresholdFailures(
  metrics: Metrics,
  thresholds: Record<CoverageMetric, number> = COVERAGE_THRESHOLDS,
): ThresholdFailure[] {
  return COVERAGE_METRICS.flatMap((metric) => {
    const { pct, covered, total } = metrics[metric];
    const threshold = thresholds[metric];
    return pct < threshold ? [{ metric, pct, threshold, covered, total }] : [];
  });
}

export function formatMetricsTable(summary: CoverageSummary): string {
  const rows: [string, Metrics][] = [...summary.workspaces, ["ALL", summary.total]];
  const nameWidth = Math.max(...rows.map(([name]) => name.length), "workspace".length);
  const cell = (value: string): string => value.padStart(19);

  const header = `${"workspace".padEnd(nameWidth)} | ${COVERAGE_METRICS.map((m) => cell(m)).join(" | ")}`;
  const rule = "-".repeat(header.length);
  const body = rows.map(([name, metrics]) => {
    const cells = COVERAGE_METRICS.map((metric) => {
      const { pct, covered, total } = metrics[metric];
      return cell(`${pct.toFixed(2)}% ${covered}/${total}`);
    });
    return `${name.padEnd(nameWidth)} | ${cells.join(" | ")}`;
  });

  return [header, rule, ...body.slice(0, -1), rule, ...body.slice(-1)].join("\n");
}
