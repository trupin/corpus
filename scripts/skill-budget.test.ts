import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessBudget,
  BYTES_PER_TOKEN,
  enumerateTrackedFiles,
  ERROR_BUDGET_TOKENS,
  formatReport,
  isSubjectPath,
  referencesOf,
  tokensOf,
  updateBaseline,
  WARN_BUDGET_TOKENS,
  type BudgetInput,
  type MeasuredFile,
} from "./skill-budget.js";

const SKILL = "assets/workspace/claude/skills/demo/SKILL.md";
const AGENT = ".claude/agents/demo-dev.md";

function readerOf(sizes: Readonly<Record<string, number | "invalid">>): BudgetInput["read"] {
  return (path): MeasuredFile | null => {
    const size = sizes[path];
    if (size === undefined) return null;
    if (size === "invalid") return { bytes: 10, validUtf8: false };
    return { bytes: size, validUtf8: true };
  };
}

function input(
  overrides: Partial<BudgetInput> & Pick<BudgetInput, "subjects" | "read">,
): BudgetInput {
  return { allPaths: overrides.subjects, baseline: {}, ...overrides };
}

describe("scope", () => {
  it.each([
    [SKILL, true],
    [".claude/skills/lint/SKILL.md", true],
    [AGENT, true],
    ["assets/workspace/claude/skills/demo/references/notes.md", false],
    ["assets/workspace/claude/skills/asd-ste100/PROVENANCE.md", false],
    ["docs/TS_GUIDELINES.md", false],
    ["CLAUDE.md", false],
    ["assets/workspace/claude/skills/demo/examples/one.md", false],
  ])("%s in scope: %s", (path, expected) => {
    expect(isSubjectPath(path)).toBe(expected);
  });

  it("finds a skill's references and nothing else's", () => {
    const all = [
      SKILL,
      "assets/workspace/claude/skills/demo/references/a.md",
      "assets/workspace/claude/skills/demo/references/b.md",
      "assets/workspace/claude/skills/other/references/c.md",
      AGENT,
    ];
    expect(referencesOf(SKILL, all)).toEqual([
      "assets/workspace/claude/skills/demo/references/a.md",
      "assets/workspace/claude/skills/demo/references/b.md",
    ]);
    expect(referencesOf(AGENT, all)).toEqual([]);
  });
});

describe("tokensOf", () => {
  it("is bytes divided by the declared ratio, rounded", () => {
    expect(tokensOf(0)).toBe(0);
    expect(tokensOf(4 * 1234)).toBe(1234);
    expect(tokensOf(6)).toBe(Math.round(6 / BYTES_PER_TOKEN));
  });
});

describe("verdicts without a baseline entry", () => {
  it.each([
    ["under budget", WARN_BUDGET_TOKENS * BYTES_PER_TOKEN, "ok", 0],
    ["over warn", (WARN_BUDGET_TOKENS + 1) * BYTES_PER_TOKEN, "warn", 0],
    ["over error", (ERROR_BUDGET_TOKENS + 1) * BYTES_PER_TOKEN, "error", 1],
  ])("%s", (_name, bytes, verdict, exitCode) => {
    const report = assessBudget(input({ subjects: [SKILL], read: readerOf({ [SKILL]: bytes }) }));
    expect(report.subjects[0]?.verdict).toBe(verdict);
    expect(report.exitCode).toBe(exitCode);
  });
});

describe("the ratchet", () => {
  const entry = ERROR_BUDGET_TOKENS + 500;
  const baseline = { [SKILL]: entry };

  it("errors when a grandfathered file grew, naming both sizes and the split options", () => {
    const report = assessBudget(
      input({
        subjects: [SKILL],
        read: readerOf({ [SKILL]: (entry + 10) * BYTES_PER_TOKEN }),
        baseline,
      }),
    );
    expect(report.subjects[0]?.verdict).toBe("error");
    expect(report.exitCode).toBe(1);
    const lines = formatReport(report).join("\n");
    expect(lines).toContain(SKILL);
    expect(lines).toContain(String(entry));
    expect(lines).toContain(String(entry + 10));
    expect(lines).toContain("separate skill");
    expect(lines).toContain("references/");
  });

  it("warns while a grandfathered file holds its size", () => {
    const report = assessBudget(
      input({ subjects: [SKILL], read: readerOf({ [SKILL]: entry * BYTES_PER_TOKEN }), baseline }),
    );
    expect(report.subjects[0]?.verdict).toBe("warn");
    expect(report.exitCode).toBe(0);
  });

  it("errors a shrink whose baseline was not lowered, so the gain gets locked in", () => {
    const report = assessBudget(
      input({
        subjects: [SKILL],
        read: readerOf({ [SKILL]: (entry - 100) * BYTES_PER_TOKEN }),
        baseline,
      }),
    );
    expect(report.subjects[0]?.verdict).toBe("error");
    expect(report.subjects[0]?.reason).toContain("--update-baseline");
  });
});

