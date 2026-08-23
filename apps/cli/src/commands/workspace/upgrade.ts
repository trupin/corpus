import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { QUEUE_EVENT_STATUSES, type Actor } from "@corpus/contract";
import { InternalError } from "../../errors.js";
import { plural } from "../../input.js";
import { renderMigrations } from "../../migrations/render.js";
import { detectMigrations, type DetectedMigration } from "../../migrations/registry.js";
import type { Output } from "../../output.js";
import { TEMPLATE_MANIFEST_FILE, templateManifestPath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { collectIncoming, shaOnDisk, type ToolRoots } from "../../template/incoming.js";
import {
  readTemplateManifest,
  serializeManifest,
  type TemplateManifest,
} from "../../template/manifest.js";
import {
  isReported,
  nextManifestFiles,
  planUpgrade,
  writes,
  type IncomingFile,
  type UpgradeAction,
  type UpgradeDecision,
} from "../../template/plan.js";
import { CONFIG_DIR, DEFAULT_DATA_DIR } from "../../workspace.js";
import { commitPaths, gitExitCode, gitFailure, identityFor, runGit } from "../init/git.js";
import { ensureMaintenanceSettings, missingMaintenanceSettings } from "./maintenance.js";

/**
 * `corpus workspace upgrade` — bringing an existing workspace's template files
 * up to the installed tool's, without ever destroying what the workspace made
 * its own (SPEC.md §2.1).
 *
 * The problem is specific: `corpus init` copies the agent's skills into the
 * workspace, and from that moment they are **the workspace's documents**. The
 * agent evolves them; they are its memory. A later `npm update` of the tool
 * therefore cannot simply re-copy — that would delete work — and cannot simply
 * do nothing either, or a fix to a core-loop skill never reaches anybody. The
 * answer is the three-way compare in `../../template/plan.ts`: the one cell that
 * overwrites is "the workspace never touched this file, and the tool changed
 * it". Everything else is reported and left alone.
 *
 * This is the second of SPEC.md §2.2 rule 4's two bootstrap-class exceptions to
 * "the server is the sole writer": like `corpus init`, it writes files directly
 * and commits directly, because it must work with the server stopped — a
 * workspace whose skills are broken is exactly the workspace whose loop cannot
 * be asked to fix them. With the server running, the watcher sees the writes as
 * ordinary out-of-band edits and re-projects (rule 1). Nothing outside
 * template-provenance paths is touched, and everything lands in **one**
 * attributed commit — which is what makes a bad upgrade undoable in one move:
 * `git revert` that commit in the workspace. There is no verb for it, because
 * SPEC.md §7's loop safety is an ordinary write whose content came from history,
 * and with a broken loop and no server the operator's git is the only writer
 * left anyway.
 *
 * Order matters at the end: files are written first and committed last. A commit
 * that fails leaves correct files on disk and in `git status`, which is
 * recoverable; undoing the writes to keep git tidy is what would not be.
 */

/** Workspace-relative path of the one file under `.corpus/` an upgrade may write. */
const MANIFEST_RELATIVE_PATH = `${CONFIG_DIR}/${TEMPLATE_MANIFEST_FILE}`;

/** How each reported verdict is labelled, and the order the plan prints them in. */
const ACTION_LABELS: Readonly<Record<UpgradeAction, string>> = {
  update: "update",
  install: "install",
  "keep-modified": "keep",
  "restore-candidate": "deleted",
  retired: "retired",
  "keep-silent": "keep",
  current: "current",
};

/**
 * The label a verdict prints under. Everything reads as "what this run did"
 * except in a workspace with no baseline, where **no** run writes a workspace
 * file: there an `install` is something the operator still has to make happen,
 * so it is labelled `pending` rather than claiming an install that never
 * occurred (CLI-014).
 */
function labelFor(action: UpgradeAction, withoutBaseline: boolean): string {
  return withoutBaseline && action === "install" ? "pending" : ACTION_LABELS[action];
}

const ACTION_ORDER: readonly UpgradeAction[] = [
  "update",
  "install",
  "keep-modified",
  "restore-candidate",
  "retired",
];

export interface ReportedChange {
  readonly path: string;
  readonly action: UpgradeAction;
  /** One line of why, for the verdicts a person has to judge. */
  readonly detail?: string;
}

/**
 * Queue status directories whose `.gitkeep` is missing, workspace-relative.
 *
 * `corpus init` writes one marker per `QUEUE_EVENT_STATUSES` entry
 * (`../init/scaffold.ts`) so the skeleton survives a clone — the event files
 * inside are runtime state, the markers are what git tracks. A workspace
 * initialized before a status was added therefore never gains its directory,
 * and the state has nowhere to live on a fresh checkout: exactly what happened
 * to `deferred` when CONTRACT-021 added it (SHARED-003 ledger, sprint-017
 * Adjudication 10).
 *
 * Driven from the contract's enum, never a hardcoded list, so the next status
 * added does not reopen this.
 */
export function missingQueueMarkers(root: string): readonly string[] {
  return QUEUE_EVENT_STATUSES.map((status) => `${CONFIG_DIR}/queue/${status}/.gitkeep`).filter(
    (relative) => !existsSync(join(root, ...relative.split("/"))),
  );
}

/** Creates the missing markers, empty, and returns what it wrote. */
function healQueueSkeleton(root: string, missing: readonly string[]): readonly string[] {
  for (const relative of missing) {
    const absolute = join(root, ...relative.split("/"));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, "", "utf8");
  }
  return missing;
}

