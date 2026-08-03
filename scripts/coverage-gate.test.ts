import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { CoverageMapData } from "istanbul-lib-coverage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COVERAGE_EXCLUDE,
  COVERAGE_INCLUDE,
  type CoverageMetric,
  E2E_COVERAGE_DIR,
  NODE_COVERAGE_DIR,
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
  resolveServedSource,
  rewriteEntrySources,
  SOURCE_MAP_PRAGMA,
  spanExecuted,
  summarize,
  thresholdFailures,
  toRepoRelative,
  workspaceOf,
  type ExecutedLines,
  type Metrics,
  type SourceLineCoverage,
} from "./coverage-gate.js";

const REPO_ROOT = "/repo";

function lineCoverage(
  lines: Record<string, number | string>,
  extras: Record<string, string> = {},
): SourceLineCoverage {
  return { lines, extras };
}

function inlineSourceMap(map: unknown): string {
  const encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64");
  return `${SOURCE_MAP_PRAGMA}data:application/json;base64,${encoded}`;
}

function decodeSources(source: string): unknown {
  const encoded = /base64,([A-Za-z0-9+/=]+)/.exec(source)?.[1] ?? "";
  return (JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as { sources: unknown })
    .sources;
}

describe("workspaceOf", () => {
  it("names the workspace a source file belongs to", () => {
    expect(workspaceOf("apps/ui/src/shell/theme.ts")).toBe("apps/ui");
    expect(workspaceOf("packages/contract/src/index.ts")).toBe("packages/contract");
    expect(workspaceOf("plugins/todos/src/index.ts")).toBe("plugins/todos");
  });

  it("puts anything outside a workspace in one bucket rather than inventing one", () => {
    expect(workspaceOf("scripts/merge-coverage.ts")).toBe(".");
    expect(workspaceOf("vitest.config.ts")).toBe(".");
    expect(workspaceOf("apps/ui")).toBe(".");
  });
});

describe("coverageScope", () => {
  const inScope = coverageScope(COVERAGE_INCLUDE, COVERAGE_EXCLUDE);

  it("accepts workspace sources", () => {
    expect(inScope("apps/ui/src/shell/theme.ts")).toBe(true);
    expect(inScope("packages/contract/src/schemas/doc.ts")).toBe(true);
    expect(inScope("plugins/todos/src/index.ts")).toBe(true);
  });

  it("applies the same exclusions the unit run applies", () => {
    expect(inScope("apps/ui/src/shell/theme.test.ts")).toBe(false);
    expect(inScope("apps/ui/src/shell/Theme.test.tsx")).toBe(false);
    expect(inScope("apps/cli/src/bin/corpus.ts")).toBe(false);
    expect(inScope("packages/contract/src/client/schema.generated.ts")).toBe(false);
  });

  /**
   * PLUGINS-002: a plugin's layout is its root (SPEC.md §10), so `plugins/*⁠/**`
   * swept in the compiled copy of source it had just measured the moment a
   * plugin was built. The **source** stays in scope — that is the gate
   * sprint-014 Adjudication 18 insists on — and only `dist/` and declaration
   * files, which have no runtime statements at all, drop out.
   */
  it("measures a plugin's source and not its build output", () => {
    expect(inScope("plugins/todos/items.ts")).toBe(true);
    expect(inScope("plugins/todos/ui/TodoListItem.tsx")).toBe(true);
    expect(inScope("plugins/todos/server/routes.ts")).toBe(true);
    expect(inScope("plugins/todos/cli/commands/add.ts")).toBe(true);

    expect(inScope("plugins/todos/dist/server/routes.js")).toBe(false);
    expect(inScope("plugins/todos/dist/items.d.ts")).toBe(false);
    expect(inScope("packages/kit/src/plugin/types.d.ts")).toBe(false);
    expect(inScope("plugins/_fixture/manifest.ts")).toBe(false);
  });

  it("rejects everything that is not a workspace source", () => {
    expect(inScope("scripts/merge-coverage.ts")).toBe(false);
    expect(inScope("apps/ui/dist/index.js")).toBe(false);
    expect(inScope("node_modules/react/index.js")).toBe(false);
    expect(inScope("localhost-5273/src/shell/Board.css")).toBe(false);
  });
});

