/**
 * The `npm audit` gate (INFRA-013, amended by INFRA-021).
 *
 * Two callers, one script, and the difference between them is a **positional
 * decision made by the caller**, never something this script sniffs:
 *
 *   .githooks/pre-commit  node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
 *   CI / validate         node --import tsx scripts/check-audit.ts
 *
 * The flag governs exactly one branch — what to do when the registry does not
 * answer — and nothing else. Findings fail with or without it; there is still no
 * environment variable and no `CI` detection anywhere in this path. A developer
 * on a dead network still commits (CI is the fail-closed backstop); a developer
 * with a real advisory does not, network or no network.
 *
 * ## What changed, and why it is not a knob (INFRA-021, user decision 2026-08-06)
 *
 * This docblock used to end "…and no allowlist anywhere in the path". There is
 * now one **documented exception** — a single advisory that cannot be fixed from
 * this repository (`GHSA-5p4m-2wfm-xmqj`, js-yaml, reached only through
 * `packages/contract`'s build-time devDependency on `openapi-typescript`, whose
 * transitive `@redocly/openapi-core` pins the vulnerable version exactly and so is
 * beyond the reach of any npm override). The user's decision was to ship with it
 * documented and time-boxed rather than block development on a third party's
 * release cadence or swap out the generator that produces the API client both the
 * UI and the CLI consume.
 *
 * It is deliberately not an allowlist and cannot be turned into one from here:
 * the exception is data in `scripts/audit-report.ts`, matched against the GHSA id,
 * the dependency route as `package-lock.json` declares it, and a hard expiry date.
 * This file cannot widen it, and passes nothing into it but the lockfile and the
 * clock. The full argument for the amendment lives beside the rule, in
 * `scripts/audit-report.ts`.
 *
 * What this file **must** do, and is the reason its output grew: never let a
 * tolerated finding pass quietly. A run carrying an exception prints it in full —
 * advisory, route, justification, invalidation conditions, days remaining — and
 * its success line says the tree is not clean. `clean` and `tolerated` are
 * different verdicts precisely so that this file cannot conflate them.
 *
 * ## The flag applies to one branch, and "the gate did not run" is not it (INFRA-015)
 *
 * There are two ways to end a run with nothing to classify, and they are not the
 * same thing:
 *
 *   - **`unreachable`** — npm ran, and its payload says the registry did not
 *     answer. A fact about the network. The flag applies here.
 *   - **`unusable`** — npm never ran, was killed, or wrote more than the capture
 *     buffer holds. A fact about the gate itself. The flag does **not** apply,
 *     in either caller.
 *
 * Before INFRA-015 both arrived at the same branch, so the failure most likely
 * on a badly broken tree was also the quiet one. `spawnSync` had no `maxBuffer`,
 * which meant the 1 MiB default: a tree with more than ~1 MiB of advisories got
 * its stdout truncated, `JSON.parse` threw, the verdict came back `unreachable`,
 * and pre-commit proceeded — blaming the registry for a truncation, on exactly
 * the trees with the most findings. `error` was never read either, so npm
 * missing from `PATH` read the same way. A gate whose failure mode is silence is
 * a gate that lies.
 *
 * `scripts/audit-report.ts` holds the verdict logic and the reasoning about why
 * the exit code of `npm audit` is not usable as a signal. This file only spawns,
 * reads the lockfile, prints and sets the exit code.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyAuditRun,
  formatExceptionRoute,
  formatFinding,
  sanitizeRegistryText,
  type AuditRunFailure,
  type ExpiredException,
  type ToleratedException,
} from "./audit-report.js";

/** One line naming what broke, so the reader is not left to infer it from a code. */
const UNUSABLE_HEADLINE: Record<AuditRunFailure, string> = {
  "spawn-failed": "npm could not be started — is it on PATH, and executable?",
  "output-overflowed": "npm audit's output was truncated before anything could read it.",
  terminated: "npm audit was killed before it produced a report.",
};

