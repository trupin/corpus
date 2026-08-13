/**
 * `npm run issues:check` — INFRA-027's gate.
 *
 * Whole-tree by nature (it compares one file against 400 others), so per
 * CLAUDE.md's rule on where a check belongs this is CI's rather than the commit
 * hook's. The hook stays diff-scoped.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compare, describe, parsePlan, readIssueFiles } from "./issue-tracker.js";

const issuesDir = resolve(import.meta.dirname, "..", "issues");
const rows = parsePlan(readFileSync(join(issuesDir, "PLAN.md"), "utf8"));
const files = readIssueFiles(issuesDir);
const findings = compare(rows, files);

if (findings.length === 0) {
  process.stdout.write(
    `issues:check ✓ ${String(rows.length)} PLAN rows and ${String(files.length)} issue files agree\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `issues:check ✗ ${String(findings.length)} disagreement(s) between issues/PLAN.md and the issue files\n\n`,
);
for (const finding of findings) process.stderr.write(`  ${describe(finding)}\n`);
process.stderr.write(
  "\nissues:check   Both halves carry a status and nothing else keeps them in step.\n" +
    "issues:check   Fix the tracker, not this check (INFRA-027).\n",
);
process.exit(1);
