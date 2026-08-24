/**
 * The budget-fraction analysis behind `npm run test:slow` (INFRA-020).
 *
 * ## What this measures, and why it is a fraction rather than a duration
 *
 * A vitest test with no third argument runs on a 5000 ms budget. A test that
 * uses most of that budget at rest is one bad afternoon from red, and the gate
 * cannot tell its timeout apart from a regression — which is the cost INFRA-020
 * was filed for. What it is *not* is "a test that flakes under load": measured
 * on this repository (SERVER-053, re-measured here), the two worst offenders in
 * `apps/server` moved 174 ms and 25 ms between a load average of 6 and one of
 * 13, while sitting at 87% and 81% of budget the whole time. Load did not reveal
 * them and a `--repeat-each` sweep would have called them stable.
 *
 * So the quantity that matters is **duration ÷ the test's own budget**, and the
 * threshold is derived rather than picked:
 *
 *   - The worst load multiplier measured in this suite is **~1.7×**
 *     (`docs/bulk.test.ts`, 2338 ms idle → 4056 ms under a load average of 45).
 *   - A test survives that multiplier when its measured fraction is under
 *     1/1.7 = 0.588.
 *   - {@link SLOW_TEST_BUDGET_FRACTION} is **0.5**, the round number below it.
 *
 * INFRA-020 originally proposed ">20% of budget when idle". Measured over a real
 * 4675-test `apps/server` run under a load average of 19-25, that threshold flags
 * **33** tests, 30% flags 7, and 50% flags **1**. A rule nobody follows is worse
 * than no rule, and a rule that fires 33 times on a green suite is that rule.
 *
 * ## Why the budget is per-test and not a wall-clock constant
 *
 * A test given an explicit, measured budget has already been diagnosed — that is
 * the documented remedy, and `apps/server/src/docs/bulk.test.ts` is the model
 * answer. Comparing against a flat number would keep flagging it forever, so it
 * is compared against the budget it actually declares. `bulk.test.ts` at
 * 4056 ms of its declared 20 s is 20%, and reports clean.
 *
 * ## The parsing history this module exists to end
 *
 * SERVER-053's first sweep reported that none of the three slow tests carried a
 * timeout. It was wrong, and the cause was the grep rather than the files:
 * `[0-9]{4,}` does not match `20_000`, because the numeric separator is an
 * underscore. Any sweep also has to match vitest's options form,
 * `it(name, { timeout: N }, fn)`. Both are covered here and both are tested.
 *
 * A budget this module cannot read is reported as {@link UNREADABLE_BUDGET}
 * rather than silently assumed either way — a scan that guesses in the lenient
 * direction has a hole, and one that guesses in the strict direction cries wolf.
 */

/**
 * Vitest's default `testTimeout`. `vitest.config.ts` is the only Vitest config
 * in this repository and deliberately sets none, which `slow-tests.test.ts`
 * asserts by importing the config — so this constant cannot quietly become a
 * lie.
 */
export const VITEST_DEFAULT_TIMEOUT_MS = 5000;

/** Derived from the measured 1.7× load multiplier; see the file docblock. */
export const SLOW_TEST_BUDGET_FRACTION = 0.5;

/** Where a test's budget came from. */
export type BudgetOrigin =
  /** The test declares its own, as a trailing number or `{ timeout: N }`. */
  | "declared"
  /** The test declares nothing, so it runs on {@link VITEST_DEFAULT_TIMEOUT_MS}. */
  | "default"
  /** The call could not be parsed. Reported as such, never assumed either way. */
  | "unreadable";

export interface TestBudget {
  readonly origin: BudgetOrigin;
  /** The budget in milliseconds. For `unreadable`, the default is used as a floor. */
  readonly ms: number;
}

export const UNREADABLE_BUDGET: TestBudget = Object.freeze({
  origin: "unreadable",
  ms: VITEST_DEFAULT_TIMEOUT_MS,
});

// ---------------------------------------------------------------------------
// Reading a test's declared budget out of its source
// ---------------------------------------------------------------------------

/**
 * Walks past a string, template literal or comment starting at {@link from},
 * returning the index just after it. Returns {@link from} when nothing starts
 * there. Template literals recurse through `${…}` so a brace or paren inside an
 * interpolation cannot unbalance the caller's depth count.
 */