describe("resolveServedSource", () => {
  it("reads a Vite-root-relative URL as a path inside that workspace", () => {
    expect(
      resolveServedSource(
        new URL("http://localhost:5273/src/shell/theme.ts"),
        "apps/ui",
        REPO_ROOT,
      ),
    ).toBe("apps/ui/src/shell/theme.ts");
  });

  it("reads a /@fs/ URL as the absolute path it names", () => {
    expect(
      resolveServedSource(
        new URL("http://localhost:5273/@fs/repo/packages/contract/src/client/index.ts"),
        "apps/ui",
        REPO_ROOT,
      ),
    ).toBe("packages/contract/src/client/index.ts");
  });

  it("refuses a /@fs/ URL that escapes the repository", () => {
    expect(
      resolveServedSource(
        new URL("http://localhost:5273/@fs/elsewhere/lib/index.js"),
        "apps/ui",
        REPO_ROOT,
      ),
    ).toBeNull();
  });

  it("refuses Vite's own virtual modules, which are no source file", () => {
    expect(
      resolveServedSource(new URL("http://localhost:5273/@vite/client"), "apps/ui", REPO_ROOT),
    ).toBeNull();
    expect(
      resolveServedSource(new URL("http://localhost:5273/@react-refresh"), "apps/ui", REPO_ROOT),
    ).toBeNull();
  });
});

describe("rewriteEntrySources", () => {
  it("turns Vite's bare source names into repo-relative paths", () => {
    const entry = {
      url: "http://localhost:5273/src/shell/theme.ts",
      source: `const a = 1;\n${inlineSourceMap({ version: 3, sources: ["theme.ts"], mappings: "" })}`,
    };

    const rewritten = rewriteEntrySources(entry, "apps/ui", REPO_ROOT);

    expect(decodeSources(rewritten.source ?? "")).toEqual(["apps/ui/src/shell/theme.ts"]);
  });

  it("follows a built artifact's source map back out of dist/ and into src/", () => {
    const entry = {
      url: "http://localhost:5273/@fs/repo/packages/contract/dist/client/index.js",
      source: `x\n${inlineSourceMap({
        version: 3,
        sources: ["../../src/client/index.ts"],
        mappings: "",
      })}`,
    };

    const rewritten = rewriteEntrySources(entry, "apps/ui", REPO_ROOT);

    expect(decodeSources(rewritten.source ?? "")).toEqual([
      "packages/contract/src/client/index.ts",
    ]);
  });

  it("drops a sourceRoot that would be prefixed onto the rewritten paths", () => {
    const entry = {
      url: "http://localhost:5273/src/main.tsx",
      source: `x\n${inlineSourceMap({
        version: 3,
        sourceRoot: "/somewhere",
        sources: ["main.tsx"],
        mappings: "",
      })}`,
    };

    const rewritten = rewriteEntrySources(entry, "apps/ui", REPO_ROOT);
    const decoded = JSON.parse(
      Buffer.from(
        /base64,([A-Za-z0-9+/=]+)/.exec(rewritten.source ?? "")?.[1] ?? "",
        "base64",
      ).toString("utf8"),
    ) as Record<string, unknown>;

    expect(decoded.sourceRoot).toBeUndefined();
    expect(decoded.sources).toEqual(["apps/ui/src/main.tsx"]);
  });

  it("leaves an entry with no inline map, no map sources or unreadable map untouched", () => {
    const plain = { url: "http://localhost:5273/", source: "<html></html>" };
    expect(rewriteEntrySources(plain, "apps/ui", REPO_ROOT)).toBe(plain);

    const noSources = {
      url: "http://localhost:5273/src/a.ts",
      source: `x\n${inlineSourceMap({ version: 3, mappings: "" })}`,
    };
    expect(rewriteEntrySources(noSources, "apps/ui", REPO_ROOT)).toBe(noSources);

    const noSource = { url: "http://localhost:5273/x.js" };
    expect(rewriteEntrySources(noSource, "apps/ui", REPO_ROOT)).toBe(noSource);
  });
});

describe("isRepoSourceEntry", () => {
  it("keeps repo sources and drops what Vite serves on its own behalf", () => {
    expect(isRepoSourceEntry({ url: "http://localhost:5273/src/main.tsx" })).toBe(true);
    expect(
      isRepoSourceEntry({ url: "http://localhost:5273/@fs/repo/packages/kit/dist/index.js" }),
    ).toBe(true);
    expect(
      isRepoSourceEntry({ url: "http://localhost:5273/node_modules/.vite/deps/react.js" }),
    ).toBe(false);
    expect(isRepoSourceEntry({ url: "http://localhost:5273/@vite/client" })).toBe(false);
    expect(isRepoSourceEntry({ url: "http://localhost:5273/@react-refresh" })).toBe(false);
  });
});

