import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import vitestConfig from "../vitest.config.js";
import {
  assessRun,
  formatAssessment,
  readDeclaredBudget,
  readVitestReport,
  shortLocation,
  SLOW_TEST_BUDGET_FRACTION,
  VITEST_DEFAULT_TIMEOUT_MS,
  type ReportedTest,
} from "./slow-tests.js";

const repoRoot = resolve(import.meta.dirname, "..");

/** The line a snippet's `it(` sits on, so each case states its own location. */
function budgetOf(snippet: string, line = 1): ReturnType<typeof readDeclaredBudget> {
  return readDeclaredBudget(snippet, line);
}

describe("VITEST_DEFAULT_TIMEOUT_MS is not allowed to become a lie", () => {
  it("matches the repository's Vitest config, which sets no testTimeout of its own", () => {
    // The constant is only correct while nothing overrides it. Read the config
    // rather than trusting the comment beside the constant.
    const configured = (vitestConfig as { test?: { testTimeout?: number } }).test?.testTimeout;
    expect(configured).toBeUndefined();
    expect(VITEST_DEFAULT_TIMEOUT_MS).toBe(5000);
  });

  it("is the only Vitest config in the repository, so no workspace can shadow it", () => {
    // A second config with its own testTimeout would make the default per-file
    // and silently wrong here. `apps/ui` is allowed a config only for jsdom.
    const uiConfig = resolve(repoRoot, "apps/ui/vitest.config.ts");
    let uiSource: string | undefined;
    try {
      uiSource = readFileSync(uiConfig, "utf8");
    } catch {
      uiSource = undefined;
    }
    if (uiSource !== undefined) expect(uiSource).not.toContain("testTimeout");
  });
});

describe("readDeclaredBudget — the underscore that broke the last sweep", () => {
  it("reads a trailing number literal written with a numeric separator", () => {
    // The exact miss recorded in SERVER-053: `[0-9]{4,}` does not match `20_000`.
    const source = `it("archives twenty documents", async () => {\n  await go();\n}, 20_000);`;
    expect(budgetOf(source)).toEqual({ origin: "declared", ms: 20_000 });
  });

  it("reads a trailing number literal written without one", () => {
    expect(budgetOf(`it("x", async () => {}, 30000);`)).toEqual({ origin: "declared", ms: 30000 });
  });

  it("reads the options-object form, which several files use instead", () => {
    expect(budgetOf(`it("x", { timeout: 20_000 }, async () => {});`)).toEqual({
      origin: "declared",
      ms: 20_000,
    });
  });

  it("reads a timeout that is not the first property of its options object", () => {
    expect(budgetOf(`it("x", { retry: 2, timeout: 15_000 }, async () => {});`)).toEqual({
      origin: "declared",
      ms: 15_000,
    });
  });

  it("reads the tagged it.each form, whose arguments live in the second call", () => {
    const source = [
      `it.each([`,
      `  ["a", 1],`,
      `  ["b", 2],`,
      `])("handles %s", async (_label, n) => {`,
      `  await go(n);`,
      `}, 25_000);`,
    ].join("\n");
    expect(budgetOf(source)).toEqual({ origin: "declared", ms: 25_000 });
  });

  it("reports the default for an it.each with no budget rather than misreading its table", () => {
    const source = [
      `it.each([`,
      `  ["an encoded dot segment", "%2e%2e"],`,
      `])("refuses %s", async (_label, segment) => {`,
      `  await go(segment);`,
      `});`,
    ].join("\n");
    expect(budgetOf(source)).toEqual({ origin: "default", ms: VITEST_DEFAULT_TIMEOUT_MS });
  });
});

