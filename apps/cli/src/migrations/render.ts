import { plural } from "../input.js";
import type { Output } from "../output.js";
import type { DetectedMigration } from "./registry.js";

/**
 * The migrations section of an upgrade report (SPEC.md §2.4 rider 8, CLI-061).
 *
 * One renderer, called by both `corpus upgrade` and `corpus workspace upgrade`,
 * for the same reason `conflictResolutionCommand` is one function: a caller who
 * hits `--pinned`'s refusal is sent to `corpus upgrade`, and must find the same
 * words there. Two renderings of the same finding is how they stop agreeing.
 *
 * The shape is the conflicts block's, deliberately: blank line, a heading that
 * says how many and what they are, then one indented block per entry — the
 * statement, then the commands, one per line, pasteable as printed. §2.4 asks
 * for migrations "listed distinctly from updates and conflicts", and an agent
 * that already parses the conflicts block gets this one for free.
 *
 * Unlike conflicts it **always prints something**. A section that vanished when
 * empty would be indistinguishable from a version of the tool that does not
 * report migrations at all, and "nothing to migrate" is the answer an operator
 * ran the upgrade to get.
 *
 * Under `--json` it prints nothing: `out.line` is suppressed there, and the
 * `migrations` key carries exactly this.
 */
export function renderMigrations(
  out: Output,
  migrations: readonly DetectedMigration[] | null,
  record: (line: string) => void = () => undefined,
): void {
  for (const line of migrationLines(migrations)) {
    out.line(line);
    record(line);
  }
}

export function migrationLines(migrations: readonly DetectedMigration[] | null): readonly string[] {
  // `null` is "no workspace was inspected" — `corpus upgrade` run outside one,
  // or a run whose template sync failed before it got this far. Saying "none"
  // there would be a claim about files nothing looked at.
  if (migrations === null) return [];
  if (migrations.length === 0) {
    return ["migrations: none — every document is written the way this tool reads it."];
  }
  return [
    "",
    `${plural(migrations.length, "data migration")} — these files are written for a version of ` +
      "the tool that no longer reads them as they are. Run the commands below, or ask the agent " +
      "to. Nothing here was performed:",
    ...migrations.flatMap((migration) => [
      `  ${migration.id}: ${migration.statement}`,
      ...migration.commands.map((command) => `    ${command}`),
      ...(migration.optional.length === 0
        ? []
        : [
            "    optional — these keys are dead weight, and nothing breaks if they stay:",
            ...migration.optional.map((command) => `      ${command}`),
          ]),
    ]),
  ];
}