describe("reading the browser dumps", () => {
  let directory = "";

  function writeDump(name: string, contents: unknown): void {
    writeFileSync(resolve(directory, name), JSON.stringify(contents), "utf8");
  }

  beforeEach(() => {
    directory = mkdtempSync(resolve(tmpdir(), "corpus-coverage-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("lists only dump files, in a stable order", () => {
    writeDump("b.json", {});
    writeDump("a.json", {});
    writeFileSync(resolve(directory, "notes.txt"), "x", "utf8");

    expect(browserDumpNames(directory)).toEqual(["a.json", "b.json"]);
  });

  it("lists nothing for a directory that was never created", () => {
    expect(browserDumpNames(resolve(directory, "absent"))).toEqual([]);
  });

  it("merges in the order it is given", () => {
    writeDump("a.json", { root: "apps/ui", entries: [] });
    writeDump("b.json", { root: "apps/other", entries: [] });

    const roots = [...readBrowserDumps(directory, ["b.json", "a.json"])].map((dump) => dump.root);

    expect(roots).toEqual(["apps/other", "apps/ui"]);
  });

  // The defect INFRA-017 fixes: reading all of them up front held 2.2 GB of
  // dumps live for the length of the merge. A dump that does not exist when the
  // generator is created, and is read anyway, can only have been read on demand.
  it("reads one dump per pull rather than the whole directory up front", () => {
    writeDump("a.json", { root: "first", entries: [] });

    const roots: string[] = [];
    for (const dump of readBrowserDumps(directory, ["a.json", "b.json"])) {
      roots.push(dump.root);
      if (roots.length === 1) writeDump("b.json", { root: "written later", entries: [] });
    }

    expect(roots).toEqual(["first", "written later"]);
  });

  // Reading on demand widens the window in which the listing can go stale, and
  // an e2e run clearing the directory mid-merge is the way that happens.
  it("says what happened when a listed dump is gone by the time it is read", () => {
    writeDump("a.json", { root: "apps/ui", entries: [] });

    expect(() => {
      for (const dump of readBrowserDumps(directory, ["a.json", "vanished.json"])) {
        if (dump.root === "apps/ui") rmSync(resolve(directory, "vanished.json"), { force: true });
      }
    }).toThrow(/vanished\.json was listed for this merge but could not be read/);
  });

  it("names the offending file when a dump is not the shape this version writes", () => {
    writeDump("a.json", { root: "apps/ui", entries: [] });
    writeDump("b.json", { entries: [] });

    const roots: string[] = [];

    expect(() => {
      for (const dump of readBrowserDumps(directory, ["a.json", "b.json"])) roots.push(dump.root);
    }).toThrow(/b\.json is not a coverage dump this version writes/);
    // The dump before the bad one was delivered and merged: the failure is per
    // file, not "the whole directory failed to load".
    expect(roots).toEqual(["apps/ui"]);
  });
});

describe("spanExecuted", () => {
  it("credits a span whose every executable line was fully executed", () => {
    expect(spanExecuted(lineCoverage({ "10": 3, "11": 3, "12": 1 }), 10, 12)).toBe(true);
  });

  it("refuses a span containing an unexecuted line", () => {
    expect(spanExecuted(lineCoverage({ "10": 3, "11": 0, "12": 1 }), 10, 12)).toBe(false);
  });

  it("refuses a partially executed line, so an untaken branch arm earns nothing", () => {
    expect(spanExecuted(lineCoverage({ "19": "1/2" }), 19, 19)).toBe(false);
  });

  it("steps over blank, comment and ignored lines without crediting them", () => {
    const coverage = lineCoverage({ "10": 1, "13": 1 }, { "11": "b", "12": "c" });
    expect(spanExecuted(coverage, 10, 13)).toBe(true);
    expect(spanExecuted(coverage, 11, 12)).toBe(false);
  });

  it("refuses a line the browser never instrumented at all", () => {
    expect(spanExecuted(lineCoverage({ "10": 1 }), 10, 11)).toBe(false);
  });

  it("refuses a malformed span", () => {
    expect(spanExecuted(lineCoverage({ "10": 1 }), 11, 10)).toBe(false);
    expect(spanExecuted(lineCoverage({ "10": 1 }), Number.NaN, 10)).toBe(false);
  });
});

function unitData(): CoverageMapData {
  return {
    "apps/ui/src/a.ts": {
      path: "apps/ui/src/a.ts",
      statementMap: {
        "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        "1": { start: { line: 5, column: 0 }, end: { line: 5, column: 10 } },
      },
      s: { "0": 0, "1": 0 },
      fnMap: {
        "0": {
          name: "f",
          line: 1,
          decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
          loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
      },
      f: { "0": 0 },
      branchMap: {
        "0": {
          type: "if",
          line: 1,
          loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
          locations: [
            { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
            { start: { line: 1, column: 10 }, end: { line: 1, column: 10 } },
          ],
        },
      },
      b: { "0": [0, 0] },
    },
    "apps/server/src/never-loaded.ts": {
      path: "apps/server/src/never-loaded.ts",
      statementMap: {
        "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
      },
      s: { "0": 0 },
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
    },
  };
}

describe("projectExecutedLines", () => {
  const executed: ExecutedLines = new Map([
    ["apps/ui/src/a.ts", lineCoverage({ "1": 4, "5": 0 })],
    ["apps/ui/src/not-in-the-unit-report.ts", lineCoverage({ "1": 1 })],
  ]);

  it("credits statements, functions and real branch paths the browser executed", () => {
    const { data } = projectExecutedLines(unitData(), executed);
    const file = data["apps/ui/src/a.ts"];

    expect(file?.s).toEqual({ "0": 1, "1": 0 });
    expect(file?.f).toEqual({ "0": 1 });
    // The second location is zero-width — an implicit path, not executed code.
    expect(file?.b).toEqual({ "0": [1, 0] });
  });

  it("leaves the unit report's totals alone: only counts move, never the maps", () => {
    const before = unitData();
    const { data } = projectExecutedLines(before, executed);

    expect(Object.keys(data)).toEqual(Object.keys(before));
    expect(data["apps/ui/src/a.ts"]?.statementMap).toEqual(
      before["apps/ui/src/a.ts"]?.statementMap,
    );
    expect(data["apps/ui/src/a.ts"]?.branchMap).toEqual(before["apps/ui/src/a.ts"]?.branchMap);
  });

  it("does not mutate its input", () => {
    const before = unitData();
    projectExecutedLines(before, executed);
    expect(before["apps/ui/src/a.ts"]?.s).toEqual({ "0": 0, "1": 0 });
  });

  it("leaves a file no runner loaded present and at zero", () => {
    const { data } = projectExecutedLines(unitData(), executed);
    expect(data["apps/server/src/never-loaded.ts"]?.s).toEqual({ "0": 0 });
  });

  it("reports what it raised and what it could not place", () => {
    const { gains, outOfScope } = projectExecutedLines(unitData(), executed);

    expect(gains).toEqual([{ path: "apps/ui/src/a.ts", statements: 1, functions: 1, branches: 1 }]);
    expect(outOfScope).toEqual(["apps/ui/src/not-in-the-unit-report.ts"]);
  });

  it("reports no gain when the unit run already covered everything", () => {
    const already = unitData();
    const file = already["apps/ui/src/a.ts"];
    if (file !== undefined) {
      file.s = { "0": 1, "1": 1 };
      file.f = { "0": 1 };
      file.b = { "0": [1, 1] };
    }

    expect(projectExecutedLines(already, executed).gains).toEqual([]);
  });
});

describe("summarize", () => {
  it("splits the totals per workspace and rolls them into one", () => {
    const { data } = projectExecutedLines(unitData(), new Map());
    const summary = summarize(data, REPO_ROOT);

    expect([...summary.workspaces.keys()]).toEqual(["apps/server", "apps/ui"]);
    expect(summary.workspaces.get("apps/ui")?.statements.total).toBe(2);
    expect(summary.workspaces.get("apps/server")?.statements.total).toBe(1);
    expect(summary.total.statements).toEqual({ covered: 0, total: 3, pct: 0 });
  });

  it("counts the files it measured, which is what an empty scope has none of", () => {
    expect(summarize(unitData(), REPO_ROOT).files).toBe(2);
    expect(summarize({}, REPO_ROOT).files).toBe(0);
  });
});

describe("emptyScopeFailure", () => {
  it("fails a report of no files, which every threshold would otherwise clear", () => {
    const summary = summarize({}, REPO_ROOT);

    // The state this guards: nothing measured, and four vacuous 100%s.
    expect(summary.total.lines).toEqual({ covered: 0, total: 0, pct: 100 });
    expect(thresholdFailures(summary.total)).toEqual([]);

    const failure = emptyScopeFailure(summary);
    expect(failure).toContain("0 source files");
    for (const glob of COVERAGE_INCLUDE) expect(failure).toContain(glob);
    for (const glob of COVERAGE_EXCLUDE) expect(failure).toContain(glob);
    expect(failure).toContain("scripts/coverage-config.ts");
  });

  it("names the globs it was given rather than the configured ones", () => {
    const failure = emptyScopeFailure(summarize({}, REPO_ROOT), ["apps/*/srcc/**"], ["nothing/**"]);

    expect(failure).toContain("apps/*/srcc/**");
    expect(failure).toContain("nothing/**");
  });

  it("says nothing about a report that describes at least one file", () => {
    expect(emptyScopeFailure(summarize(unitData(), REPO_ROOT))).toBeNull();
  });
});

describe("thresholdFailures", () => {
  const metrics = (values: Partial<Record<CoverageMetric, number>>): Metrics => ({
    lines: { covered: 0, total: 100, pct: values.lines ?? 100 },
    statements: { covered: 0, total: 100, pct: values.statements ?? 100 },
    functions: { covered: 0, total: 100, pct: values.functions ?? 100 },
    branches: { covered: 0, total: 100, pct: values.branches ?? 100 },
  });

  it("reports nothing when every metric clears the bar", () => {
    expect(thresholdFailures(metrics({ branches: 90 }))).toEqual([]);
  });

  it("names each metric that falls short, with its number", () => {
    const failures = thresholdFailures(metrics({ branches: 89.99, functions: 12 }));

    expect(failures.map((failure) => failure.metric)).toEqual(["functions", "branches"]);
    expect(failures[1]).toMatchObject({ metric: "branches", pct: 89.99, threshold: 90 });
  });

  it("honours an explicit threshold set", () => {
    expect(
      thresholdFailures(metrics({ lines: 95 }), {
        lines: 96,
        statements: 0,
        functions: 0,
        branches: 0,
      }),
    ).toHaveLength(1);
  });
});

describe("attributionOf", () => {
  it("counts what the browser reached, treating a partial line as not reached", () => {
    expect(
      attributionOf("apps/ui/src/a.ts", lineCoverage({ "1": 2, "2": 0, "3": "1/2", "4": 9 })),
    ).toEqual({ path: "apps/ui/src/a.ts", executed: 2, executable: 4, pct: 50 });
  });

  it("calls a file with no executable lines fully attributed rather than dividing by zero", () => {
    expect(attributionOf("apps/ui/src/empty.ts", lineCoverage({})).pct).toBe(100);
  });
});

describe("formatMetricsTable", () => {
  it("shows every workspace and a total row", () => {
    const row: Metrics = {
      lines: { covered: 9, total: 10, pct: 90 },
      statements: { covered: 9, total: 10, pct: 90 },
      functions: { covered: 1, total: 1, pct: 100 },
      branches: { covered: 0, total: 0, pct: 100 },
    };

    const table = formatMetricsTable({
      total: row,
      workspaces: new Map([["apps/ui", row]]),
      files: 1,
    });

    expect(table).toContain("apps/ui");
    expect(table).toContain("ALL");
    expect(table).toContain("90.00% 9/10");
  });
});

describe("toRepoRelative", () => {
  it("produces POSIX repo-relative paths", () => {
    expect(toRepoRelative("/repo/apps/ui/src/a.ts", "/repo")).toBe("apps/ui/src/a.ts");
  });
});

describe("the e2e suite feeds the gate", () => {
  const e2eDirectory = resolve(import.meta.dirname, "../apps/ui/e2e");

  it("writes its dumps where the merge step reads them", () => {
    // The fixture cannot import this config (it runs under Playwright's loader,
    // outside the workspace graph), so the two literals are pinned here instead.
    const fixture = readFileSync(resolve(e2eDirectory, "coverage.ts"), "utf8");

    expect(fixture).toContain(`"${E2E_COVERAGE_DIR}"`);
    expect(fixture).toContain(`"${NODE_COVERAGE_DIR}"`);
  });

  it("has specs, all of which take `test` from the coverage fixture", () => {
    const specs = readdirSync(e2eDirectory).filter((name) => name.endsWith(".spec.ts"));

    // A spec importing `test` straight from `@playwright/test` passes, collects
    // nothing, and lowers the merged number for reasons no summary explains.
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const source = readFileSync(resolve(e2eDirectory, spec), "utf8");
      expect(source, spec).toMatch(/import\s*{[^}]*\btest\b[^}]*}\s*from\s*"\.\/coverage"/);
      expect(source, spec).not.toMatch(
        /import\s*{[^}]*\btest\b[^}]*}\s*from\s*"@playwright\/test"/,
      );
    }
  });
});

describe("the merged gate's runner", () => {
  it("runs the merge with heap headroom over V8's RAM-derived default", () => {
    // INFRA-017: the default old space on a 16 GB CI runner is ~4 GB, which the
    // merge reached and died on. The streaming reader is the fix; this is the
    // margin above it, and it is invisible from the script itself.
    const manifest = readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8");
    const { scripts } = JSON.parse(manifest) as { scripts: Record<string, string> };

    expect(scripts["coverage:merge"]).toContain("--max-old-space-size=");
  });
});