/**
 * The markers git will accept. A workspace whose `.gitignore` predates the
 * template's `!.corpus/queue/` negation ignores the whole directory, and
 * `git add` of an ignored path **fails the command** — so an old workspace's
 * ignore rules would turn a repair into a crash. The marker is still created;
 * it simply is not staged, and {@link render} says so, because the operator's
 * `.gitignore` is theirs to change and overriding it with `-f` is not this
 * verb's call.
 */
async function trackableMarkers(
  root: string,
  markers: readonly string[],
): Promise<readonly string[]> {
  const kept: string[] = [];
  for (const marker of markers) {
    if (!(await isIgnoredByRules(root, marker))) kept.push(marker);
  }
  return kept;
}

export interface UpgradeReport {
  readonly workspace: string;
  /** Tool version the manifest recorded, or `null` when there is no manifest. */
  readonly fromVersion: string | null;
  readonly toVersion: string;
  readonly dryRun: boolean;
  /**
   * Nothing to report and nothing to write: the run made no commit, not even an
   * empty one. A field rather than an inference from four other fields, because
   * `corpus upgrade` (SPEC.md §2.4) folds this report into its own and has to be
   * able to say "the workspace was already current" without re-deriving it.
   */
  readonly upToDate: boolean;
  /** True when the workspace has no manifest: nothing is overwritten, whatever the plan says. */
  readonly withoutBaseline: boolean;
  readonly changes: readonly ReportedChange[];
  /**
   * Queue-skeleton markers this run created — empty in a workspace that already
   * has all of them, which is every workspace `corpus init` made since the last
   * status was added.
   */
  readonly queueSkeleton: readonly string[];
  /**
   * Markers the workspace's own `.gitignore` excludes, so they were **not**
   * staged — and under `--dry-run`, would not be. Empty in a stock workspace,
   * whose `.gitignore` carries the template's `!.corpus/queue/` negation.
   */
  readonly queueSkeletonIgnored: readonly string[];
  /** Paths this run actually wrote, workspace-relative. */
  readonly written: readonly string[];
  readonly manifestWritten: boolean;
  /**
   * Whether the manifest went into the commit. False in a stock workspace: the
   * template's `.gitignore` treats all of `.corpus/` as runtime state, and
   * `corpus init` leaves the manifest untracked for the same reason.
   */
  readonly manifestCommitted: boolean;
  /** The commit this run made, or `null` when it made none. */
  readonly commit: string | null;
  /**
   * Repository-local git settings this run wrote to take git's background
   * maintenance out of the workspace (CLI-037) — what it *would* write under
   * `--dry-run`. Empty in a workspace that already carries them, which is every
   * workspace created since. This is how an **existing** workspace is brought
   * under the rule without waiting for its next server start, and why the
   * settings are not merely written by `corpus init`: `init` runs once, and a
   * workspace made last week is in the hazardous configuration now.
   */
  readonly maintenanceSettings: readonly string[];
  /**
   * **Data migrations** this workspace needs (SPEC.md §2.4 rider 8, CLI-061) —
   * files the installed tool no longer reads as they are written, each carrying
   * the commands that perform it. Always present, `[]` when nothing fires.
   *
   * Reported, never performed: that is the rider, and it is why nothing on this
   * path acts on them. It also does not touch {@link UpgradeReport.upToDate} or
   * the exit code — a migration is the agent's work, not the upgrade's failure,
   * and a workspace whose template files are current can still need one.
   */
  readonly migrations: readonly DetectedMigration[];
}