/**
 * The flag `.githooks/pre-commit` passes and the CI workflow does not. Spelled
 * out rather than abbreviated so that a future reader of either caller can see
 * what it does without opening this file.
 */
const TOLERATE_UNREACHABLE = "--tolerate-unreachable-registry";

const repoRoot = resolve(import.meta.dirname, "..");
const tolerateUnreachableRegistry = process.argv.slice(2).includes(TOLERATE_UNREACHABLE);

/**
 * 64 MiB, against `spawnSync`'s 1 MiB default (INFRA-015). This repository's own
 * clean report is ~1 KB and a report naming every advisory in a large tree is a
 * few hundred KB, so the number is not a capacity estimate — it is far enough
 * out that hitting it means something is wrong in a way no audit verdict should
 * be read past. Raising it does not make overflow safe: `ENOBUFS` is still
 * consulted, and still fails closed in both callers. It only makes overflow rare
 * enough to be believable as an alarm.
 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

// Run from the repo root: one root-level audit covers every workspace, because
// npm resolves the whole workspace tree into the single root `package-lock.json`.
const audited = spawnSync("npm", ["audit", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
  shell: false,
  maxBuffer: MAX_OUTPUT_BYTES,
});

/**
 * The lockfile is the only place the *route* to a vulnerable package exists, so
 * an exception cannot be honoured without it. Unreadable ⇒ `undefined` ⇒ nothing
 * is tolerated and the gate fails on the finding, which is the right direction.
 */
function readLockfile(): unknown {
  try {
    return JSON.parse(readFileSync(resolve(repoRoot, "package-lock.json"), "utf8"));
  } catch {
    return undefined;
  }
}

/*
 * A *numeric* `audited.status` is still deliberately unused as a verdict: 1
 * means "found advisories" *and* "registry unreachable" (see audit-report.ts),
 * so the payload remains the only signal about the tree. `status === null` is a
 * different question — it says npm never exited at all, so there is no payload
 * to have an opinion about. `classifyAuditRun` draws exactly that line.
 */
const verdict = classifyAuditRun(audited, { lockfile: readLockfile() });

const RULE_WIDTH = 72;
const rule = "═".repeat(RULE_WIDTH);
const thinRule = "─".repeat(RULE_WIDTH);

/**
 * The justification is prose and it is long on purpose. Unwrapped it becomes one
 * unreadable line that a reader skips — which would defeat "loud". Wrapped under
 * a repeated label, it reads.
 */
