/**
 * The skill/agent-profile size budget (INFRA-038): measurement, scope,
 * thresholds, ratchet baseline, verdicts and report formatting.
 *
 * Counted deterministically as **bytes ÷ 4 ≈ tokens**, whole file — YAML
 * frontmatter included, because the harness reads it too. The whole value of
 * the number is that anybody can reproduce it with `wc -c`; a real tokenizer
 * would be model-specific and add a dependency for no decision this check
 * makes differently.
 *
 * **What the check enforces, and what it cannot.** It enforces the number. The
 * anti-gaming rule — *content every run must read counts toward the budget
 * wherever it lives; move only what a minority of runs reads* — is a claim
 * about how a skill is written, and no byte counter can evaluate it. The check
 * makes gaming visible instead: each `references/` file is reported with its
 * size, and the SKILL.md + references **sum** is printed, so a split that
 * moved bytes without reducing what a run reads shows up as a flat sum. Judging
 * that is review's job, and whether a skill *works* is the rehearsal suite's
 * (INFRA-033) — this only says whether it is affordable.
 *
 * **The ratchet.** Eight tracked files exceeded the error budget on day one. A
 * hook red on every commit gets `--no-verify`d, so those files are
 * grandfathered in `scripts/skill-budget-baseline.json` at their then-current
 * size, and what is enforced is the direction of travel:
 *
 * - a grandfathered file that **grew** past its baseline errors;
 * - one that **shrank** errors too, until the baseline is lowered to match
 *   (`--update-baseline`) — locking the gain in so it cannot quietly regrow;
 * - one that is exactly at baseline warns, naming the gap;
 * - a file with **no entry** faces the absolute thresholds — a new skill has
 *   no excuse, and `--update-baseline` never adds or raises an entry, which is
 *   what keeps the ratchet a ratchet.
 *
 * A **renamed** grandfathered file reads as delete + add, so the new path
 * errors against the absolute threshold even though nothing grew. That false
 * positive is accepted deliberately: move the entry by hand in the baseline
 * file, keeping its token value. Silently passing renames would mean matching
 * on content, and content is exactly what a rename is free to change.
 */

import { execFileSync } from "node:child_process";

/** 1 token ≈ 4 bytes (how this repo counts; INFRA-038). */
export const BYTES_PER_TOKEN = 4;

/** Warn at the tracked distribution's median (user decision 2026-09-05). */
export const WARN_BUDGET_TOKENS = 2000;

/** Error at ~3× the median: eight real outliers, not half the repository. */
export const ERROR_BUDGET_TOKENS = 4000;

export function tokensOf(bytes: number): number {
  return Math.round(bytes / BYTES_PER_TOKEN);
}

/**
 * Scope, recorded: `SKILL.md` directly under a skill directory, and `*.md`
 * directly under an `agents/` directory — the files an agent loads to do
 * work. Not `PROVENANCE.md`, `README.md`, `CLAUDE.md`, `examples/`. Both trees
 * are covered because both are tracked files of this repository: the
 * product's (`assets/workspace/claude/`) and the dev harness's (`.claude/`),
 * under one budget — two budgets would be a second number to argue about.
 */
const SKILL_FILE = /(^|\/)skills\/[^/]+\/SKILL\.md$/;
const AGENT_PROFILE = /(^|\/)agents\/[^/]+\.md$/;

export function isSubjectPath(path: string): boolean {
  return SKILL_FILE.test(path) || AGENT_PROFILE.test(path);
}

/** A skill's `references/` files — reported and summed, never gated. */
export function referencesOf(subject: string, allPaths: readonly string[]): readonly string[] {
  if (!SKILL_FILE.test(subject)) return [];
  const prefix = `${subject.slice(0, -"SKILL.md".length)}references/`;
  return allPaths.filter((path) => path.startsWith(prefix)).sort();
}

export interface MeasuredFile {
  readonly bytes: number;
  readonly validUtf8: boolean;
}

/** Reads one tracked file; null when it cannot be read at all. */
export type ReadMeasured = (path: string) => MeasuredFile | null;

export type Verdict = "ok" | "warn" | "error";