/**
 * The tool-side roots, named so tests can point them at a scratch tree — the
 * same seam `runInit` takes, and the same one `corpus workspace diff` reads.
 */
export type UpgradeDependencies = ToolRoots;

/**
 * Everything the sync needs, with no `Output` among it.
 *
 * The verb used to read its inputs off a `WorkspaceCommandContext` and write its
 * findings straight to `context.out`, which made it uncallable from anywhere
 * else: `corpus upgrade` (SPEC.md §2.4) performs this same sync as one step of a
 * larger run, and needs the report as a *value* to fold into its own — not a
 * second JSON document on stdout. Splitting the decision from the rendering is
 * what makes §2.4's "the same code path, called, not reimplemented" literally
 * true rather than aspirational.
 */
export interface WorkspaceUpgradeRequest {
  readonly root: string;
  /** Version of the tool doing the installing — recorded in the manifest. */
  readonly version: string;
  /** Git author of the single commit this run makes. */
  readonly actor: Actor;
  readonly dryRun?: boolean;
  readonly restore?: boolean;
  readonly adopt?: boolean;
  /**
   * `dataDir` from the workspace config — where the migration detectors look for
   * `docs/`. Defaults to the config's own default, so a caller that does not
   * care keeps working; every real call passes the workspace's value.
   */
  readonly dataDir?: string;
}

export async function runWorkspaceUpgrade(
  context: WorkspaceCommandContext,
  dependencies: UpgradeDependencies = {},
): Promise<void> {
  const report = await applyWorkspaceUpgrade(
    {
      root: context.workspace.root,
      version: context.version,
      actor: context.actor,
      dryRun: context.flags.boolean("dry-run"),
      restore: context.flags.boolean("restore"),
      adopt: context.flags.boolean("adopt"),
      dataDir: context.workspace.dataDir,
    },
    dependencies,
  );
  context.out.emit(report);
  renderUpgradeReport(context.out, report);
  // Last, and outside `renderUpgradeReport`: `corpus upgrade` renders that
  // report *nested*, under a "workspace template:" heading, and a data migration
  // is not a template file. §2.4 wants it listed distinctly, which means at the
  // end of the report rather than inside one of its sections.
  renderMigrations(context.out, report.migrations);
}

