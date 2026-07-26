import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BITAP_PATTERN_LIMIT,
  CONTEXT_WINDOW,
  DIFF_TIMEOUT_SECONDS,
  FUZZY_THRESHOLD,
  MAX_FUZZY_CANDIDATES,
  MAX_FUZZY_EXACT_LENGTH,
  SHINGLE_LENGTH,
  boundedLevenshtein,
  computeContext,
  computeOffsetMapper,
  findFuzzyRange,
  isWellFormedText,
  reconcileAnchors,
  resolveAnchor,
  resolveAnchorExact,
  resolveAnchors,
  snapRange,
  splitsSurrogatePair,
} from "./index.js";

describe("public surface", () => {
  it("exports the engine functions", () => {
    for (const fn of [
      boundedLevenshtein,
      computeContext,
      computeOffsetMapper,
      findFuzzyRange,
      isWellFormedText,
      reconcileAnchors,
      resolveAnchor,
      resolveAnchorExact,
      resolveAnchors,
      snapRange,
      splitsSurrogatePair,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("exports the tuning constants tests and callers reference instead of magic numbers", () => {
    expect(CONTEXT_WINDOW).toBe(32);
    expect(FUZZY_THRESHOLD).toBe(0.75);
    expect(MAX_FUZZY_CANDIDATES).toBe(64);
    expect(MAX_FUZZY_EXACT_LENGTH).toBe(4096);
    expect(BITAP_PATTERN_LIMIT).toBe(32);
    expect(SHINGLE_LENGTH).toBeGreaterThan(0);
    expect(DIFF_TIMEOUT_SECONDS).toBeGreaterThan(0);
  });
});

describe("purity (§ TEST-28)", () => {
  const anchorsDir = fileURLToPath(new URL(".", import.meta.url));
  const sourceFiles = readdirSync(anchorsDir).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );

  const importSpecifiers = (source: string): string[] => {
    const pattern = /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm;
    const bare = /^\s*import\s+["']([^"']+)["']/gm;
    const specifiers: string[] = [];
    for (const match of source.matchAll(pattern))
      if (match[1] !== undefined) specifiers.push(match[1]);
    for (const match of source.matchAll(bare))
      if (match[1] !== undefined) specifiers.push(match[1]);
    return specifiers;
  };

  it("covers the whole module", () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(7);
  });

  it.each(sourceFiles)(
    "%s imports no filesystem, process, database, or server-core module",
    (name) => {
      const source = readFileSync(join(anchorsDir, name), "utf8");
      for (const specifier of importSpecifiers(source)) {
        const allowed =
          specifier.startsWith("./") ||
          specifier === "diff-match-patch" ||
          specifier === "@corpus/contract";
        expect(allowed, `${name} imports ${specifier}`).toBe(true);
        expect(specifier).not.toMatch(/^node:/);
        expect(specifier).not.toContain("better-sqlite3");
        expect(specifier).not.toMatch(/\.\.\/(core|projection|docs)/);
      }
    },
  );

  it.each(sourceFiles)("%s imports @corpus/contract only for types", (name) => {
    const source = readFileSync(join(anchorsDir, name), "utf8");
    for (const line of source.split("\n")) {
      if (line.includes(`"@corpus/contract"`)) {
        expect(line.trimStart().startsWith("import type ")).toBe(true);
      }
    }
  });

  it.each(sourceFiles)("%s performs no dynamic import or require", (name) => {
    const source = readFileSync(join(anchorsDir, name), "utf8");
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});
