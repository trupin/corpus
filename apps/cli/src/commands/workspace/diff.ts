import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import { templateManifestPath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { suggest } from "../../suggest.js";
import {
  collectIncoming,
  shaOnDisk,
  workspaceFilePath,
  type ToolRoots,
} from "../../template/incoming.js";
import { readTemplateManifest } from "../../template/manifest.js";
import { planUpgrade, type UpgradeAction, type UpgradeDecision } from "../../template/plan.js";
import { unifiedDiff, type UnifiedDiff } from "./unified-diff.js";

/**
 * `corpus workspace diff` — what the tool changed underneath a file this
 * workspace edited (SPEC.md §2.4).
 *
 * `corpus workspace upgrade` refuses to overwrite an edited template file and
 * reports it as a **conflict**, which the signed rider defines as *unresolved
 * work rather than a notice*. Unresolved work needs one thing the report cannot
 * carry: what actually changed upstream. That is this verb, and it is the
 * command §2.4 names.
 *
 * **The audience is the agent.** So the output is an input to a merge decision,
 * not decoration, and everything here follows from that:
 *
 * - **Direction is stated three times** — in the `---`/`+++` labels, in the
 *   `diff.from`/`diff.to` keys under `--json`, and in a closing note. A merge
 *   applied backwards silently discards the tool's fix, and it is the one
 *   failure this verb can cause.
 * - **All three sides are named, always.** The baseline `corpus init` recorded,
 *   the workspace's copy, and the tool's — a three-way merge needs to know which
 *   two moved, and the manifest holds the answer. Note the shape of what is
 *   available: the manifest records the baseline's **sha**, not its bytes, and
 *   no older template ships with the tool. So the baseline is reachable as an
 *   identity — enough to tell "the tool moved" from "we moved" — and the diff
 *   itself is necessarily two-way.
 * - **The verdict is the upgrade's own.** `decide()` from `template/plan.ts`
 *   labels every path, so what this verb calls a conflict is by construction
 *   what an upgrade refuses to overwrite. A second implementation of that rule
 *   is exactly the drift the three-way logic exists to prevent.
 * - **Nothing normal is an error.** A clean file, a file the tool retired, a
 *   file this workspace deleted — all print plainly and exit 0. Only a path the
 *   tool does not install at all is refused, because an empty diff would read as
 *   "no difference" when the truth is "this verb has nothing to say about that
 *   file".
 *
 * It is **read-only** and needs no server: it opens two files and hashes a
 * third's record. That is the same bootstrap-class reasoning as
 * `corpus workspace upgrade` (SPEC.md §2.2 rule 4) — a workspace whose skills
 * are in conflict is exactly the workspace whose loop may not be running.
 */

/** Names the `---` side in every rendering. */
const WORKSPACE_SIDE = "workspace";

/** Names the `+++` side in every rendering. */
const TOOL_SIDE = "tool";

/** One side of the compare, as identity rather than as bytes. */
export interface DiffSide {
  /** False when the file is not there: deleted here, or retired from the tool. */
  readonly present: boolean;
  readonly sha256: string | null;
  /** `null` when there is no baseline to compare against. */
  readonly matchesBaseline: boolean | null;
}

/** What is known about one template-provenance path, diff aside. */
export interface WorkspaceDiffFile {
  /** Workspace-relative, POSIX-separated — the path `corpus workspace upgrade` prints. */
  readonly path: string;
  /** `"template"`, or `"plugin:<dir>"` for a plugin-contributed file. */
  readonly source: string;
  /** The upgrade's own verdict for this path, from `template/plan.ts`. */
  readonly action: UpgradeAction;
  /** Edited here **and** changed by the tool: unresolved work (SPEC.md §2.4). */
  readonly conflict: boolean;
  readonly baseline: string | null;
  readonly workspace: DiffSide;
  readonly tool: DiffSide;
}

export interface WorkspaceDiffBody {
  /** The side `-` lines belong to. */
  readonly from: typeof WORKSPACE_SIDE;
  /** The side `+` lines belong to. Applying the diff moves `from` toward `to`. */
  readonly to: typeof TOOL_SIDE;
  readonly text: string;
  readonly added: number;
  readonly removed: number;
  /** True when the compare degraded to a whole-file replacement (see `unified-diff.ts`). */
  readonly coarse: boolean;
}

/** `corpus workspace diff <path>`. */
export interface WorkspaceDiffReport extends WorkspaceDiffFile {
  readonly root: string;
  /** Version of the installed tool — the one shipping the `+++` side. */
  readonly toolVersion: string;
  /** Tool version the manifest recorded, or `null` when there is no manifest. */
  readonly baselineRecordedBy: string | null;
  /** `null` when there is nothing to diff: the sides agree, or the tool retired the file. */
  readonly diff: WorkspaceDiffBody | null;
}

/** `corpus workspace diff` with no path. */
export interface WorkspaceConflictList {
  readonly root: string;
  readonly toolVersion: string;
  readonly baselineRecordedBy: string | null;
  /** Every path an upgrade would report as `keep-modified`, in path order. */
  readonly conflicts: readonly WorkspaceDiffFile[];
}

export async function runWorkspaceDiff(
  context: WorkspaceCommandContext,
  roots: ToolRoots = {},
): Promise<void> {
  // The only wholly synchronous verb in the CLI — it opens two files and
  // returns. It stays `async` so that a refusal *rejects* rather than throwing
  // synchronously, which is what every caller of a handler expects.
  await Promise.resolve();

  const root = context.workspace.root;
  const manifest = readTemplateManifest(templateManifestPath(root));
  const incoming = collectIncoming(roots);
  const decisions = planUpgrade(manifest?.files ?? [], incoming, (path) => shaOnDisk(root, path));

  const common = {
    root,
    toolVersion: context.version,
    baselineRecordedBy: manifest?.tool ?? null,
  };

  const requested = context.args.optional("path");
  if (requested === undefined) {
    list(context, { ...common, conflicts: decisions.filter(conflicts).map(describe) });
    return;
  }

  const path = locate(requested, root, context.cwd, decisions);
  const decision = decisions.find((candidate) => candidate.path === path);
  if (decision === undefined) throw unknownPath(requested, decisions);

  const sources = new Map(incoming.map((file) => [file.path, file.from]));
  show(context, {
    ...common,
    ...describe(decision),
    diff: bodyFor(decision, root, sources.get(decision.path)),
  });
}

/** The rule SPEC.md §2.4 calls a conflict, in the upgrade's own vocabulary. */
function conflicts(decision: UpgradeDecision): boolean {
  return decision.action === "keep-modified";
}

function describe(decision: UpgradeDecision): WorkspaceDiffFile {
  const { baseline, workspace, incoming } = decision;
  return {
    path: decision.path,
    source: decision.source ?? "template",
    action: decision.action,
    conflict: conflicts(decision),
    baseline,
    workspace: side(workspace, baseline),
    tool: side(incoming, baseline),
  };
}

function side(sha: string | null, baseline: string | null): DiffSide {
  return {
    present: sha !== null,
    sha256: sha,
    matchesBaseline: baseline === null ? null : sha === baseline,
  };
}

/**
 * The diff, or `null` when there is none to compute. Both absences are real
 * answers rather than failures: the two sides already agree, or the tool no
 * longer ships the file and there is nothing on the `+++` side to diff against —
 * which is not the same as an empty file, and must not print as one.
 */
function bodyFor(
  decision: UpgradeDecision,
  root: string,
  from: string | undefined,
): WorkspaceDiffBody | null {
  if (decision.incoming === null || from === undefined) return null;
  if (decision.workspace === decision.incoming) return null;

  const here =
    decision.workspace === null ? "" : readFileSync(workspaceFilePath(root, decision.path), "utf8");
  const there = readFileSync(from, "utf8");
  const diff: UnifiedDiff = unifiedDiff(here, there, {
    from: `${WORKSPACE_SIDE}/${decision.path}`,
    to: `${TOOL_SIDE}/${decision.path}`,
  });
  return { from: WORKSPACE_SIDE, to: TOOL_SIDE, ...diff };
}

/**
 * The manifest path a request names.
 *
 * The workspace-relative POSIX form is what `corpus workspace upgrade` prints
 * and therefore what an agent copies, so it is tried first and verbatim. A path
 * typed by a person is resolved against the invoking directory instead — running
 * the verb from inside `.claude/skills/` and naming `comment/SKILL.md` is the
 * obvious thing to try, and failing it on a technicality would be a puzzle
 * rather than an answer.
 */
function locate(
  requested: string,
  root: string,
  cwd: string,
  decisions: readonly UpgradeDecision[],
): string {
  const known = new Set(decisions.map((decision) => decision.path));
  const direct = requested.replace(/^\.\//, "");
  if (known.has(direct)) return direct;

  const absolute = isAbsolute(requested) ? requested : resolve(cwd, requested);
  const inside = relative(root, absolute);
  if (inside !== "" && !inside.startsWith("..") && !isAbsolute(inside)) {
    return inside.split(sep).join("/");
  }
  return direct;
}

/**
 * A path outside the compare, refused with the reason.
 *
 * Deliberately not an empty diff: "no difference" and "this verb knows nothing
 * about that file" are opposite answers, and the second one dressed as the first
 * is how an agent concludes a file is clean when nobody ever looked at it.
 */
function unknownPath(requested: string, decisions: readonly UpgradeDecision[]): UsageError {
  const known = decisions.map((decision) => decision.path);
  const near = suggest(requested, known);
  return new UsageError(
    `"${requested}" is not a file the corpus tool installs, so there is nothing to compare it ` +
      "against.",
    {
      hint:
        "This verb compares template-provenance paths only — the files `corpus init` installed " +
        "and `corpus workspace upgrade` maintains, named as the upgrade prints them " +
        "(`.claude/skills/comment/SKILL.md`). Documents under `data/` are the server's; read " +
        "their history with `corpus doc diff`. Run `corpus workspace diff` with no path to list " +
        "the conflicting ones, or `corpus workspace upgrade --dry-run --json` for every path the " +
        "tool knows.",
      details: {
        path: requested,
        known: known.length,
        ...(near === undefined ? {} : { didYouMean: near }),
      },
    },
  );
}

function list(context: WorkspaceCommandContext, report: WorkspaceConflictList): void {
  context.out.emit(report);

  if (report.conflicts.length === 0) {
    context.out.line(
      "no conflicts: every file the tool installs is either untouched here or already agrees " +
        `with the copy corpus ${report.toolVersion} ships.`,
    );
    withoutBaselineNote(context, report.baselineRecordedBy);
    return;
  }

  context.out.line(
    `${plural(report.conflicts.length, "conflict")} — edited in this workspace and changed by ` +
      `corpus ${report.toolVersion}:`,
  );
  for (const file of report.conflicts) {
    context.out.line(`  ${file.path}${provenance(file)}`);
  }
  context.out.line(
    "each is unresolved work: nothing is merged automatically. See what the tool changed with " +
      "`corpus workspace diff <path>`.",
  );
  withoutBaselineNote(context, report.baselineRecordedBy);
}

function show(context: WorkspaceCommandContext, report: WorkspaceDiffReport): void {
  context.out.emit(report);

  context.out.line(`${report.path}${provenance(report)}`);
  context.out.line(`  ${verdict(report)}`);
  context.out.line(`  baseline  ${identity(report.baseline)}${baselineNote(report)}`);
  context.out.line(`  workspace ${identity(report.workspace.sha256)}${sideNote(report.workspace)}`);
  context.out.line(
    `  tool      ${identity(report.tool.sha256)}${sideNote(report.tool)} (corpus ${report.toolVersion})`,
  );

  if (report.diff === null) {
    withoutBaselineNote(context, report.baselineRecordedBy);
    return;
  }

  context.out.line("");
  for (const line of report.diff.text.replace(/\n$/, "").split("\n")) {
    context.out.line(line);
  }
  context.out.line("");
  context.out.line(
    `# \`-\` lines are ${WORKSPACE_SIDE}/, \`+\` lines are ${TOOL_SIDE}/: this diff reads ` +
      "workspace → tool, so applying it takes the tool's change and reversing it would discard " +
      "the tool's change instead. Nothing was written — this verb only reads.",
  );
  if (report.diff.coarse) {
    context.out.line(
      "# the two files were too far apart to align line by line, so the whole of one is shown " +
        "removed and the whole of the other added. The content is complete; only the pairing is not.",
    );
  }
  withoutBaselineNote(context, report.baselineRecordedBy);
}

/** What this path is, in one line, over every verdict the plan can return. */
function verdict(report: WorkspaceDiffReport): string {
  switch (report.action) {
    case "keep-modified":
      return report.baseline === null
        ? "conflict (no baseline) — this workspace's copy differs from the tool's, and with no " +
            "baseline an edited file cannot be told from an old one. Treat it as unresolved."
        : "conflict — edited here and changed by the tool. Nothing is merged automatically; " +
            "resolve it by editing the workspace's copy yourself.";
    case "update":
      return (
        "not a conflict — this workspace never edited it, so `corpus workspace upgrade` will " +
        "take the tool's copy for you."
      );
    case "keep-silent":
      return (
        "not a conflict — your edits only; the tool's copy has not moved since the baseline, so " +
        "there is nothing upstream to take."
      );
    case "current":
      return `identical to the copy corpus ${report.toolVersion} ships — nothing to merge.`;
    case "install":
      return (
        "the tool ships this and this workspace has never had it; `corpus workspace upgrade` " +
        "installs it. The whole file is shown as added."
      );
    case "restore-candidate":
      return (
        "deleted from this workspace; the tool still ships it. `corpus workspace upgrade " +
        "--restore` puts it back. The whole file is shown as added."
      );
    case "retired":
      return (
        "retired — the tool no longer ships this file, so there is nothing to diff against. " +
        "Your copy stays; an upgrade only drops its manifest entry."
      );
  }
}

function identity(sha: string | null): string {
  return sha === null ? "absent".padEnd(15) : `${sha.slice(0, 12)}…`.padEnd(15);
}

function baselineNote(report: WorkspaceDiffReport): string {
  if (report.baseline === null) {
    return "not recorded — no .corpus/template-manifest.json entry for this path";
  }
  return `recorded by corpus ${report.baselineRecordedBy ?? "(unknown version)"}`;
}

function sideNote(side: DiffSide): string {
  if (!side.present) return "not on disk";
  if (side.matchesBaseline === null) return "no baseline to compare against";
  return side.matchesBaseline ? "unchanged since the baseline" : "moved since the baseline";
}

function provenance(file: WorkspaceDiffFile): string {
  return file.source === "template" ? "" : ` [${file.source}]`;
}

/**
 * Said once, at the end, whenever there is no manifest: every verdict above was
 * reached without a baseline, so "edited here" is a guess rather than a fact.
 */
function withoutBaselineNote(context: WorkspaceCommandContext, recordedBy: string | null): void {
  if (recordedBy !== null) return;
  context.out.line(
    "note: this workspace has no .corpus/template-manifest.json, so nothing above knows what " +
      "was originally installed — a file that merely predates the current template reads the " +
      "same as one the agent edited. `corpus workspace upgrade --adopt` records a baseline.",
  );
}

export const workspaceDiffCommand: WorkspaceCommandSpec = {
  name: "diff",
  summary: "Show what the tool changed under a template file this workspace edited.",
  description:
    "`corpus workspace upgrade` never overwrites a template file the workspace has edited: it " +
    "reports it as a **conflict**, and a conflict is unresolved work rather than a notice " +
    "(SPEC.md §2.4). This is the verb that report points at — the one thing it cannot carry, " +
    "which is what actually changed upstream.\n\n" +
    "**With a path**, it prints the three identities the compare rests on — the baseline " +
    "`corpus init` recorded, the workspace's copy, and the copy the installed tool ships — and " +
    "then the unified diff between the last two. **With no path**, it lists every path currently " +
    "in conflict, so the work can be enumerated without re-running an upgrade.\n\n" +
    "**Direction is explicit, because a merge applied backwards discards the tool's change " +
    "silently.** The `---` side is `workspace/<path>`, the file on disk; the `+++` side is " +
    "`tool/<path>`, what the installed tool ships. `-` lines are the workspace's, `+` lines are " +
    "the tool's, and the diff reads workspace → tool. Under `--json` the same fact is a value " +
    'rather than prose: `diff.from` is `"workspace"` and `diff.to` is `"tool"`.\n\n' +
    "**The baseline is an identity, not bytes.** The manifest records its sha256 and no older " +
    "template ships inside the tool, so what is reachable here is _which sides moved_ — stated " +
    "per side as `matchesBaseline` — rather than a three-way text merge. That is the fact a " +
    "merge decision actually turns on: a `+` line that the baseline also lacked is the tool's " +
    "new work, and a workspace copy that still matches the baseline needs no merge at all.\n\n" +
    "**Nothing normal here is a failure.** A file with no conflict says which of the harmless " +
    "cases it is and exits 0 — identical to the tool's, edited here but unchanged upstream, " +
    "untouched here so the upgrade will simply update it. A file the tool has **retired** says " +
    "so and shows no diff, because there is nothing on the other side to compare against, which " +
    "is not the same as an empty file. A file this workspace deleted is shown as a whole-file " +
    "addition. Only a path the tool does not install at all is refused (exit 2), with the reason " +
    "— an empty diff there would read as _no difference_ when the truth is _nobody looked_.\n\n" +
    "It writes nothing, and it needs no running server: it reads two files and one manifest " +
    "entry. Merging is yours to do — Corpus never merges a skill automatically, because a skill " +
    "is prose that instructs the agent and a plausible-looking auto-merge would corrupt the " +
    "instructions the loop runs on.",
  args: [
    {
      name: "path",
      required: false,
      description:
        "The template file to compare, workspace-relative exactly as `corpus workspace upgrade` prints it (`.claude/skills/comment/SKILL.md`). A path relative to the current directory, or an absolute one inside the workspace, is accepted too. Omit it to list every path in conflict.",
    },
  ],
  flags: [],
  examples: [
    {
      command: "corpus workspace diff",
      description:
        "List the paths currently in conflict — the work an upgrade left unresolved, without re-running it.",
    },
    {
      command: "corpus workspace diff .claude/skills/comment/SKILL.md",
      description:
        "What the tool changed under an edited skill: the three shas, then the diff from this workspace's copy to the tool's.",
    },
    {
      command: "corpus workspace diff .claude/skills/comment/SKILL.md --json",
      description:
        'One JSON value: `{"root":"/home/me/notes","toolVersion":"0.3.0","baselineRecordedBy":"0.2.0",' +
        '"path":".claude/skills/comment/SKILL.md","source":"template","action":"keep-modified",' +
        '"conflict":true,"baseline":"9c0d…","workspace":{"present":true,"sha256":"5e6f…","matchesBaseline":false},' +
        '"tool":{"present":true,"sha256":"1a2b…","matchesBaseline":false},"diff":{"from":"workspace",' +
        '"to":"tool","text":"--- workspace/…\\n+++ tool/…\\n@@ -1,4 +1,5 @@\\n…","added":3,"removed":1,"coarse":false}}`.',
    },
  ],
  handler: (context) => runWorkspaceDiff(context),
};