export async function applyWorkspaceUpgrade(
  request: WorkspaceUpgradeRequest,
  dependencies: UpgradeDependencies = {},
): Promise<UpgradeReport> {
  const root = request.root;
  const dryRun = request.dryRun ?? false;
  const restore = request.restore ?? false;
  const adopt = request.adopt ?? false;

  const manifest = readTemplateManifest(templateManifestPath(root));
  // Without a manifest there is no baseline, so "the workspace never touched
  // this" is unknowable and nothing may be overwritten — however confidently the
  // matrix would otherwise decide. `--adopt` is how an operator supplies one.
  const withoutBaseline = manifest === undefined;

  const incoming = collectIncoming(dependencies);
  const decisions = planUpgrade(manifest?.files ?? [], incoming, (path) => shaOnDisk(root, path));

  // Not a template file and not part of the three-way compare: a status
  // directory is either there or it is not, so healing it needs no baseline and
  // can overwrite nothing. It is reported and committed with the run's own work.
  const queueSkeleton = missingQueueMarkers(root);

  // The §2.4 vehicle for an existing workspace (CLI-037). Applied here rather
  // than in the plan because it is not a template file and needs no baseline —
  // a repository either carries these settings or it does not — and applied
  // *before* the early "already up to date" return, so a workspace with nothing
  // else to upgrade is still brought under the rule. It never packs: an upgrade
  // is allowed to run with the server up, and packing beside the sole writer is
  // the exact race this repairs.
  const maintenanceSettings = dryRun
    ? await missingMaintenanceSettings(root)
    : await ensureMaintenanceSettings(root).catch((cause: unknown) => {
        throw gitFailure("configuring the workspace repository's maintenance", cause);
      });

  const report: UpgradeReport = {
    workspace: root,
    fromVersion: manifest?.tool ?? null,
    toVersion: request.version,
    dryRun,
    upToDate: false,
    withoutBaseline,
    changes: describe(decisions, root, incoming, withoutBaseline),
    queueSkeleton,
    queueSkeletonIgnored: [],
    written: [],
    manifestWritten: false,
    manifestCommitted: false,
    commit: null,
    maintenanceSettings,
    // Read-only, off disk, and computed before any early return: a workspace
    // whose template files are already current is exactly the workspace whose
    // *data* may still be written for the version before this one (SPEC.md §2.4
    // rider 8). It is also why this is not gated on `dryRun` — detecting a
    // migration writes nothing in either mode.
    migrations: detectMigrations({
      root,
      dataDir: request.dataDir ?? DEFAULT_DATA_DIR,
      actor: request.actor,
    }),
  };

  const pending = decisions.filter((decision) => writes(decision.action, restore));
  if (
    report.changes.length === 0 &&
    pending.length === 0 &&
    queueSkeleton.length === 0 &&
    !(withoutBaseline && adopt)
  ) {
    // An empty commit every time somebody checks would be noise in the one
    // history that is supposed to mean something.
    return { ...report, upToDate: true };
  }

  if (dryRun) {
    // The plan has to predict the *whole* outcome, including the part a real run
    // would refuse. `isIgnoredByRules` asks git about the rules rather than about
    // the index, so it answers for a marker that does not exist yet — which is
    // the only reason a dry run can tell the truth here at all (wave-3 audit,
    // TEST 31: this was hard-coded empty, so `--dry-run` promised a repair the
    // real run then declined to commit).
    const trackable = await trackableMarkers(root, queueSkeleton);
    return {
      ...report,
      queueSkeletonIgnored: queueSkeleton.filter((marker) => !trackable.includes(marker)),
    };
  }

  if (withoutBaseline && !adopt) {
    // No template file may be written here, but the skeleton is not a template
    // file — so it is healed and committed on its own rather than waiting for a
    // baseline the operator may never supply.
    const healed = healQueueSkeleton(root, queueSkeleton);
    const trackable = await trackableMarkers(root, healed);
    const partial: UpgradeReport = {
      ...report,
      written: healed,
      queueSkeletonIgnored: healed.filter((marker) => !trackable.includes(marker)),
    };
    const commit = trackable.length === 0 ? null : await commitUpgrade(request, trackable, partial);
    return { ...partial, commit };
  }

  // The plan runs first so that a workspace whose `.gitignore` this run
  // refreshes is judged by the **new** rules below: the shipped template is what
  // carries the `!.corpus/queue/` negation the markers need to be trackable at
  // all.
  const applied = withoutBaseline ? [] : applyPlan(root, pending, incoming);
  const healed = healQueueSkeleton(root, queueSkeleton);
  const written = [...applied, ...healed];
  const nextManifest: TemplateManifest = {
    version: 1,
    tool: request.version,
    installedAt: new Date().toISOString(),
    // What was written, never what was planned: under `--adopt` the plan is not
    // applied at all, and recording its incoming shas would put paths in the
    // manifest that are not on disk (CLI-014).
    files: nextManifestFiles(decisions, new Set(written)),
  };
  mkdirSync(join(root, CONFIG_DIR), { recursive: true });
  writeFileSync(templateManifestPath(root), serializeManifest(nextManifest), "utf8");

  // The workspace's own `.gitignore` decides whether the manifest is part of the
  // commit. The shipped template ignores all of `.corpus/` as runtime state, so
  // in a stock workspace it is not — exactly as `corpus init` leaves it. Asking
  // git rather than assuming means a workspace that *does* track it gets the
  // manifest in the same commit as the files it describes, with no code change
  // here, and neither case is achieved by overriding the operator's `.gitignore`.
  const manifestCommitted = !(await isIgnored(root, MANIFEST_RELATIVE_PATH));
  const trackable = await trackableMarkers(root, healed);
  const staged = [...applied, ...trackable, ...(manifestCommitted ? [MANIFEST_RELATIVE_PATH] : [])];

  const result: UpgradeReport = {
    ...report,
    written,
    queueSkeletonIgnored: healed.filter((marker) => !trackable.includes(marker)),
    manifestWritten: true,
    manifestCommitted,
  };
  const commit = staged.length === 0 ? null : await commitUpgrade(request, staged, result);
  return { ...result, commit };
}

