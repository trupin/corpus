/**
 * `npm run skills:check` — the runner for the skill-size budget (INFRA-038).
 * The measurement, thresholds and ratchet live in `scripts/skill-budget.ts`;
 * this file reads files, prints, writes the baseline on request, and sets an
 * exit code.
 *
 * Three call shapes:
 *
 * - no arguments — every tracked subject; CI's `validate` job runs this.
 * - `--staged <paths…>` — only the named files, filtered to the check's
 *   scope; the pre-commit hook passes its staged list. Nothing in scope, or no
 *   git repository to enumerate, prints a skip line and exits 0.
 * - `--update-baseline` — regenerate `scripts/skill-budget-baseline.json`,
 *   only ever lowering or removing entries (`updateBaseline` is the ratchet).
 *
 * It gates (exit 1 on any error verdict) — deliberately, where `test:slow`
 * deliberately does not: bytes ÷ 4 is the same number on every machine, so a
 * blocking form cannot go red for reasons unrelated to the tree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  assessBudget,
  enumerateTrackedFiles,
  formatReport,
  isSubjectPath,
  tokensOf,
  updateBaseline,
  type MeasuredFile,
} from "./skill-budget.js";

const repoRoot = resolve(import.meta.dirname, "..");
const baselinePath = resolve(import.meta.dirname, "skill-budget-baseline.json");

const BASELINE_COMMENT =
  "INFRA-038 ratchet: token counts (bytes ÷ 4) of the files grandfathered over the " +
  "4000-token error budget when this check landed. Entries only shrink or disappear — " +
  "regenerate with `npm run skills:check -- --update-baseline`, which never adds or raises one. " +
  "A renamed grandfathered file: move its entry by hand, keeping the value.";

const BaselineSchema = z.object({
  $comment: z.string(),
  files: z.record(z.string(), z.number().int().nonnegative()),
});

function readBaseline(): Readonly<Record<string, number>> {
  let raw: string;
  try {
    raw = readFileSync(baselinePath, "utf8");
  } catch {
    return {};
  }
  return BaselineSchema.parse(JSON.parse(raw)).files;
}

function writeBaseline(files: Readonly<Record<string, number>>): void {
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    baselinePath,
    `${JSON.stringify({ $comment: BASELINE_COMMENT, files: sorted }, null, 2)}\n`,
    "utf8",
  );
}

function readMeasured(path: string): MeasuredFile | null {
  let raw: Buffer;
  try {
    raw = readFileSync(resolve(repoRoot, path));
  } catch {
    return null;
  }
  let validUtf8 = true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    validUtf8 = false;
  }
  return { bytes: raw.byteLength, validUtf8 };
}

function main(): void {
  const argv = process.argv.slice(2);
  const stagedMode = argv[0] === "--staged";
  const updateMode = argv[0] === "--update-baseline";

  let allPaths: readonly string[];
  try {
    allPaths = enumerateTrackedFiles(repoRoot);
  } catch (error) {
    if (stagedMode) {
      // The hook can only be mid-commit in a tree git owns; anything else is
      // not a commit to gate.
      process.stdout.write("skills:check ▷ skipped (no git repository to enumerate)\n");
      return;
    }
    throw new Error("git ls-files failed — the whole-tree check cannot run", { cause: error });
  }

  const everySubject = allPaths.filter(isSubjectPath);

  if (updateMode) {
    const measuredTokens: Record<string, number> = {};
    for (const path of everySubject) {
      const measured = readMeasured(path);
      if (measured !== null) measuredTokens[path] = tokensOf(measured.bytes);
    }
    const { next, changes } = updateBaseline(readBaseline(), measuredTokens);
    writeBaseline(next);
    for (const change of changes) process.stdout.write(`skills:check ▷ ${change}\n`);
    process.stdout.write(
      `skills:check ✓ baseline written to ${baselinePath} (${String(Object.keys(next).length)} grandfathered file(s))\n`,
    );
    return;
  }

  const subjects = stagedMode ? argv.slice(1).filter(isSubjectPath) : everySubject;
  if (stagedMode && subjects.length === 0) {
    process.stdout.write("skills:check ▷ skipped (no skill or agent profile staged)\n");
    return;
  }

  const report = assessBudget({ allPaths, subjects, read: readMeasured, baseline: readBaseline() });
  for (const line of formatReport(report)) process.stdout.write(`${line}\n`);
  process.exitCode = report.exitCode;
}

main();