function skipAtomic(source: string, from: number): number {
  const ch = source[from];
  const next = source[from + 1];

  if (ch === "/" && next === "/") {
    const end = source.indexOf("\n", from);
    return end === -1 ? source.length : end;
  }
  if (ch === "/" && next === "*") {
    const end = source.indexOf("*/", from + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (ch === '"' || ch === "'") {
    let at = from + 1;
    while (at < source.length) {
      if (source[at] === "\\") at += 2;
      else if (source[at] === ch) return at + 1;
      else at += 1;
    }
    return source.length;
  }
  if (ch === "`") {
    let at = from + 1;
    while (at < source.length) {
      if (source[at] === "\\") {
        at += 2;
        continue;
      }
      if (source[at] === "`") return at + 1;
      if (source[at] === "$" && source[at + 1] === "{") {
        at = skipBalanced(source, at + 1, "{", "}");
        continue;
      }
      at += 1;
    }
    return source.length;
  }
  return from;
}

/**
 * Given the index of an opening delimiter, returns the index just after its
 * match, or `source.length` when it never closes.
 */
function skipBalanced(source: string, from: number, open: string, close: string): number {
  let depth = 0;
  let at = from;
  while (at < source.length) {
    const skipped = skipAtomic(source, at);
    if (skipped !== at) {
      at = skipped;
      continue;
    }
    const ch = source[at];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
    at += 1;
  }
  return source.length;
}

/** The top-level arguments of a call whose `(` sits at {@link openParen}. */
function argumentsOf(source: string, openParen: number): readonly string[] | undefined {
  const end = skipBalanced(source, openParen, "(", ")");
  if (end > source.length || end === source.length) return undefined;
  const inner = source.slice(openParen + 1, end - 1);

  const args: string[] = [];
  let depth = 0;
  let start = 0;
  let at = 0;
  while (at < inner.length) {
    const skipped = skipAtomic(inner, at);
    if (skipped !== at) {
      at = skipped;
      continue;
    }
    const ch = inner[at];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, at));
      start = at + 1;
    }
    at += 1;
  }
  args.push(inner.slice(start));
  return args.map((argument) => argument.trim()).filter((argument) => argument !== "");
}

/** `20_000`, `5000`, `1e4` — vitest accepts any number literal here. */
const NUMBER_LITERAL = /^[0-9][0-9_]*(?:\.[0-9_]+)?(?:e[+-]?[0-9]+)?$/i;

