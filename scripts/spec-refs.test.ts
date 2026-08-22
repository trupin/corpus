/**
 * **Citations of sections SPEC.md does not have are assembled from {@link SIGN}
 * rather than written literally.** This file sits inside the tree
 * `checkSpecReferences` walks, and the check takes no exemption for its own
 * source or its own tests: a checker that excludes itself is not a checker. So
 * the missing 9.4 this file reproduces is spelled `${SIGN}9.4`, while citations
 * that name a section SPEC.md really has (`§9.2`) are written normally.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkSpecReferences,
  compareSections,
  describeFinding,
  EXCLUDED_PATHS,
  extractSpecSections,
  findCitations,
  FOREIGN_DOCUMENTS,
  isExcluded,
  isText,
  neighbourhood,
  scanCitations,
  SPEC_PATH,
} from "./spec-refs.js";

const SIGN = "§";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * The three paths the missing section 9.4 actually lived at, per SHARED-046.
 * Used both to seed the historical reproduction and to assert that no exclusion
 * spares them — an exclusion list that quietly covered any of these would make
 * the whole check pass vacuously, which is the one outcome worse than not having
 * it.
 */
const HISTORICAL_PATHS = [
  SPEC_PATH,
  "packages/contract/src/schemas/key.ts",
  "apps/server/src/edit/sessions.ts",
] as const;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway repository root containing exactly the given files. */
function fixture(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), "spec-refs-"));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

/** SPEC.md's real §9 shape, which is what the historical citation got wrong. */
const SPEC_FIXTURE = [
  "# Corpus — Specification",
  "",
  "## 7. Event queue and agent loop",
  "",
  "## 9. Server",
  "",
  "### 9.1 Projection (SQLite)",
  "",
  "### 9.2 HTTP API",
  "",
  "Every route is defined in `packages/contract` (§9.3).",
  "",
  "### 9.3 Contract-first (`packages/contract`)",
  "",
].join("\n");

describe("extractSpecSections", () => {
  it("reads numbered headings at every level, with or without a trailing dot", () => {
    expect([...extractSpecSections(SPEC_FIXTURE)].sort(compareSections)).toEqual([
      "7",
      "9",
      "9.1",
      "9.2",
      "9.3",
    ]);
  });

  it("ignores headings that carry no number", () => {
    expect([...extractSpecSections("# Corpus — Specification\n## Appendix\n")]).toEqual([]);
  });

  it.each([
    ["backticks", "```"],
    ["tildes", "~~~"],
  ])("ignores a numbered heading inside a fenced block (%s)", (_name, fence) => {
    const markdown = ["## 9. Server", "", fence, "## 9.4 Invalidate keys", fence, ""].join("\n");
    // The point of the fence handling: a fenced example must not mint a section
    // and then certify citations to it.
    expect([...extractSpecSections(markdown)]).toEqual(["9"]);
  });

  it("does not synthesise a parent from its subsections", () => {
    expect([...extractSpecSections("### 4.1 Something\n")]).toEqual(["4.1"]);
  });
});

describe("findCitations", () => {
  it.each([
    ["bare whole-section", "see §7 for the queue", "7"],
    ["subsection", "the ordinary invalidate keys (§9.2)", "9.2"],
    ["spaced", "per § 9.2 the server answers", "9.2"],
    ["backticked", "the `§9.2` bullets", "9.2"],
    ["possessive", "§9.2's SSE bullet", "9.2"],
    ["sentence-final", "This is settled in §9.2.", "9.2"],
  ])("matches the %s spelling", (_name, line, section) => {
    expect(findCitations("a.ts", line).map((citation) => citation.section)).toEqual([section]);
  });

  it("reports every citation on a line, with 1-based line numbers", () => {
    const citations = findCitations("a.ts", "nothing here\n§7 and §9.2 and §10\n");
    expect(citations.map((citation) => [citation.line, citation.section])).toEqual([
      [2, "7"],
      [2, "9.2"],
      [2, "11"],
    ]);
  });

  it.each(FOREIGN_DOCUMENTS)("does not claim a citation attributed to %s", (document) => {
    expect(findCitations("a.ts", `as ${document} ${SIGN}5.3 requires`)).toEqual([]);
  });

  it("claims an unattributed citation on a line that mentions another document elsewhere", () => {
    // Attribution is same-line and immediately before the mark, deliberately: a
    // window over the surrounding prose would silence real SPEC citations that
    // merely follow a mention of CommonMark.
    const citations = findCitations("a.ts", "CommonMark aside, the rule is §9.2 and only that");
    expect(citations.map((citation) => citation.section)).toEqual(["9.2"]);
  });

  it("reports a citation inside a fenced code block", () => {
    // Deliberate: a citation quoted in an example is still read as a citation by
    // whoever copies the example, which is precisely how the historical one
    // spread.
    const citations = findCitations("a.md", `\`\`\`\nError: see ${SIGN}9.4\n\`\`\`\n`);
    expect(citations.map((citation) => citation.section)).toEqual(["9.4"]);
  });

  it("carries an excerpt of the citing line", () => {
    const citations = findCitations("a.ts", " * the ordinary invalidate keys (§9.2), as ever");
    expect(citations[0]?.excerpt).toBe("* the ordinary invalidate keys (§9.2), as ever");
  });
});