describe("readDeclaredBudget — what must NOT be read as a budget", () => {
  it("ignores the word timeout inside the test body", () => {
    // The trap that makes a naive regex useless: bodies are full of the word.
    const source = [
      `it("waits", async () => {`,
      `  const timeout: number = 250;`,
      `  await withTimeout({ timeout: 999 });`,
      `});`,
    ].join("\n");
    expect(budgetOf(source)).toEqual({ origin: "default", ms: VITEST_DEFAULT_TIMEOUT_MS });
  });

  it("ignores a number inside the test name", () => {
    expect(budgetOf(`it("retries 30000 times", async () => {});`)).toEqual({
      origin: "default",
      ms: VITEST_DEFAULT_TIMEOUT_MS,
    });
  });

  it("ignores a brace, paren or comma inside a string in the arguments", () => {
    const source = `it("a name with ), { and , in it", async () => {}, 12_000);`;
    expect(budgetOf(source)).toEqual({ origin: "declared", ms: 12_000 });
  });

  it("ignores a brace inside a template literal interpolation", () => {
    const source = "it(`name ${JSON.stringify({ a: 1 })}`, async () => {}, 11_000);";
    expect(budgetOf(source)).toEqual({ origin: "declared", ms: 11_000 });
  });

  it("ignores a paren inside a comment between the arguments", () => {
    const source = [
      `it("x", async () => {`,
      `  // a comment with ) and { and , in it`,
      `  await go();`,
      `  /* and a block one ) too */`,
      `}, 9_000);`,
    ].join("\n");
    expect(budgetOf(source)).toEqual({ origin: "declared", ms: 9_000 });
  });
});

describe("readDeclaredBudget — an unparseable call is said to be unparseable", () => {
  it("reports a call that never closes rather than guessing at a budget", () => {
    expect(budgetOf(`it("x", async () => {`)).toEqual({
      origin: "unreadable",
      ms: VITEST_DEFAULT_TIMEOUT_MS,
    });
  });

  it("reports a line number that is not in the file", () => {
    expect(budgetOf(`it("x", async () => {});`, 99)).toEqual({
      origin: "unreadable",
      ms: VITEST_DEFAULT_TIMEOUT_MS,
    });
  });
});

describe("readDeclaredBudget against the repository's own files", () => {
  const cases: readonly (readonly [string, number, number | "default"])[] = [
    // The model answer this whole rule is written around.
    ["apps/server/src/docs/bulk.test.ts", 141, 20_000],
    // The two INFRA-020 gave a measured budget to.
    ["apps/server/src/attachments/serve.real-listener.test.ts", 139, 15_000],
    ["apps/server/src/events/sse.test.ts", 306, 15_000],
  ];

  it.each(cases)("reads the budget declared in %s at line %i", (file, line, expected) => {
    // Against real source, not a snippet: the snippets prove the grammar, this
    // proves the grammar is the one these files are actually written in.
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    const budget = readDeclaredBudget(source, line);
    if (expected === "default") expect(budget.origin).toBe("default");
    else expect(budget).toEqual({ origin: "declared", ms: expected });
  });
});

describe("assessRun", () => {
  const source = [
    `it("cheap", async () => {});`,
    `it("slow with a measured budget", async () => {}, 20_000);`,
    `it("slow with none", async () => {});`,
  ].join("\n");

  const reported: readonly ReportedTest[] = [
    { file: "/repo/a.test.ts", name: "cheap", line: 1, durationMs: 40 },
    { file: "/repo/a.test.ts", name: "slow with a measured budget", line: 2, durationMs: 4056 },
    { file: "/repo/a.test.ts", name: "slow with none", line: 3, durationMs: 4328 },
  ];

  const assessment = assessRun(reported, () => source);

  it("flags the untimed slow test and clears the one whose budget was measured", () => {
    // 4056 of 20_000 is 20%; 4328 of the 5000 default is 87%. Same wall clock,
    // opposite verdicts — which is the entire reason the quantity is a fraction.
    expect(assessment.overBudget.map((test) => test.name)).toEqual(["slow with none"]);
    expect(assessment.totalTests).toBe(3);
  });

  it("orders findings worst first", () => {
    const noisy = assessRun(
      [
        { file: "/repo/a.test.ts", name: "slow with none", line: 3, durationMs: 2600 },
        { file: "/repo/a.test.ts", name: "cheap", line: 1, durationMs: 4900 },
      ],
      () => source,
    );
    expect(noisy.overBudget.map((test) => test.name)).toEqual(["cheap", "slow with none"]);
  });

  it("separates a test whose budget could not be read from the findings", () => {
    const unreadable = assessRun(
      [{ file: "/repo/a.test.ts", name: "mystery", line: 99, durationMs: 4900 }],
      () => source,
    );
    expect(unreadable.overBudget).toEqual([]);
    expect(unreadable.unreadable.map((test) => test.name)).toEqual(["mystery"]);
  });

  it("treats a file it cannot read as unreadable rather than as the default", () => {
    const missing = assessRun(
      [{ file: "/repo/gone.test.ts", name: "x", line: 1, durationMs: 4900 }],
      () => undefined,
    );
    expect(missing.unreadable).toHaveLength(1);
  });

  it("holds the threshold at the value derived from the measured load multiplier", () => {
    // 1/1.7 = 0.588, and this is the round number below it. Changing it is a
    // change to the rule in docs/TS_GUIDELINES.md, not a tuning knob.
    expect(SLOW_TEST_BUDGET_FRACTION).toBe(0.5);
  });
});

