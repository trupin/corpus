import { writeFileSync } from "node:fs";
import { RefusedError, UsageError } from "../../errors.js";
import { plural } from "../../input.js";
import { templateManifestPath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { suggest } from "../../suggest.js";
import {
  readTemplateManifest,
  serializeManifest,
  type ManifestEntry,
  type TemplateManifest,
} from "../../template/manifest.js";
import { locateTemplatePath } from "./diff.js";

/**
 * `corpus workspace keep` / `corpus workspace unkeep` — the manifest's third
 * state: **deliberately diverged, stop reporting** (CLI-081).
 *
 * The manifest knew two states — matches baseline, or modified — so a
 * customization the template README itself invites ("rename them, reorder
 * them, add your own") was indistinguishable from accidental drift, and
 * `corpus workspace upgrade` re-reported it as a conflict on every run,
 * forever. Keeping a file records the divergence as chosen. The semantics,
 * each deliberate:
 *
 * - **Kept files are skipped by the upgrade's conflict report and never
 *   written.** Every run that has any still **names each kept path**, one
 *   quiet line apiece — SPEC.md §2.4 has the upgrade name each divergent file,
 *   and a silence that hid a growing list is the failure mode this verb
 *   refuses.
 * - **Keeping is not merging.** The manifest baseline goes on advancing to
 *   each incoming template copy while the file is kept, so un-keeping compares
 *   against the current template, not the one in force when the file was kept.
 * - **Kept is "stop nagging", never "stop being mergeable".** `corpus
 *   workspace merge` still merges a kept file on request, and merging does not
 *   clear the mark — they are separate acts on the same per-path state.
 *
 * The mark lives **in the manifest**, as an optional `kept` flag on the
 * entry, rather than in a file beside it: it is per-template-file state with
 * the entry's own lifecycle (an upgrade carries it forward, a retired entry
 * takes its mark with it), and one file with one reader is what keeps this
 * verb, the upgrade and the merge from ever disagreeing about who is kept.
 * The manifest is the one file under `.corpus/` the template machinery may
 * write, and — like `corpus init` — this verb leaves it uncommitted: a stock
 * workspace's `.gitignore` treats it as local state.
 *
 * Like `upgrade` and `diff`, no server is needed: the mark must be settable in
 * a workspace whose loop is broken, which is the workspace most likely to be
 * mid-upgrade.
 */

interface KeepReport {
  readonly root: string;
  /** Every kept path after this run, in manifest order. */
  readonly kept: readonly string[];
  /** The path this run acted on, or `null` for a bare listing. */
  readonly path: string | null;
  /** False when the mark was already in the requested state and nothing was written. */
  readonly changed: boolean;
}

export async function runWorkspaceKeep(context: WorkspaceCommandContext): Promise<void> {
  await Promise.resolve();
  const root = context.workspace.root;
  const requested = context.args.optional("path");

  if (requested === undefined) {
    const listed = readTemplateManifest(templateManifestPath(root));
    const kept = listed === undefined ? [] : keptPaths(listed);
    emit(context, { root, kept, path: null, changed: false });
    return;
  }

  const manifest = requireManifest(root);

  const path = resolveEntryPath(requested, root, context.cwd, manifest);
  const entry = manifest.files.find((candidate) => candidate.path === path);
  if (entry === undefined) throw notTracked(requested, manifest);

  if (entry.kept === true) {
    emit(context, { root, kept: keptPaths(manifest), path, changed: false });
    return;
  }

  const next = rewrite(manifest, path, (found) => ({ ...found, kept: true }));
  writeFileSync(templateManifestPath(root), serializeManifest(next), "utf8");
  emit(context, { root, kept: keptPaths(next), path, changed: true });
}

export async function runWorkspaceUnkeep(context: WorkspaceCommandContext): Promise<void> {
  await Promise.resolve();
  const root = context.workspace.root;
  const requested = context.args.get("path");

  const manifest = requireManifest(root);
  const path = resolveEntryPath(requested, root, context.cwd, manifest);
  const entry = manifest.files.find((candidate) => candidate.path === path);
  if (entry === undefined) throw notTracked(requested, manifest);

  if (entry.kept !== true) {
    context.out.emit({ root, path, kept: keptPaths(manifest), changed: false });
    context.out.line(`${path} is not kept — upgrades already report it. Nothing was written.`);
    return;
  }

  const next = rewrite(manifest, path, ({ kept: _kept, ...rest }) => rest);
  writeFileSync(templateManifestPath(root), serializeManifest(next), "utf8");
  context.out.emit({ root, path, kept: keptPaths(next), changed: true });
  context.out.line(
    `unkept ${path} — the next \`corpus workspace upgrade\` reports it against the current ` +
      "template, because the baseline kept advancing while it was kept.",
  );
}

function emit(context: WorkspaceCommandContext, report: KeepReport): void {
  context.out.emit(report);
  if (report.path === null) {
    renderList(context, report);
    return;
  }
  if (!report.changed) {
    context.out.line(`${report.path} is already kept. Nothing was written.`);
    return;
  }
  context.out.line(
    `kept ${report.path} — deliberately diverged. Upgrades stop reporting it and never write ` +
      "it; its baseline still follows the template. `corpus workspace merge` still merges it " +
      "on request, and `corpus workspace unkeep` resumes reporting.",
  );
  context.out.line(summaryLine(report.kept));
}

function renderList(context: WorkspaceCommandContext, report: KeepReport): void {
  if (report.kept.length === 0) {
    context.out.line("no kept files: every template file is reported when it diverges.");
    return;
  }
  context.out.line(`${summaryLine(report.kept)}:`);
  for (const path of report.kept) context.out.line(`  ${path}`);
}

function summaryLine(kept: readonly string[]): string {
  return `${plural(kept.length, "kept file")} in this workspace`;
}

function keptPaths(manifest: TemplateManifest): readonly string[] {
  return manifest.files.filter((entry) => entry.kept === true).map((entry) => entry.path);
}

function rewrite(
  manifest: TemplateManifest,
  path: string,
  change: (entry: ManifestEntry) => ManifestEntry,
): TemplateManifest {
  return {
    ...manifest,
    files: manifest.files.map((entry) => (entry.path === path ? change(entry) : entry)),
  };
}

function resolveEntryPath(
  requested: string,
  root: string,
  cwd: string,
  manifest: TemplateManifest,
): string {
  return locateTemplatePath(
    requested,
    root,
    cwd,
    new Set(manifest.files.map((entry) => entry.path)),
  );
}

/**
 * No manifest means nothing is template-tracked, so there is nothing a mark
 * could attach to. A refusal, not a usage error: the invocation was fine, and
 * the workspace's own state is what says no.
 */
function requireManifest(root: string): TemplateManifest {
  const manifest = readTemplateManifest(templateManifestPath(root));
  if (manifest === undefined) {
    throw new RefusedError(
      "this workspace has no .corpus/template-manifest.json, so no file is template-tracked " +
        "and none can be kept.",
      {
        code: "no_baseline",
        hint: "Run `corpus workspace upgrade --adopt` to record a baseline first.",
      },
    );
  }
  return manifest;
}

/**
 * TEST-1108's refusal, in as many words: the path is named back, the reason is
 * that it is not template-tracked, and nothing is written.
 */
function notTracked(requested: string, manifest: TemplateManifest): UsageError {
  const known = manifest.files.map((entry) => entry.path);
  const near = suggest(requested, known);
  return new UsageError(
    `"${requested}" is not template-tracked — the manifest has no entry for it — so there is ` +
      "no divergence to mark. Nothing was written.",
    {
      hint:
        "Only files the tool installed and the manifest records can be kept, named as " +
        "`corpus workspace upgrade` prints them (`.claude/skills/comment/SKILL.md`). " +
        "`corpus workspace upgrade --dry-run --json` lists every path the tool knows.",
      details: {
        path: requested,
        known: known.length,
        ...(near === undefined ? {} : { didYouMean: near }),
      },
    },
  );
}

export const workspaceKeepCommand: WorkspaceCommandSpec = {
  name: "keep",
  summary: "Mark a customized template file as deliberate, so upgrades stop reporting it.",
  description:
    "The workspace is invited to customize its template files — and " +
    "`corpus workspace upgrade` cannot tell a chosen divergence from an accidental one, so it " +
    "re-reports the same conflict on every run, forever. This verb records the third state: " +
    "**deliberately diverged, stop reporting.**\n\n" +
    "A kept file is skipped by the upgrade's conflict report and is **never written** by an " +
    "upgrade — not by an update, not by `--restore`. The report never goes silent about it, " +
    "though: every upgrade that runs while kept files exist names each kept path on one quiet " +
    "line, because a list that grows in silence is the failure this verb must not trade the " +
    "noise for.\n\n" +
    "**Keeping is not merging.** While a file is kept its manifest baseline keeps advancing to " +
    "each new template copy, so `corpus workspace unkeep` resumes reporting against the " +
    '**current** template — not the one in force when the file was kept. And kept is "stop ' +
    'nagging", never "stop being mergeable": `corpus workspace merge` merges a kept file on ' +
    "request, and merging does not clear the mark.\n\n" +
    "With no path it lists the kept files. A path the manifest does not track is refused (exit " +
    "2) with nothing written. The mark lives in `.corpus/template-manifest.json` and survives " +
    "upgrades; no server is needed.",
  args: [
    {
      name: "path",
      required: false,
      description:
        "The template file to keep, workspace-relative as `corpus workspace upgrade` prints it. " +
        "Omit it to list the kept files.",
    },
  ],
  flags: [],
  examples: [
    {
      command: "corpus workspace keep data/docs/boards/attention.md",
      description:
        "A board customized on purpose: upgrades stop reporting it, and its baseline still " +
        "follows the template.",
    },
    {
      command: "corpus workspace keep",
      description: "List every kept file, one path per line.",
    },
    {
      command: "corpus workspace keep --json",
      description:
        'One JSON value: `{"root":"/home/me/notes","kept":["data/docs/boards/attention.md"],' +
        '"path":null,"changed":false}` — `path` names the file acted on, or null for a listing.',
    },
  ],
  handler: (context) => runWorkspaceKeep(context),
};

export const workspaceUnkeepCommand: WorkspaceCommandSpec = {
  name: "unkeep",
  summary: "Clear a keep-mark, so upgrades report the file against the current template.",
  description:
    "The reverse of `corpus workspace keep`: the file stops being deliberately diverged and " +
    "`corpus workspace upgrade` reports it again. Because the baseline kept advancing while the " +
    "file was kept, the comparison is against the **current** template — un-keeping never " +
    "resurrects a conflict with a template version that is gone. A path the manifest does not " +
    "track is refused with nothing written; un-keeping a file that is not kept changes nothing " +
    "and says so.",
  args: [
    {
      name: "path",
      required: true,
      description: "The kept file, workspace-relative as `corpus workspace keep` lists it.",
    },
  ],
  flags: [],
  examples: [
    {
      command: "corpus workspace unkeep data/docs/boards/attention.md",
      description: "Resume reporting: the next upgrade compares it against the current template.",
    },
  ],
  handler: (context) => runWorkspaceUnkeep(context),
};
