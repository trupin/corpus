import { CheckFailedError } from "../../errors.js";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";

/**
 * `corpus db doctor` — reports every disagreement between the workspace's files
 * and the projection's rows (SPEC.md §11), and turns the verdict into an exit
 * code: **6 on drift, 0 when clean**. Six rather than one because a drifted
 * projection is a successful check with a negative answer, which is exactly the
 * distinction a pre-commit hook needs.
 *
 * Nothing is repaired here. A drifted projection is reported and left alone —
 * the point of the check is that drift is visible — and `corpus db rebuild` is
 * the repair.
 */

export async function runDbDoctor(context: WorkspaceCommandContext): Promise<void> {
  const report = await context.client.request((api) => api.GET("/api/db/doctor"));
  context.out.emit(report);

  // Report-only findings, printed before the verdict and never part of it: a
  // warning says something is worth a person's attention and the projection is
  // nonetheless right about it, so it moves neither `ok` nor the exit code
  // (SERVER-038). One line per finding, in the drift lines' voice.
  for (const warning of report.warnings ?? []) {
    context.out.line(`${warning.kind} ${warning.path ?? "(no file)"}: ${warning.detail}`);
  }

  if (report.ok) {
    const { stats } = report;
    context.out.line(
      `projection is clean — ${plural(stats.documents, "document")} from ${plural(stats.files, "file")} (${String(stats.durationMs)}ms)`,
    );
    return;
  }

  for (const drift of report.drift) {
    context.out.line(`${drift.kind} ${drift.path ?? "(no file)"}: ${drift.detail}`);
  }
  throw new CheckFailedError(
    `the projection has drifted from the files — ${plural(report.drift.length, "finding")}.`,
    { hint: "Re-derive it from the files with `corpus db rebuild`." },
  );
}

export const doctorCommand: WorkspaceCommandSpec = {
  name: "doctor",
  summary: "Check the projection against the files; exit 6 on drift.",
  description:
    "Compares every document file with the row the projection holds for it and reports what " +
    "disagrees — a missing row, an orphan row, a content mismatch, a count mismatch, an " +
    "unparseable file, a duplicate id (SPEC.md §11). Cheap enough for a pre-commit hook: a file " +
    "whose size and mtime are unchanged is never re-read. Exits **6** when anything drifted and " +
    "**0** when nothing did, so a hook can gate on the code alone; the findings are printed one " +
    "per line, and `--json` emits the server's report — `{ok, drift, stats}` — untouched. " +
    "Nothing is repaired: run `corpus db rebuild` for that. On a live server the file watcher " +
    "heals an out-of-band edit within about a second, so a clean report right after one is " +
    "correct rather than surprising.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus db doctor",
      description: "Verify the projection still matches the files; exits 6 if it does not.",
    },
    {
      command: "corpus db rebuild && corpus db doctor",
      description: "SPEC.md §11's standing invariant: a rebuild is followed by a clean check.",
    },
    {
      command: "corpus db doctor --json",
      description:
        'One JSON value: `{"ok":true,"drift":[],"stats":{"files":18,"documents":18,…}}`.',
    },
  ],
  handler: (context) => runDbDoctor(context),
};