export interface ReferenceReport {
  readonly path: string;
  readonly bytes: number;
  readonly tokens: number;
}

export interface SubjectReport {
  readonly path: string;
  readonly bytes: number;
  readonly tokens: number;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly references: readonly ReferenceReport[];
  /** Subject + references — the anti-gaming sum (equal to `tokens` without references). */
  readonly totalTokens: number;
}

export interface BudgetReport {
  readonly subjects: readonly SubjectReport[];
  /** Baseline entries naming no tracked file — stale, reported, never fatal. */
  readonly staleEntries: readonly string[];
  readonly exitCode: 0 | 1;
}

export const SPLIT_ADVICE =
  "split it — extract a separate skill, or move guidance into references/; " +
  "move only what a minority of runs reads";

const UPDATE_HINT = "run `npm run skills:check -- --update-baseline` and stage the baseline";

function verdictFor(
  tokens: number,
  entry: number | undefined,
): { verdict: Verdict; reason: string } {
  if (entry !== undefined) {
    if (tokens > entry) {
      return {
        verdict: "error",
        reason:
          `over the ${String(ERROR_BUDGET_TOKENS)}-token budget and grew: ` +
          `${String(entry)} → ${String(tokens)} tokens — ${SPLIT_ADVICE}`,
      };
    }
    if (tokens < entry) {
      return {
        verdict: "error",
        reason:
          `shrank below its ratchet baseline (${String(entry)} → ${String(tokens)} tokens) — ` +
          `lock the gain in: ${UPDATE_HINT}`,
      };
    }
    return {
      verdict: "warn",
      reason:
        `over the ${String(ERROR_BUDGET_TOKENS)}-token budget at ${String(tokens)} tokens ` +
        `(grandfathered, not growing) — ${SPLIT_ADVICE}`,
    };
  }
  if (tokens > ERROR_BUDGET_TOKENS) {
    return {
      verdict: "error",
      reason: `over the ${String(ERROR_BUDGET_TOKENS)}-token budget at ${String(tokens)} tokens, with no grandfathering entry — ${SPLIT_ADVICE}`,
    };
  }
  if (tokens > WARN_BUDGET_TOKENS) {
    return {
      verdict: "warn",
      reason: `over the ${String(WARN_BUDGET_TOKENS)}-token warn line at ${String(tokens)} tokens (error at ${String(ERROR_BUDGET_TOKENS)})`,
    };
  }
  return { verdict: "ok", reason: `${String(tokens)} tokens` };
}

export interface BudgetInput {
  /** Every tracked path — reference discovery and stale-entry detection. */
  readonly allPaths: readonly string[];
  /** The in-scope files to assess: the staged subset, or every subject. */
  readonly subjects: readonly string[];
  readonly read: ReadMeasured;
  readonly baseline: Readonly<Record<string, number>>;
}

export function assessBudget(input: BudgetInput): BudgetReport {
  const subjects: SubjectReport[] = [];
  for (const path of [...input.subjects].sort()) {
    const measured = input.read(path);
    if (measured === null) {
      subjects.push({
        path,
        bytes: 0,
        tokens: 0,
        verdict: "error",
        reason: "could not be read — a file the check cannot measure must not pass",
        references: [],
        totalTokens: 0,
      });
      continue;
    }
    if (!measured.validUtf8) {
      subjects.push({
        path,
        bytes: measured.bytes,
        tokens: tokensOf(measured.bytes),
        verdict: "error",
        reason: "is not valid UTF-8 — fix the encoding so the measurement means something",
        references: [],
        totalTokens: tokensOf(measured.bytes),
      });
      continue;
    }
    const tokens = tokensOf(measured.bytes);
    const { verdict, reason } = verdictFor(tokens, input.baseline[path]);
    const references: ReferenceReport[] = [];
    for (const referencePath of referencesOf(path, input.allPaths)) {
      const reference = input.read(referencePath);
      if (reference === null) continue;
      references.push({
        path: referencePath,
        bytes: reference.bytes,
        tokens: tokensOf(reference.bytes),
      });
    }
    subjects.push({
      path,
      bytes: measured.bytes,
      tokens,
      verdict,
      reason,
      references,
      totalTokens: tokens + references.reduce((sum, reference) => sum + reference.tokens, 0),
    });
  }
  const tracked = new Set(input.allPaths);
  const staleEntries = Object.keys(input.baseline)
    .filter((path) => !tracked.has(path))
    .sort();
  const exitCode = subjects.some((subject) => subject.verdict === "error") ? 1 : 0;
  return { subjects, staleEntries, exitCode };
}