describe("references and the anti-gaming sum", () => {
  it("reports each reference and the total with the subject", () => {
    const reference = "assets/workspace/claude/skills/demo/references/deep.md";
    const report = assessBudget({
      allPaths: [SKILL, reference],
      subjects: [SKILL],
      read: readerOf({ [SKILL]: 4000, [reference]: 8000 }),
      baseline: {},
    });
    const subject = report.subjects[0];
    expect(subject?.references).toEqual([{ path: reference, bytes: 8000, tokens: 2000 }]);
    expect(subject?.totalTokens).toBe(1000 + 2000);
    expect(formatReport(report).join("\n")).toContain("total with references ≈ 3000");
  });
});

describe("failure modes that must not read as passing", () => {
  it("errors a file that cannot be read", () => {
    const report = assessBudget(input({ subjects: [SKILL], read: readerOf({}) }));
    expect(report.subjects[0]?.verdict).toBe("error");
    expect(report.exitCode).toBe(1);
  });

  it("errors a file that is not valid UTF-8", () => {
    const report = assessBudget(
      input({ subjects: [SKILL], read: readerOf({ [SKILL]: "invalid" }) }),
    );
    expect(report.subjects[0]?.verdict).toBe("error");
    expect(report.subjects[0]?.reason).toContain("UTF-8");
  });

  it("reports a baseline entry with no tracked file as stale without failing", () => {
    const report = assessBudget({
      allPaths: [SKILL],
      subjects: [SKILL],
      read: readerOf({ [SKILL]: 400 }),
      baseline: { ".claude/skills/gone/SKILL.md": 5000 },
    });
    expect(report.staleEntries).toEqual([".claude/skills/gone/SKILL.md"]);
    expect(report.exitCode).toBe(0);
    expect(formatReport(report).join("\n")).toContain("stale baseline entry");
  });
});

describe("updateBaseline is a ratchet", () => {
  it("lowers a shrunk entry and removes one within budget or untracked", () => {
    const { next, changes } = updateBaseline(
      { a: 6000, b: 5000, c: 7000 },
      { a: 5500, b: ERROR_BUDGET_TOKENS },
    );
    expect(next).toEqual({ a: 5500 });
    expect(changes).toHaveLength(3);
  });

  it("never raises an entry and never adds one", () => {
    const { next } = updateBaseline({ a: 5000 }, { a: 9000, newcomer: 9000 });
    expect(next).toEqual({ a: 5000 });
  });
});

describe("the real repository", () => {
  const repoRoot = resolve(import.meta.dirname, "..");

  it("enumerates via git, excludes gitignored trees, and produces a verdict per subject", () => {
    const allPaths = enumerateTrackedFiles(repoRoot);
    expect(allPaths.length).toBeGreaterThan(0);
    expect(allPaths.some((path) => path.includes(".claude/worktrees/"))).toBe(false);
    const subjects = allPaths.filter(isSubjectPath);
    // The two trees the issue names are both represented.
    expect(subjects.some((path) => path.startsWith("assets/workspace/claude/skills/"))).toBe(true);
    expect(subjects.some((path) => path.startsWith(".claude/agents/"))).toBe(true);
    expect(subjects.some((path) => path.startsWith(".claude/skills/"))).toBe(true);
    // Only that the check runs and reaches a verdict for every subject —
    // never what the verdict is, so editing a skill cannot break this test.
    const report = assessBudget({
      allPaths,
      subjects,
      read: (path) => {
        // Real bytes are not needed to prove coverage; a fixed size keeps the
        // test independent of the tree's actual file sizes.
        void path;
        return { bytes: 100, validUtf8: true };
      },
      baseline: {},
    });
    expect(report.subjects).toHaveLength(subjects.length);
    expect(report.subjects.every((subject) => subject.verdict === "ok")).toBe(true);
  });
});