describe("isExcluded", () => {
  it("spares the issue tracker at the repo root", () => {
    expect(isExcluded("issues/shared/046-spec-cites-a-section-that-does-not-exist.md")).toBe(true);
    expect(isExcluded("issues/PLAN.md")).toBe(true);
  });

  it("is anchored, so a nested directory of the same name stays covered", () => {
    // The pack audit learned this one the hard way: an unanchored `**/data/**`
    // would have forbidden the workspace template's own `data/`.
    expect(isExcluded("apps/server/src/issues/reporter.ts")).toBe(false);
    expect(isExcluded("plugins/todos/issues.ts")).toBe(false);
  });

  it("spares the generated artefacts, which inherit their citations from source", () => {
    expect(isExcluded("packages/contract/openapi.json")).toBe(true);
    expect(isExcluded("packages/contract/src/client/schema.generated.ts")).toBe(true);
    expect(isExcluded("docs/cli.md")).toBe(true);
  });

  it("spares no path the historical citation lived at", () => {
    for (const path of HISTORICAL_PATHS) expect(isExcluded(path)).toBe(false);
  });

  it("spares neither the check's own source nor its own tests", () => {
    expect(isExcluded("scripts/spec-refs.ts")).toBe(false);
    expect(isExcluded("scripts/spec-refs.test.ts")).toBe(false);
    expect(isExcluded("scripts/check-spec-refs.ts")).toBe(false);
  });

  it("excludes only anchored paths, never patterns", () => {
    for (const excluded of EXCLUDED_PATHS) {
      expect(excluded.path).not.toMatch(/[*?[\]]/);
      expect(excluded.path.startsWith("/")).toBe(false);
      expect(excluded.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("isText", () => {
  it("accepts source that carries a NUL in a template literal", () => {
    // apps/server/src/watcher/self-writes.ts does exactly this, and the NUL
    // sniff this replaced dropped it from the scan.
    expect(isText(Buffer.from("const key = `${path}\u0000${digest}`;\n", "utf8"))).toBe(true);
  });

  it("rejects bytes that are not valid UTF-8", () => {
    expect(isText(Uint8Array.from([0x1f, 0x8b, 0x08, 0xff, 0xfe, 0xfd]))).toBe(false);
  });
});

describe("scanCitations", () => {
  it("walks the tree, skipping build output and excluded paths", () => {
    const root = fixture({
      "SPEC.md": SPEC_FIXTURE,
      "apps/server/src/app.ts": "// §9.2\n",
      "node_modules/pkg/readme.md": `${SIGN}4.9.1\n`,
      "apps/server/dist/app.js": "// §9.2\n",
      "issues/shared/046.md": `cites ${SIGN}9.4, which does not exist\n`,
      "docs/cli.md": `${SIGN}9.4\n`,
    });
    const scan = scanCitations(root);
    expect(scan.citations.map((citation) => citation.path).sort()).toEqual([
      "SPEC.md",
      "apps/server/src/app.ts",
    ]);
    expect(scan.filesScanned).toBe(2);
  });

  it("reports a file it could not read as text rather than dropping it silently", () => {
    const root = fixture({
      "SPEC.md": SPEC_FIXTURE,
      "corpus-0.0.0.tgz": Uint8Array.from([0x1f, 0x8b, 0x08, 0xff, 0xfe]),
    });
    expect(scanCitations(root).filesSkipped).toEqual([
      { path: "corpus-0.0.0.tgz", reason: "not-utf8" },
    ]);
  });

  it("uses POSIX repo-relative paths", () => {
    const root = fixture({ "SPEC.md": SPEC_FIXTURE, "a/b/c.ts": "// §7\n" });
    expect(scanCitations(root).citations.map((citation) => citation.path)).toContain("a/b/c.ts");
  });
});

describe("the historical missing 9.4 (SHARED-046)", () => {
  /**
   * The reproduction the guard was filed for: seed the missing section at the
   * three paths it actually lived at and require all three to be named. A check
   * that only passes on a clean tree proves nothing about what it would catch.
   */
  it("reports all three of the paths it actually reached", () => {
    const root = fixture({
      [SPEC_PATH]: `${SPEC_FIXTURE}\nA scoped idle is parked on it, behind the ordinary invalidate keys (${SIGN}9.4).\n`,
      "packages/contract/src/schemas/key.ts": `  "agent's writes land live (SPEC.md ${SIGN}9.4). Neither is a lock in the other direction",\n`,
      "apps/server/src/edit/sessions.ts": ` * The projection is invalidated with the ordinary keys (${SIGN}9.4), never pushed.\n`,
    });

    const report = checkSpecReferences(root);

    expect(report.findings.map((finding) => finding.path).sort()).toEqual(
      [...HISTORICAL_PATHS].sort(),
    );
    expect(report.findings.every((finding) => finding.section === "9.4")).toBe(true);
    // One valid citation rides in SPEC_FIXTURE, so this also proves the check
    // read the whole of each file rather than stopping at the first mark.
    expect(report.citationsChecked).toBe(4);
  });

  it("names the file, the line and the subsections §9 does have", () => {
    const root = fixture({
      [SPEC_PATH]: SPEC_FIXTURE,
      "packages/contract/src/schemas/key.ts": `// one\n// the ordinary invalidate keys (${SIGN}9.4)\n`,
    });
    const report = checkSpecReferences(root);
    const [finding] = report.findings;
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    expect(describeFinding(finding, new Set(report.sections))).toContain(
      `packages/contract/src/schemas/key.ts:2 cites ${SIGN}9.4 — §9 has §9.1, §9.2, §9.3`,
    );
  });

  it("passes once the citations are repointed at a section that exists", () => {
    const root = fixture({
      [SPEC_PATH]: `${SPEC_FIXTURE}\nbehind the ordinary invalidate keys (§9.2).\n`,
      "packages/contract/src/schemas/key.ts": "// (SPEC.md §9.2)\n",
      "apps/server/src/edit/sessions.ts": "// (§9.2)\n",
    });
    const report = checkSpecReferences(root);
    expect(report.findings).toEqual([]);
    expect(report.citationsChecked).toBe(4);
  });
});

describe("describeFinding", () => {
  const sections = extractSpecSections(SPEC_FIXTURE);

  it("names the top-level sections for a bad whole-section citation", () => {
    const [finding] = findCitations("a.ts", `see ${SIGN}17`);
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    expect(describeFinding(finding, sections)).toContain("SPEC.md has §7, §9");
  });

  it("says so when the cited parent does not exist either", () => {
    const [finding] = findCitations("a.ts", `see ${SIGN}12.4`);
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    expect(describeFinding(finding, sections)).toContain("there is no §12 either");
  });

  it("says so when the parent exists but has no subsections", () => {
    const [finding] = findCitations("a.ts", `see ${SIGN}7.1`);
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    expect(describeFinding(finding, sections)).toContain("§7 has no subsections");
  });
});

describe("neighbourhood", () => {
  const sections = extractSpecSections(SPEC_FIXTURE);

  it("lists the siblings of a subsection", () => {
    expect(neighbourhood("9.4", sections)).toEqual(["9.1", "9.2", "9.3"]);
  });

  it("lists top-level sections for a top-level citation", () => {
    expect(neighbourhood("17", sections)).toEqual(["7", "9"]);
  });
});

describe("compareSections", () => {
  it("orders numerically, not lexically", () => {
    expect(["10", "9", "2.10", "2.2", "9.1"].sort(compareSections)).toEqual([
      "2.2",
      "2.10",
      "9",
      "9.1",
      "10",
    ]);
  });
});

describe("the repository as it stands", () => {
  const report = checkSpecReferences(REPO_ROOT);

  it("has no citation naming a section SPEC.md does not have", () => {
    expect(
      report.findings.map((finding) => describeFinding(finding, new Set(report.sections))),
    ).toEqual([]);
  });

  /**
   * The anti-vacuity assertion. A pass means nothing unless the run actually
   * read the places the defect reached — an over-broad exclusion would produce
   * the identical green line.
   */
  it("read SPEC.md, both source paths the defect reached, and the design mockup", () => {
    const scanned = new Set(scanCitations(REPO_ROOT).citations.map((citation) => citation.path));
    for (const path of HISTORICAL_PATHS) expect(scanned).toContain(path);
    // design/index.html carried a citation of the missing 9.4 that SHARED-046's
    // sweep missed entirely, and this check found it. Nothing may quietly stop
    // reading it.
    expect(scanned).toContain("design/index.html");
  });

  it("checks the whole spec, not a fragment of it", () => {
    expect(report.sections).toContain("9.3");
    expect(report.sections.length).toBeGreaterThan(10);
  });
});
