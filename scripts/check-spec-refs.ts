/**
 * `npm run spec:check` — INFRA-029's gate.
 *
 * **CI's, not the hooks'.** The rule (CLAUDE.md, user decision 2026-08-07) is
 * that a check which can run on the diff runs locally and one that needs the
 * whole codebase is CI's. The citation half of this check is diff-scopable; the
 * heading half is not, and the half that is not is the one that matters. Renumber
 * or delete a section of SPEC.md and the citations that go stale are in files the
 * diff never touches — a staged-file version would pass the very commit that
 * breaks them, which is a check that reports success for the failure it exists to
 * catch. Nothing here is unrecoverable after the fact either (unlike a pushed
 * `v*` tag, which is why `version:check` is pre-push's one survivor): a wrong
 * citation caught on the PR is caught before it can be copied.
 */

import { resolve } from "node:path";
import { checkSpecReferences, describeFinding, EXCLUDED_PATHS, SPEC_PATH } from "./spec-refs.js";

const root = resolve(import.meta.dirname, "..");
const report = checkSpecReferences(root);
const sections = new Set(report.sections);

// A check that stopped looking must not read like a clean tree, so the counts
// are printed on success as well as failure.
const scale = `${String(report.citationsChecked)} citation(s) across ${String(report.filesScanned)} file(s), against ${String(report.sections.length)} section(s) of ${SPEC_PATH}`;

for (const skipped of report.filesSkipped) {
  process.stderr.write(`spec:check ▷ not read (${skipped.reason}): ${skipped.path}\n`);
}

if (report.findings.length === 0) {
  process.stdout.write(`spec:check ✓ ${scale}\n`);
  process.exit(0);
}

process.stderr.write(
  `spec:check ✗ ${String(report.findings.length)} citation(s) name a section ${SPEC_PATH} does not have\n\n`,
);
for (const finding of report.findings) {
  process.stderr.write(`  ${describeFinding(finding, sections)}\n`);
}
process.stderr.write(
  `\nspec:check   Checked ${scale}.\n` +
    "spec:check   A cross-reference to a section that does not exist reads exactly like one\n" +
    "spec:check   that does. The missing section 9.4 this check exists for survived eleven\n" +
    "spec:check   copies and four months, reached `packages/contract/src/schemas/key.ts`, and\n" +
    "spec:check   shipped in the generated client (SHARED-046, INFRA-029).\n" +
    "spec:check   Fix the citation to name the section you meant. If it cites another\n" +
    "spec:check   document, say which on the same line (e.g. `CommonMark §6.1`).\n" +
    `spec:check   Deliberately not read: ${EXCLUDED_PATHS.map((excluded) => excluded.path).join(", ")}\n`,
);
process.exit(1);
