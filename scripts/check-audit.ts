/**
 * The `npm audit` gate (INFRA-013) — zero vulnerabilities of any severity.
 *
 * Two callers, one script, and the difference between them is a **positional
 * decision made by the caller**, never something this script sniffs:
 *
 *   .githooks/pre-commit  node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
 *   CI / validate         node --import tsx scripts/check-audit.ts
 *
 * The flag governs exactly one branch — what to do when the registry does not
 * answer — and nothing else. Findings fail with or without it; there is no
 * environment variable, no `CI` detection, and no allowlist anywhere in the path.
 * A developer on a dead network still commits (CI is the fail-closed backstop); a
 * developer with a real advisory does not, network or no network.
 *
 * `scripts/audit-report.ts` holds the verdict logic and the reasoning about why
 * the exit code of `npm audit` is not usable as a signal. This file only spawns,
 * prints and sets the exit code.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { classifyAuditReport, formatFinding } from "./audit-report.js";

/**
 * The flag `.githooks/pre-commit` passes and the CI workflow does not. Spelled
 * out rather than abbreviated so that a future reader of either caller can see
 * what it does without opening this file.
 */
const TOLERATE_UNREACHABLE = "--tolerate-unreachable-registry";

const repoRoot = resolve(import.meta.dirname, "..");
const tolerateUnreachableRegistry = process.argv.slice(2).includes(TOLERATE_UNREACHABLE);

// Run from the repo root: one root-level audit covers every workspace, because
// npm resolves the whole workspace tree into the single root `package-lock.json`.
const audited = spawnSync("npm", ["audit", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
  shell: false,
});

// `audited.status` is deliberately unused: 1 means "found advisories" *and*
// "registry unreachable" (see audit-report.ts). The payload is the only signal.
const verdict = classifyAuditReport(audited.stdout ?? "");

switch (verdict.kind) {
  case "clean":
    process.stdout.write("audit:check ✓ npm audit reports 0 vulnerabilities, all severities\n");
    break;

  case "findings": {
    for (const finding of verdict.findings) {
      process.stderr.write(`audit:check ✗ ${formatFinding(finding)}\n`);
    }
    process.stderr.write(
      `audit:check ✗ ${String(verdict.total)} vulnerable package(s), ` +
        `${String(verdict.findings.length)} advisory(ies). The gate is zero of any severity ` +
        "and there is no allowlist: upgrade, replace, or override the transitive dependency.\n",
    );
    process.exitCode = 1;
    break;
  }

  case "unreachable": {
    const rule = "═".repeat(72);
    for (const line of [
      rule,
      "  THE SUPPLY-CHAIN GATE DID NOT RUN.",
      `  The npm registry did not answer: ${verdict.reason}`,
      "  Your dependencies were NOT checked against any advisory database.",
      ...(tolerateUnreachableRegistry
        ? [
            "  Proceeding anyway — a network outage must not block a local commit.",
            "  CI runs this same check fail-closed, so anything missed here fails there.",
          ]
        : ["  Failing closed. This gate does not report success it did not measure."]),
      rule,
    ]) {
      process.stderr.write(`audit:check ⚠ ${line}\n`);
    }
    if (!tolerateUnreachableRegistry) process.exitCode = 1;
    break;
  }
}