function wrapped(label: string, text: string): string[] {
  const indent = " ".repeat(4);
  const gutter = `${indent}${label.padEnd(9)}`;
  const width = RULE_WIDTH - gutter.length;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (current === "") current = word;
    else if (current.length + 1 + word.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.map((line, at) =>
    at === 0 ? `${gutter}${line}` : `${indent}${" ".repeat(9)}${line}`,
  );
}

/** Loud by construction: every tolerated finding, on every run, with its whole record. */
function reportTolerated(tolerated: readonly ToleratedException[]): void {
  if (tolerated.length === 0) return;
  const count = tolerated.length;
  const lines: string[] = [
    rule,
    `  THIS GATE IS CARRYING ${String(count)} DOCUMENTED EXCEPTION${count === 1 ? "" : "S"}. IT IS NOT CLEAN.`,
  ];
  for (const { exception, findings, daysRemaining } of tolerated) {
    lines.push(
      thinRule,
      `  ${exception.advisory} — expires ${exception.expires} (${String(daysRemaining)} day(s) left)`,
      ...findings.map((finding) => `    ${formatFinding(finding)}`),
      `    route    ${formatExceptionRoute(exception)}`,
      ...wrapped("why", exception.reason),
      ...exception.invalidatedBy.flatMap((condition) => wrapped("void if", condition)),
    );
  }
  lines.push(rule);
  for (const line of lines) process.stderr.write(`audit:check ⚠ ${line}\n`);
}

/** An expired exception is reported as expired — never re-diagnosed as a new advisory. */
function reportExpired(expired: readonly ExpiredException[]): void {
  for (const { exception, findings, daysExpired } of expired) {
    const when =
      daysExpired < 0
        ? `has an unreadable expiry date (${exception.expires})`
        : `EXPIRED ON ${exception.expires} (${String(daysExpired)} day(s) ago)`;
    for (const line of [
      `THE DOCUMENTED EXCEPTION FOR ${exception.advisory} ${when}.`,
      "  This is the advisory the gate was knowingly carrying — not a new one.",
      ...findings.map((finding) => `  ${formatFinding(finding)}`),
      "  Fix it, or write a NEW exception with a fresh justification and a fresh date.",
      "  Do not just move the date: re-argue it in scripts/audit-report.ts or delete it.",
    ]) {
      process.stderr.write(`audit:check ✗ ${line}\n`);
    }
  }
}

switch (verdict.kind) {
  case "clean":
    process.stdout.write("audit:check ✓ npm audit reports 0 vulnerabilities, all severities\n");
    break;

  case "tolerated": {
    reportTolerated(verdict.tolerated);
    const covered = verdict.tolerated.reduce((count, entry) => count + entry.findings.length, 0);
    const many = verdict.tolerated.length !== 1;
    process.stdout.write(
      `audit:check ✓ npm audit: 0 untolerated vulnerabilities — but ${String(covered)} finding(s) ` +
        `are tolerated by ${String(verdict.tolerated.length)} documented exception${many ? "s" : ""} ` +
        "above. This is NOT a clean tree.\n",
    );
    break;
  }

  case "findings": {
    reportTolerated(verdict.tolerated);
    reportExpired(verdict.expired);
    // When every failure came from a lapsed exception, `reportExpired` has already
    // said everything true about this run — the generic summary would only muddy
    // it with "0 unexcepted advisories" next to a red gate.
    if (verdict.findings.length > 0) {
      for (const finding of verdict.findings) {
        process.stderr.write(`audit:check ✗ ${formatFinding(finding)}\n`);
      }
      process.stderr.write(
        `audit:check ✗ ${String(verdict.total)} vulnerable package(s), ` +
          `${String(verdict.findings.length)} unexcepted advisory(ies). The gate is zero of any ` +
          "severity: upgrade, replace, or override the transitive dependency. The one documented " +
          "exception mechanism is narrow by design (advisory id + lockfile route + expiry) and " +
          "is not a place to add findings — see scripts/audit-report.ts.\n",
      );
    }
    process.exitCode = 1;
    break;
  }

  case "unreachable": {
    for (const line of [
      rule,
      "  THE SUPPLY-CHAIN GATE DID NOT RUN.",
      `  The npm registry did not answer: ${sanitizeRegistryText(verdict.reason)}`,
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

  /*
   * The branch the tolerate flag cannot reach. It is spelled out rather than
   * folded into `unreachable` because the remedy is different in every case, and
   * because a developer who sees "the registry did not answer" after npm failed
   * to start will go and check their network.
   */
  case "unusable": {
    for (const line of [
      rule,
      "  THE SUPPLY-CHAIN GATE COULD NOT RUN, AND THIS IS NOT A NETWORK PROBLEM.",
      `  ${UNUSABLE_HEADLINE[verdict.cause]}`,
      `  ${verdict.reason}`,
      "  Your dependencies were NOT checked against any advisory database.",
      "  Failing closed in every caller: --tolerate-unreachable-registry covers an",
      "  unanswering registry, never a check that did not run. Fix the cause and",
      `  re-run: npm audit --json | head -c 2000${
        verdict.cause === "output-overflowed"
          ? `  # then find out why it exceeded ${String(MAX_OUTPUT_BYTES)} bytes`
          : ""
      }`,
      rule,
    ]) {
      process.stderr.write(`audit:check ✗ ${line}\n`);
    }
    process.exitCode = 1;
    break;
  }
}