describe("readVitestReport", () => {
  it("reads titles, files, durations and locations out of the reporter's shape", () => {
    const report = {
      testResults: [
        {
          name: "/repo/a.test.ts",
          assertionResults: [
            {
              fullName: "group > case",
              title: "case",
              status: "passed",
              duration: 4041.2,
              location: { line: 306, column: 3 },
            },
          ],
        },
      ],
    };
    expect(readVitestReport(report)).toEqual<ReportedTest[]>([
      { file: "/repo/a.test.ts", name: "group > case", line: 306, durationMs: 4041.2 },
    ]);
  });

  it("keeps a failed test — a test that timed out is exactly what this is about", () => {
    const report = {
      testResults: [
        {
          name: "/repo/a.test.ts",
          assertionResults: [{ title: "t", status: "failed", duration: 5001 }],
        },
      ],
    };
    expect(readVitestReport(report)).toHaveLength(1);
  });

  it("drops a skipped test, which has no duration to reason about", () => {
    const report = {
      testResults: [
        {
          name: "/repo/a.test.ts",
          assertionResults: [{ title: "t", status: "skipped", duration: 0 }],
        },
      ],
    };
    expect(readVitestReport(report)).toEqual([]);
  });

  it("returns nothing rather than throwing on a shape it does not recognise", () => {
    expect(readVitestReport(undefined)).toEqual([]);
    expect(readVitestReport({ testResults: "nope" })).toEqual([]);
    expect(readVitestReport({ testResults: [{ name: 1 }] })).toEqual([]);
  });
});

describe("formatAssessment", () => {
  it("says so plainly when nothing is near its budget", () => {
    const clean = assessRun([], () => undefined);
    expect(formatAssessment(clean, repoRoot).join("\n")).toContain("none above 50%");
  });

  it("names the file, the line, the fraction and where the budget came from", () => {
    const source = `it("slow with none", async () => {});`;
    const assessment = assessRun(
      [{ file: `${repoRoot}/apps/x/a.test.ts`, name: "slow", line: 1, durationMs: 4328 }],
      () => source,
    );
    const text = formatAssessment(assessment, repoRoot).join("\n");
    expect(text).toContain("apps/x/a.test.ts:1");
    expect(text).toContain("87%");
    expect(text).toContain("(default)");
    // The report must point at the diagnosis order, not at a bigger number.
    expect(text).toContain("The remedy is not a bigger number");
    expect(text).toContain("docs/TS_GUIDELINES.md");
  });
});

describe("shortLocation", () => {
  it("renders a repo-relative path with its line", () => {
    expect(shortLocation(`${repoRoot}/apps/a.test.ts`, 12, repoRoot)).toBe("apps/a.test.ts:12");
  });

  it("leaves a path outside the repository alone", () => {
    expect(shortLocation("/elsewhere/a.test.ts", undefined, repoRoot)).toBe("/elsewhere/a.test.ts");
  });
});
