import { MAX_PAGE_LIMIT, type CheckReport, type CheckRequest } from "@corpus/contract";
import { CheckFailedError, UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { collectStagedDocuments } from "../../staged.js";

/**
 * `corpus doc check` — SPEC.md §14's validator, on demand.
 *
 * §14's requirement is that there is exactly **one** validator: the same rules
 * that gate every save are what this verb reports. So the verb runs none of them
 * — it posts to `POST /api/check` and renders what comes back. Anything it
 * re-derived would be a second implementation, and a second implementation that
 * agreed with the first only until somebody changed one of them.
 *
 * Three input forms, and the difference between them is only *what is sent*:
 *
 * - **ids** — check the named documents, read from the workspace.
 * - **nothing** — the whole workspace: enumerate `GET /api/docs` with
 *   `includeArchived=true` (sprint-013 Adjudication 18 — "whole workspace" means
 *   the whole workspace, `.claude/skills-archived/` included) and post the ids.
 *   There is deliberately no server-side "check everything" form, so an empty
 *   request can never be mistaken for one.
 * - **`--staged`** — the pre-commit form, whose content is in git's index and
 *   therefore nowhere on disk. Those `(path, content)` pairs go through the
 *   `{documents}` branch. The collection is read-only git plumbing and lives in
 *   `src/staged.ts` (sprint-013 Adjudication 12).
 *
 * The verdict is the exit code: **6** when the report carries errors, **0**
 * otherwise. Warnings — an orphaned anchor, a `[[ref]]` whose target does not
 * exist yet — are printed and do not fail, because §14 makes both normal states
 * of a living corpus and a hook that punished them would be turned off.
 */

/** Whole-workspace enumeration walks at the server's page ceiling. */
const PAGE_LIMIT = MAX_PAGE_LIMIT;

export async function runDocCheck(context: WorkspaceCommandContext): Promise<void> {
  const ids = context.args.list("id");
  const staged = context.flags.boolean("staged");

  if (staged && ids.length > 0) {
    throw new UsageError(
      "`--staged` checks the content in git's index, so it cannot be combined with document ids.",
      { hint: "Run `corpus doc check --staged` on its own, or name ids without `--staged`." },
    );
  }

  const request: CheckRequest = staged
    ? { documents: [...(await collectStagedDocuments(context.workspace.root))] }
    : { ids: ids.length > 0 ? [...ids] : await enumerateWorkspace(context) };
  const checked = "ids" in request ? request.ids.length : request.documents.length;

  const report = await context.client.request((api) => api.POST("/api/check", { body: request }));
  context.out.emit(report);
  render(context, report, checked);
}

/**
 * Every document id in the workspace, by offset pagination (sprint-012
 * Adjudication 22: enumerate, then post — no third request branch was added to
 * the contract for this). `includeArchived=true` because a duplicate id between
 * an archived document and a live one is exactly the structural lie the checker
 * exists to catch.
 */
async function enumerateWorkspace(context: WorkspaceCommandContext): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const page = await context.client.request((api) =>
      api.GET("/api/docs", {
        params: { query: { limit: PAGE_LIMIT, offset, includeArchived: true } },
      }),
    );
    for (const row of page.items) ids.push(row.id);
    // A page shorter than asked for also ends the walk: a document deleted
    // mid-enumeration would otherwise leave `total` unreachable and loop.
    if (page.items.length === 0 || offset + PAGE_LIMIT >= page.page.total) return ids;
  }
}

function render(context: WorkspaceCommandContext, report: CheckReport, checked: number): void {
  // Nothing to check is not a result worth a line: a pre-commit hook with no
  // staged documents must stay silent and fast (and the server answered `200`
  // for the empty set, so this is a rendering choice, not a special case).
  if (checked === 0 && report.errors.length === 0 && report.warnings.length === 0) return;

  for (const finding of [...report.errors, ...report.warnings]) {
    context.out.line(`${finding.severity} ${finding.code} ${finding.path}: ${finding.detail}`);
  }

  const scope = plural(checked, "document");
  if (report.errors.length > 0) {
    throw new CheckFailedError(
      `${plural(report.errors.length, "error")} in ${scope}${warningTail(report)}.`,
      { hint: "Fix the findings above; warnings alone would not have failed the check." },
    );
  }
  context.out.line(
    report.warnings.length === 0
      ? `checked ${scope} — no findings.`
      : `checked ${scope} — ${plural(report.warnings.length, "warning")}, no errors.`,
  );
}

function warningTail(report: CheckReport): string {
  return report.warnings.length === 0 ? "" : `, plus ${plural(report.warnings.length, "warning")}`;
}

export const checkCommand: WorkspaceCommandSpec = {
  name: "check",
  summary: "Validate documents against the SPEC.md §14 rules; exit 6 on errors.",
  description:
    "Runs the corpus validator through `POST /api/check` — the **same** implementation every " +
    "server mutation runs before writing, which is what §14 requires — and turns its verdict " +
    "into an exit code: **6** when anything failed, **0** when nothing did. Warnings are printed " +
    "and never fail: an orphaned anchor and a `[[ref]]` whose target does not exist yet are " +
    "normal states of a living corpus (§14), and a hook that blocked on them would be switched " +
    "off. Findings print one per line as `severity code path: detail`, and `--json` emits the " +
    "server's report — `{ok, errors, warnings}` — unchanged, with the exit code unaffected.\n\n" +
    "With ids, exactly those documents are read from the workspace and checked. With no ids, the " +
    "whole workspace is enumerated first (archived documents included, so " +
    "`.claude/skills-archived/` is covered) and checked in one request. With `--staged`, the " +
    "content comes from git's **index** rather than from disk — the pre-commit form — and only " +
    "staged paths under the document roots are sent; nothing in git is changed and nothing is " +
    "written anywhere. Combining `--staged` with ids is a usage error (exit 2): they answer " +
    "different questions and silently dropping one would leave the caller guessing.\n\n" +
    "One rule this verb cannot report by id: `duplicate-id` needs two files claiming one id, and " +
    "an id resolves to a single document, so neither the id form nor the whole-workspace form " +
    "can surface it. `corpus db doctor` is that surface.",
  args: [
    {
      name: "id",
      required: false,
      variadic: true,
      description: "Documents to check. Omit them to check the whole workspace.",
    },
  ],
  flags: [
    {
      name: "staged",
      type: "boolean",
      description:
        "Check the content staged in git instead of what is on disk — what a pre-commit hook " +
        "wants, since the bytes about to be committed are not the bytes in the working tree. " +
        "Nothing staged means no output and exit 0.",
    },
  ],
  examples: [
    {
      command: "corpus doc check",
      description:
        "Validate the whole workspace, archived documents and skills included; exits 6 if anything failed.",
    },
    {
      command: "corpus doc check doc_a1b2c3 doc_d4e5f6",
      description: "Validate two documents before building on them.",
    },
    {
      command: "corpus doc check --staged",
      description:
        "The pre-commit form: validate exactly what is about to be committed, silently and quickly when nothing is staged.",
    },
    {
      command: "corpus doc check --json",
      description:
        'One JSON value: `{"ok":false,"errors":[{"code":"anchor-unused","severity":"error",' +
        '"docId":"doc_a1b2c3","path":"data/docs/notes/plan.md","detail":"anchor anc_1 belongs to ' +
        'no thread"}],"warnings":[]}`.',
    },
  ],
  handler: (context) => runDocCheck(context),
};