const MARKS: Record<Verdict, string> = { ok: "✓", warn: "⚠", error: "✗" };

export function formatReport(report: BudgetReport): readonly string[] {
  const lines: string[] = [];
  lines.push(
    `skills:check ▷ tokens ≈ bytes ÷ ${String(BYTES_PER_TOKEN)}, whole file (frontmatter included) — ` +
      `warn ${String(WARN_BUDGET_TOKENS)}, error ${String(ERROR_BUDGET_TOKENS)} (INFRA-038)`,
  );
  for (const subject of report.subjects) {
    lines.push(
      `skills:check ${MARKS[subject.verdict]} ${subject.path} — ${String(subject.bytes)} bytes ≈ ${String(subject.tokens)} tokens: ${subject.reason}`,
    );
    for (const reference of subject.references) {
      lines.push(
        `skills:check     reference ${reference.path} — ${String(reference.bytes)} bytes ≈ ${String(reference.tokens)} tokens`,
      );
    }
    if (subject.references.length > 0) {
      lines.push(
        `skills:check     total with references ≈ ${String(subject.totalTokens)} tokens — a split that only moved bytes shows here as a flat sum`,
      );
    }
  }
  for (const stale of report.staleEntries) {
    lines.push(
      `skills:check ▷ stale baseline entry (no such tracked file): ${stale} — ${UPDATE_HINT}`,
    );
  }
  const errors = report.subjects.filter((subject) => subject.verdict === "error").length;
  const warns = report.subjects.filter((subject) => subject.verdict === "warn").length;
  lines.push(
    report.exitCode === 0
      ? `skills:check ✓ ${String(report.subjects.length)} file(s) measured, ${String(warns)} over the warn line`
      : `skills:check ✗ ${String(errors)} file(s) fail the budget (${String(report.subjects.length)} measured)`,
  );
  return lines;
}

/**
 * The regeneration that keeps the ratchet a ratchet: entries only shrink, are
 * removed when their file dropped to the error budget or vanished, and are
 * **never added or raised** — a new over-budget file faces the absolute
 * threshold with no shelter. Recreating the whole file from nothing is the one
 * way to re-grandfather, and deleting a committed baseline is exactly the kind
 * of thing a diff makes loud.
 */
export function updateBaseline(
  current: Readonly<Record<string, number>>,
  measuredTokens: Readonly<Record<string, number>>,
): { readonly next: Readonly<Record<string, number>>; readonly changes: readonly string[] } {
  const next: Record<string, number> = {};
  const changes: string[] = [];
  for (const [path, entry] of Object.entries(current)) {
    const measured = measuredTokens[path];
    if (measured === undefined) {
      changes.push(`removed ${path} (no longer tracked)`);
      continue;
    }
    if (measured <= ERROR_BUDGET_TOKENS) {
      changes.push(`removed ${path} (now within the ${String(ERROR_BUDGET_TOKENS)}-token budget)`);
      continue;
    }
    if (measured < entry) {
      next[path] = measured;
      changes.push(`lowered ${path}: ${String(entry)} → ${String(measured)}`);
      continue;
    }
    // Never raised: a grown file keeps its old entry and keeps failing.
    next[path] = entry;
    if (measured > entry) {
      changes.push(
        `kept ${path} at ${String(entry)} (measured ${String(measured)} — a baseline never rises)`,
      );
    }
  }
  return { next, changes };
}

/**
 * Enumeration is `git ls-files`, never `find`: `.claude/worktrees/` is a
 * gitignored second checkout of this whole repository, and a filesystem walk
 * reports every skill twice and blames the wrong copy.
 */
export function enumerateTrackedFiles(repoRoot: string): readonly string[] {
  const stdout = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split("\0").filter((path) => path !== "");
}