/**
 * Whether the workspace's own `.gitignore` excludes a path. `check-ignore` exits
 * `0` when it matches and `1` when it does not, so the exit code *is* the
 * answer; anything else is a real git failure and is rethrown.
 */
async function isIgnored(root: string, relative: string): Promise<boolean> {
  try {
    await runGit(["check-ignore", "--quiet", "--", relative], root);
    return true;
  } catch (cause) {
    if (gitExitCode(cause) === 1) return false;
    throw gitFailure("checking whether the workspace tracks its template manifest", cause);
  }
}

/**
 * Whether the workspace's ignore **rules** exclude a path, index or no index.
 *
 * Deliberately a second predicate rather than a flag on {@link isIgnored}: plain
 * `check-ignore` answers "is this path ignored", and git's answer for anything
 * already in the index is *no* — while `git add` still refuses it, and refusing
 * fails the whole command. For a marker inside a directory an old `.gitignore`
 * excludes, that difference is the difference between reporting a repair and
 * crashing the upgrade, so the staging decision asks the rules directly.
 */
async function isIgnoredByRules(root: string, relative: string): Promise<boolean> {
  try {
    await runGit(["check-ignore", "--no-index", "--quiet", "--", relative], root);
    return true;
  } catch (cause) {
    if (gitExitCode(cause) === 1) return false;
    throw gitFailure("checking whether the workspace ignores its queue skeleton", cause);
  }
}