/** `{ timeout: 20_000 }` and `{ timeout: 20_000, retry: 2 }`, in any argument position. */
const TIMEOUT_PROPERTY = /(^|[{,\s])timeout\s*:\s*([0-9][0-9_]*(?:\.[0-9_]+)?(?:e[+-]?[0-9]+)?)/i;

function toNumber(literal: string): number | undefined {
  const parsed = Number(literal.replaceAll("_", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The declared budget of the `it`/`test` call that begins on {@link line}
 * (1-based, as vitest's `--includeTaskLocation` reports it).
 *
 * Handles the three shapes this repository uses:
 *
 *   it("name", async () => { … }, 20_000)          → trailing number literal
 *   it("name", { timeout: 20_000 }, async () => …) → options object
 *   it.each([…])("name", async () => …, 20_000)    → the tagged form, where the
 *                                                    arguments live in the
 *                                                    *second* call
 */
export function readDeclaredBudget(source: string, line: number): TestBudget {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return UNREADABLE_BUDGET;
  const lineStart = lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0);

  const openParen = source.indexOf("(", lineStart);
  if (openParen === -1) return UNREADABLE_BUDGET;

  let args = argumentsOf(source, openParen);
  if (args === undefined) return UNREADABLE_BUDGET;

  // `it.each([...])("name", fn, timeout)`: the first call takes the table, and
  // the arguments that can carry a budget belong to the call that follows it.
  const afterFirst = skipBalanced(source, openParen, "(", ")");
  const trailing = /^\s*\(/.exec(source.slice(afterFirst));
  if (trailing !== null) {
    const second = argumentsOf(source, afterFirst + trailing[0].length - 1);
    if (second === undefined) return UNREADABLE_BUDGET;
    args = second;
  }

  // Only arguments after the name can carry a budget, and only an *object
  // literal* is inspected for `timeout:` — a test body is full of the word and
  // none of those occurrences are vitest options.
  for (const argument of args.slice(1)) {
    if (NUMBER_LITERAL.test(argument)) {
      const ms = toNumber(argument);
      if (ms !== undefined) return { origin: "declared", ms };
    }
    if (argument.startsWith("{")) {
      const property = TIMEOUT_PROPERTY.exec(argument);
      const ms = property?.[2] === undefined ? undefined : toNumber(property[2]);
      if (ms !== undefined) return { origin: "declared", ms };
    }
  }
  return { origin: "default", ms: VITEST_DEFAULT_TIMEOUT_MS };
}

// ---------------------------------------------------------------------------
// Assessing a whole run
// ---------------------------------------------------------------------------

/** One test as vitest's JSON reporter describes it, narrowed to what is used. */
export interface ReportedTest {
  readonly file: string;
  readonly name: string;
  /** 1-based, from `--includeTaskLocation`. `undefined` when the flag was omitted. */
  readonly line: number | undefined;
  readonly durationMs: number;
}

export interface Assessed extends ReportedTest {
  readonly budget: TestBudget;
  /** `durationMs / budget.ms`. The quantity the threshold is applied to. */
  readonly fraction: number;
}

export interface Assessment {
  /** Every test at or above the threshold, worst first. */
  readonly overBudget: readonly Assessed[];
  /** Tests whose call could not be parsed — reported, never assumed. */
  readonly unreadable: readonly Assessed[];
  readonly totalTests: number;
  readonly threshold: number;
}

/**
 * `readSource` is injected rather than read here so the whole assessment stays
 * testable without a fixture tree on disk.
 */
export function assessRun(
  tests: readonly ReportedTest[],
  readSource: (file: string) => string | undefined,
  threshold: number = SLOW_TEST_BUDGET_FRACTION,
): Assessment {
  const sources = new Map<string, string | undefined>();
  const sourceOf = (file: string): string | undefined => {
    if (!sources.has(file)) sources.set(file, readSource(file));
    return sources.get(file);
  };

  const assessed = tests.map((test): Assessed => {
    const source = sourceOf(test.file);
    const budget =
      source === undefined || test.line === undefined
        ? UNREADABLE_BUDGET
        : readDeclaredBudget(source, test.line);
    return { ...test, budget, fraction: test.durationMs / budget.ms };
  });

  const byFraction = (left: Assessed, right: Assessed): number => right.fraction - left.fraction;

  return {
    overBudget: assessed
      .filter((test) => test.budget.origin !== "unreadable" && test.fraction >= threshold)
      .sort(byFraction),
    unreadable: assessed
      .filter((test) => test.budget.origin === "unreadable" && test.fraction >= threshold)
      .sort(byFraction),
    totalTests: assessed.length,
    threshold,
  };
}

// ---------------------------------------------------------------------------
// Reading vitest's JSON reporter output
// ---------------------------------------------------------------------------

interface RawAssertion {
  readonly title?: unknown;
  readonly fullName?: unknown;
  readonly duration?: unknown;
  readonly status?: unknown;
  readonly location?: unknown;
}

/**
 * Narrows vitest's JSON report. Deliberately tolerant: an entry this cannot read
 * is dropped rather than throwing, because the report is an input to a *report*,
 * and a reader that dies on one unfamiliar field tells you nothing about the
 * other four thousand tests.
 */
export function readVitestReport(report: unknown): readonly ReportedTest[] {
  if (typeof report !== "object" || report === null) return [];
  const { testResults } = report as { testResults?: unknown };
  if (!Array.isArray(testResults)) return [];

  const tests: ReportedTest[] = [];
  for (const entry of testResults) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, assertionResults } = entry as { name?: unknown; assertionResults?: unknown };
    if (typeof name !== "string" || !Array.isArray(assertionResults)) continue;

    for (const raw of assertionResults as RawAssertion[]) {
      if (typeof raw !== "object" || raw === null) continue;
      if (raw.status !== "passed" && raw.status !== "failed") continue;
      if (typeof raw.duration !== "number") continue;
      const title = typeof raw.fullName === "string" ? raw.fullName : raw.title;
      if (typeof title !== "string") continue;

      const location = raw.location as { line?: unknown } | undefined;
      tests.push({
        file: name,
        name: title,
        line: typeof location?.line === "number" ? location.line : undefined,
        durationMs: raw.duration,
      });
    }
  }
  return tests;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function percent(fraction: number): string {
  return `${String(Math.round(fraction * 100))}%`;
}

/** `apps/server/src/events/sse.test.ts:306` from an absolute path. */
export function shortLocation(file: string, line: number | undefined, repoRoot: string): string {
  const relative = file.startsWith(repoRoot)
    ? file.slice(repoRoot.length).replace(/^\//, "")
    : file;
  return line === undefined ? relative : `${relative}:${String(line)}`;
}

/** The whole human report, as lines. Returned rather than printed so it is testable. */
export function formatAssessment(assessment: Assessment, repoRoot: string): readonly string[] {
  const { overBudget, unreadable, totalTests, threshold } = assessment;
  const lines: string[] = [];
  const bar = percent(threshold);

  if (overBudget.length === 0 && unreadable.length === 0) {
    lines.push(
      `test:slow ✓ ${String(totalTests)} tests measured, none above ${bar} of its own budget.`,
    );
    return lines;
  }

  lines.push(
    `test:slow — ${String(overBudget.length)} of ${String(totalTests)} tests are at or above ` +
      `${bar} of their own timeout budget.`,
    "",
    "A test near its budget cannot be told apart from a regression when it goes red,",
    "which is the whole cost this measures. The remedy is not a bigger number: diagnose",
    "what the time is spent on first, make it cheaper if the work is not the point of",
    "the test, and only then size a budget to the measurement and write the reason",
    "beside it. docs/TS_GUIDELINES.md → Testing has the order.",
    "",
  );

  for (const test of overBudget) {
    const { budget } = test;
    const origin = budget.origin === "declared" ? "declared" : "default";
    lines.push(
      `  ${percent(test.fraction).padStart(5)}  ` +
        `${String(Math.round(test.durationMs)).padStart(6)} ms of ${String(budget.ms)} ms ` +
        `(${origin})  ${shortLocation(test.file, test.line, repoRoot)}`,
      `         ${test.name}`,
    );
  }

  if (unreadable.length > 0) {
    lines.push(
      "",
      `test:slow ⚠ ${String(unreadable.length)} test(s) took longer than ${bar} of the default`,
      "  budget and this scan could not read the budget they declare. Not counted above,",
      "  because guessing leniently hides them and guessing strictly cries wolf:",
    );
    for (const test of unreadable) {
      lines.push(`  ${shortLocation(test.file, test.line, repoRoot)} — ${test.name}`);
    }
  }
  return lines;
}