/** Copies the bytes for every writing verdict and returns what it wrote. */
function applyPlan(
  root: string,
  pending: readonly UpgradeDecision[],
  incoming: readonly IncomingFile[],
): readonly string[] {
  const sources = new Map(incoming.map((file) => [file.path, file.from]));
  const written: string[] = [];

  for (const decision of pending) {
    const from = sources.get(decision.path);
    if (from === undefined) continue;
    const to = join(root, ...decision.path.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    written.push(decision.path);
  }
  return written;
}

function describe(
  decisions: readonly UpgradeDecision[],
  root: string,
  incoming: readonly IncomingFile[],
  withoutBaseline: boolean,
): readonly ReportedChange[] {
  const sources = new Map(incoming.map((file) => [file.path, file.from]));
  const rank = (action: UpgradeAction): number => ACTION_ORDER.indexOf(action);

  return decisions
    .filter((decision) => isReported(decision.action))
    .sort((one, other) => rank(one.action) - rank(other.action) || (one.path < other.path ? -1 : 1))
    .map((decision) => ({
      path: decision.path,
      action: decision.action,
      ...detailFor(decision, root, sources.get(decision.path), withoutBaseline),
    }));
}

function detailFor(
  decision: UpgradeDecision,
  root: string,
  from: string | undefined,
  withoutBaseline: boolean,
): { detail?: string } {
  // Without a baseline no run writes a workspace file — `--adopt` included — so
  // an `install` verdict here is a prediction, not something that happened
  // (CLI-014). It is labelled `pending` and says what makes it real.
  if (withoutBaseline && decision.action === "install") {
    return {
      detail:
        "the tool has it, this workspace does not; nothing is written without a baseline, " +
        "so --adopt first, then upgrade again to install it",
    };
  }
  switch (decision.action) {
    case "keep-modified":
      return { detail: `modified here — ${lineSummary(root, decision.path, from)}` };
    case "restore-candidate":
      return { detail: "deleted from this workspace; pass --restore to reinstall it" };
    case "retired":
      return { detail: "dropped from the template; your copy stays, the manifest entry goes" };
    default:
      return {};
  }
}

/**
 * One line of "how far apart are these", counted rather than diffed: how many
 * lines exist only in the workspace copy and only in the incoming one. It is
 * labelled as a count and not as a diff on purpose — a hunk-level diff is
 * `git diff` between the two files, and a multiset comparison calling itself one
 * would be the kind of small lie that gets trusted.
 */
function lineSummary(root: string, path: string, from: string | undefined): string {
  if (from === undefined) return "no incoming copy to compare against";
  const here = readLines(join(root, ...path.split("/")));
  const there = readLines(from);
  return `${plural(countMissing(here, there), "line")} only here, ${plural(
    countMissing(there, here),
    "line",
  )} only in the new copy`;
}

function readLines(absolute: string): readonly string[] {
  return readFileSync(absolute, "utf8").split("\n");
}

/** Lines of `from` that `against` does not also carry, counting repeats. */
function countMissing(from: readonly string[], against: readonly string[]): number {
  const remaining = new Map<string, number>();
  for (const line of against) remaining.set(line, (remaining.get(line) ?? 0) + 1);

  let missing = 0;
  for (const line of from) {
    const left = remaining.get(line) ?? 0;
    if (left === 0) missing += 1;
    else remaining.set(line, left - 1);
  }
  return missing;
}

async function commitUpgrade(
  request: WorkspaceUpgradeRequest,
  paths: readonly string[],
  report: UpgradeReport,
): Promise<string | null> {
  const message =
    `workspace: upgrade template files ${report.fromVersion ?? "(no baseline)"} → ` +
    `${report.toVersion} by ${request.actor}`;
  try {
    return await commitPaths({
      dir: report.workspace,
      message,
      paths,
      identity: identityFor(request.actor),
    });
  } catch (cause) {
    // Loudly, and without undoing anything: the files are already correct on
    // disk and visible in `git status`, which is a recoverable state. Reverting
    // them to keep git tidy is the state that would not be.
    throw new InternalError(
      `${gitFailure("the workspace upgrade commit", cause).message} The upgraded files are written and uncommitted — nothing was lost.`,
      {
        hint: `Inspect them with \`git -C ${report.workspace} status\` and commit them yourself, or re-run the upgrade.`,
        details: { written: report.written },
        cause,
      },
    );
  }
}

/**
 * The verdict that means **conflict** — the workspace edited this file and the
 * tool changed it too, so the upgrade wrote nothing and the difference is
 * somebody's to resolve (SPEC.md §2.4).
 *
 * Named once, from `decide()`'s own vocabulary, and read by both verbs that have
 * to agree about it: this one, and `corpus upgrade`. A second spelling of "which
 * of these is unresolved work" is precisely the drift the shared three-way rule
 * exists to prevent.
 */
export const CONFLICT_ACTION: UpgradeAction = "keep-modified";

export function conflictsOf(report: UpgradeReport): readonly ReportedChange[] {
  return report.changes.filter((change) => change.action === CONFLICT_ACTION);
}

/**
 * The command §2.4 names as the one that shows the difference behind a conflict
 * (`corpus workspace diff <path>`, CLI-027). Built here rather than written out
 * at each call site so the report and the verb cannot disagree about the
 * spelling — a conflict report whose command does not run is worse than none.
 */
export function conflictResolutionCommand(path: string): string {
  return `corpus workspace diff ${path}`;
}

/**
 * A report as text. Exported because `corpus upgrade` performs this sync as one
 * step of a larger run and renders the same report inside its own output — the
 * alternative being a second rendering of the same verdicts, which would drift.
 */
export function renderUpgradeReport(out: Output, report: UpgradeReport): void {
  // First, and outside the up-to-date short-circuit: a workspace whose template
  // files are current can still be the one whose repository was left open to
  // git's background maintenance, and "already up to date." would be a lie about
  // the thing that just changed.
  if (report.maintenanceSettings.length > 0) {
    out.line(
      `git: ${report.dryRun ? "would turn" : "turned"} off git's own background maintenance in ` +
        `this repository (${report.maintenanceSettings.join(", ")}) — corpus packs it at server ` +
        "start instead",
    );
  }
  if (report.upToDate) {
    out.line("already up to date.");
    return;
  }
  renderUpgradeReportBody(out, report);
}

function renderUpgradeReportBody(out: Output, report: UpgradeReport): void {
  if (report.withoutBaseline) {
    out.line(
      `no ${MANIFEST_RELATIVE_PATH} in this workspace — without the baseline it recorded, an ` +
        "unmodified file cannot be told from an edited one, so nothing will be overwritten.",
    );
  }
  out.line(
    `${report.dryRun ? "plan" : "upgrade"} (tool ${report.fromVersion ?? "unknown"} → ${report.toVersion}):`,
  );
  for (const change of report.changes) {
    const detail = change.detail === undefined ? "" : ` — ${change.detail}`;
    out.line(
      `  ${labelFor(change.action, report.withoutBaseline).padEnd(7)} ${change.path}${detail}`,
    );
    // A conflict is unresolved work rather than a notice (SPEC.md §2.4), and
    // unresolved work needs the one thing this line cannot carry: what actually
    // changed upstream. So every one of them names the verb that shows it.
    if (change.action === CONFLICT_ACTION) {
      out.line(`${" ".repeat(10)}unresolved — ${conflictResolutionCommand(change.path)}`);
    }
  }
  for (const marker of report.queueSkeleton) {
    out.line(
      `  ${(report.dryRun ? "pending" : "create").padEnd(7)} ${marker} — queue status directory ` +
        "this workspace predates; it has to be tracked or a clone arrives without it",
    );
  }
  if (report.queueSkeletonIgnored.length > 0) {
    const one = report.queueSkeletonIgnored.length === 1;
    out.line(
      `  ${plural(report.queueSkeletonIgnored.length, "marker")} above ` +
        `${one ? "is" : "are"} excluded by this workspace's .gitignore, so ` +
        (report.dryRun
          ? `${one ? "it would be" : "they would be"} created but not committed`
          : `${one ? "it was" : "they were"} created but not committed`) +
        " — allow `.corpus/queue/` through (the shipped template does, with " +
        "`!.corpus/queue/`) and re-run.",
    );
  }

  if (report.dryRun) {
    out.line("nothing was written (--dry-run).");
    return;
  }
  if (report.withoutBaseline) {
    if (!report.manifestWritten) {
      out.line(
        (report.queueSkeleton.length === 0
          ? "nothing was written"
          : `${plural(report.queueSkeleton.length, "queue status directory", "queue status directories")} ` +
            `${report.queueSkeleton.length === 1 ? "was" : "were"} created${
              report.commit === null ? "" : ` in commit ${report.commit}`
            }; no template file was written`) +
          ". Re-run with --adopt to record a baseline from the files that already match.",
      );
      return;
    }
    out.line(
      "wrote a fresh baseline manifest; files that already match the tool's copies are now " +
        "tracked, and the ones that differ stay untracked because nothing can tell an old copy " +
        "from an edited one." +
        (report.commit === null ? "" : ` Commit ${report.commit}.`),
    );
    const pending = report.changes.filter((change) => change.action === "install").length;
    if (pending > 0) {
      out.line(
        `  --adopt installs nothing, so ${plural(pending, "file")} the tool carries and this ` +
          "workspace does not have stayed out of the manifest as well as off the disk. Run " +
          "`corpus workspace upgrade` again, now that there is a baseline, to install " +
          `${pending === 1 ? "it" : "them"}.`,
      );
    }
    return;
  }
  out.line(
    report.commit === null
      ? // Restoring a file that was deleted but never committed puts the tree
        // back exactly as HEAD already has it; there is genuinely nothing to record.
        `wrote ${plural(report.written.length, "file")}; git had nothing new to record.`
      : `wrote ${plural(report.written.length, "file")} in commit ${report.commit}.`,
  );
  if (!report.manifestCommitted) {
    out.line(
      `  ${MANIFEST_RELATIVE_PATH} was updated but is not tracked by this workspace's .gitignore, ` +
        "so it is not in that commit — the same state `corpus init` leaves it in.",
    );
  }
}

export const upgradeCommand: WorkspaceCommandSpec = {
  name: "upgrade",
  summary: "Refresh the workspace's template files after a tool update, without clobbering edits.",
  description:
    "`corpus init` copies the agent's skills into the workspace, and from that moment they are " +
    "the workspace's own documents — the agent evolves them, and they are its memory (SPEC.md " +
    "§2.1). A later tool update therefore cannot re-copy them blindly. This verb three-way " +
    "compares each file the tool installs: the baseline `corpus init` recorded, the copy in the " +
    "workspace now, and the copy the installed tool carries. A file the workspace never touched " +
    "is **updated**; a file the workspace changed is **kept and reported**, never overwritten; a " +
    "file new to the template is **installed**; a file the workspace deleted is reported and " +
    "reinstalled only under `--restore`; a file the template dropped is reported as retired, its " +
    "copy left alone. Everything lands in **one** commit attributed to `--from`, naming the old " +
    "and new tool versions — so a bad upgrade is undone in one move, by reverting that commit in " +
    "the workspace with git. A run with nothing to do prints `already up to date.` and makes no " +
    "commit.\n\n" +
    "Only template-provenance paths are touched — `.claude/` skills and personas, the workspace " +
    "`README.md` and `.gitignore`, the seed documents under `data/docs/` the template installs " +
    "— and nothing under `.corpus/` except the manifest itself and a missing queue status " +
    "directory.\n\n" +
    "One thing is repaired rather than compared: a workspace initialized before a queue status " +
    "existed has no `.corpus/queue/<status>/.gitkeep` for it, so the directory does not survive " +
    "a clone and that state has nowhere to live on a fresh checkout. Any missing marker is " +
    "created and committed — it needs no baseline, because a directory is either there or it is " +
    "not, and an empty marker overwrites nothing.\n\n" +
    "One more repair needs no baseline and makes no commit: a workspace created before Corpus " +
    "took git's **background maintenance** out of its repository has it back on. Since git 2.29 " +
    "every `git commit` ends by spawning a detached `git maintenance run --auto`, and a repack " +
    "racing the server's commits can leave the object store permanently corrupt. Any missing " +
    "setting is written here, because `corpus init` runs once and a workspace made last week is " +
    "in that state now. The repository is never **packed** here — an upgrade may run with the " +
    "server up, and packing beside the sole writer is the race being repaired; packing happens " +
    "at `corpus server start` and in `corpus workspace maintain`.\n\n" +
    "**Data migrations are reported, never performed.** A release that stops reading a " +
    "frontmatter key leaves every existing workspace written for the release before it, so the " +
    "report ends with a `migrations` section: one block per migration, a line saying what the " +
    "tool no longer reads, and the commands that perform it, ready to paste (SPEC.md §2.4). The " +
    "section says `none` when nothing fires, and a migration never changes the exit code — it is " +
    "work for the agent, not a failure of the upgrade. Under `--json` it is the `migrations` " +
    "array. Every command in it is safe to run twice.\n\n" +
    "This command and `corpus init` are the only two that write workspace files directly and " +
    "commit directly (SPEC.md §2.2 rule 4): both are bootstrap-class and must work with the " +
    "server stopped, because a workspace whose skills are broken is exactly the one whose loop " +
    "cannot be asked to fix them. With the server running, the watcher treats the writes as " +
    "ordinary out-of-band edits and re-projects. Every other document mutation goes through the " +
    "server — the rule is not soft.",
  args: [],
  flags: [
    {
      name: "dry-run",
      type: "boolean",
      description:
        "Print the full plan and write nothing at all — no files, no manifest, no commit.",
    },
    {
      name: "restore",
      type: "boolean",
      description:
        "Also reinstall template files this workspace deleted. Without it they are reported and left absent, because deleting one is usually deliberate.",
    },
    {
      name: "adopt",
      type: "boolean",
      description:
        "For a workspace created before manifests existed: record a baseline from the files that already match the tool's copies. It writes **no** workspace file — not even one the tool carries and this workspace has never had, which is reported as `pending` and stays out of the manifest. Files that differ stay untracked and keep being reported, since nothing can tell an old copy from an edited one. Once the baseline exists, an ordinary `corpus workspace upgrade` installs what is missing.",
    },
  ],
  examples: [
    {
      command: "corpus workspace upgrade --dry-run",
      description: "See exactly what a tool update would change before it changes anything.",
    },
    {
      command: "corpus workspace upgrade --from user",
      description:
        "Apply the plan: update untouched files, keep and report edited ones, in one attributed commit.",
    },
    {
      command: "corpus workspace upgrade --restore",
      description: "Also put back template files that were deleted from this workspace.",
    },
    {
      command: "corpus workspace upgrade --json",
      description:
        'One JSON value: `{"workspace":"/home/me/notes","fromVersion":"0.1.0","toVersion":"0.2.0",' +
        '"dryRun":false,"withoutBaseline":false,"changes":[{"path":".claude/skills/comment/SKILL.md",' +
        '"action":"keep-modified","detail":"modified here — 3 lines only here, 1 line only in the new copy"}],' +
        '"written":[".claude/skills/orchestrate/SKILL.md"],"manifestWritten":true,"commit":"9f3c1ab",' +
        '"migrations":[{"id":"views-to-board","statement":"…","commands":["corpus doc create --type board …"],' +
        '"optional":[]}]}`.',
    },
  ],
  handler: (context) => runWorkspaceUpgrade(context),
};
