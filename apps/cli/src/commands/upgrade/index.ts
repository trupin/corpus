import type { Actor, UpgradeCheck } from "@corpus/contract";
import { createClient } from "../../client.js";
import {
  InternalError,
  RefusedError,
  WorkspaceConfigError,
  isCliError,
  toProblem,
} from "../../errors.js";
import { plural, resolveActor } from "../../input.js";
import { createNestedOutput, type Output } from "../../output.js";
import { serverPidfilePath } from "../../paths.js";
import type {
  CommandContext,
  StandaloneCommandSpec,
  WorkspaceCommandContext,
} from "../../registry/types.js";
import type { ToolRoots } from "../../template/incoming.js";
import { findWorkspaceRoot, resolveWorkspace, type Workspace } from "../../workspace.js";
import { inspectServer, probeHealth } from "../server/state.js";
import { runStart } from "../server/start.js";
import { runStop } from "../server/stop.js";
import {
  applyWorkspaceUpgrade,
  conflictResolutionCommand,
  conflictsOf,
  renderUpgradeReport,
  type UpgradeReport,
} from "../workspace/upgrade.js";
import {
  detectInstallMethod,
  discardDownload,
  downloadAndVerify,
  installedVersionAt,
  isWritable,
  npmInstall,
  refuseUndetectable,
  refuseUnwritable,
  type InstallMethod,
  type NpmRunner,
} from "./install.js";
import { openJournal, silentJournal, type Journal } from "./journal.js";
import { evaluateRelease, lookupLatestRelease, releaseSource } from "./release.js";

/**
 * `corpus upgrade` — the whole tool, upgraded by one command (SPEC.md §2.4).
 *
 * The verb exists because "upgrade" was three separate things a person had to
 * know to do in the right order: install the new release, bring the workspace's
 * template files up to it, and restart the server so what is serving matches
 * what is on disk. Splitting them across three commands made the *second* one
 * invisible — the agent's skills quietly stayed at the version they were
 * installed at, which is the gap the workspace half of the signed rider names.
 *
 * **The order is the design, and it is stated because each step depends on the
 * one before it:**
 *
 * 1. *Ask what is running*, before anything changes. §2.4 restarts the server
 *    "if — and only if — the workspace's server was running when the upgrade
 *    began", and after the install that question is unanswerable.
 * 2. *Check, and refuse early.* An unverifiable release, an install method that
 *    cannot be detected, an unwritable prefix — all decided before a byte is
 *    downloaded, so a refusal costs nothing and changes nothing.
 * 3. *Download and verify.* The bytes are proven before they reach the disk, so
 *    a mismatch leaves no file behind.
 * 4. *Stop the server*, if it was running. Before the install rather than after,
 *    because npm rewrites `node_modules` underneath a live process — including
 *    the packages the server loads lazily.
 * 5. *Install.*
 * 6. *Template sync*, through `applyWorkspaceUpgrade` — the same three-way rule
 *    `corpus workspace upgrade` applies, called rather than reimplemented, so a
 *    file the workspace edited is structurally impossible to overwrite here.
 *    It runs against the **new** tool's files: the install replaced them in
 *    place, and the template is read from disk on every call.
 * 7. *Restart*, so the server that comes back is the same generation as the
 *    files on disk. It runs even if step 6 failed — a workspace whose sync broke
 *    still needs its server.
 *
 * **A conflict is not a notice.** A file this workspace edited that the tool
 * also changed is never merged and never overwritten: a skill is prose that
 * instructs the agent, and a plausible-looking auto-merge would corrupt the
 * instructions the loop runs on. It is reported apart from everything that
 * merely happened, as a list an agent can read without parsing prose, each entry
 * naming `corpus workspace diff <path>` (CLI-027).
 */

/** How long the release list may take. Short: it is one small JSON document. */
export const CHECK_TIMEOUT_MS = 15_000;
/** How long the tarball may take. Long: it is tens of megabytes over somebody's hotel wifi. */
export const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** How long npm may take. Long: it compiles native modules. */
export const INSTALL_TIMEOUT_MS = 15 * 60_000;

export interface UpgradeConflict {
  /** Workspace-relative, exactly as `corpus workspace diff` accepts it. */
  readonly path: string;
  /** `"template"`, or `"plugin:<dir>"` when the file comes from a plugin. */
  readonly source: string;
  /** How far apart the two copies are, in the upgrade's own words. */
  readonly detail: string | null;
  /** The command that shows the difference — runnable as printed. */
  readonly resolve: string;
}

export interface ToolReport {
  /** Whether a new tool was actually installed by this run. */
  readonly installed: boolean;
  readonly from: string;
  readonly to: string | null;
  readonly method: InstallMethod["kind"];
  readonly prefix: string | null;
  /** The install command, as run — `null` when nothing was installed. */
  readonly command: string | null;
  readonly tarball: {
    readonly name: string;
    readonly sha256: string;
    readonly bytes: number;
  } | null;
}

export interface ServerReport {
  readonly wasRunning: boolean;
  readonly stopped: boolean;
  readonly restarted: boolean;
  readonly detail: string | null;
}

export interface UpgradeResult {
  readonly mode: "check" | "upgrade";
  /** The release comparison, in the same shape `GET /api/upgrade/check` publishes. */
  readonly check: UpgradeCheck;
  readonly tool: ToolReport;
  /** Absolute workspace root, or `null` when the command ran outside one. */
  readonly workspace: string | null;
  /** Why there is no workspace half, when there is none. */
  readonly workspaceDetail: string | null;
  /** The template sync's own report — a dry-run plan under `--check`. */
  readonly template: UpgradeReport | null;
  /** Set when the install succeeded and the sync did not. */
  readonly templateFailure: { readonly message: string; readonly hint: string | null } | null;
  /**
   * Unresolved work, always present and always its own key — `[]` when there is
   * none. §2.4: conflicts are "listed distinctly from the things that merely
   * happened, so an agent running an upgrade can tell what it must still act on
   * without parsing prose".
   */
  readonly conflicts: readonly UpgradeConflict[];
  readonly server: ServerReport | null;
  /** Workspace-relative path of the written report, or `null` when none was written. */
  readonly reportPath: string | null;
}

export interface UpgradeEffects {
  readonly fetch?: typeof globalThis.fetch;
  readonly packageRoot?: string;
  readonly platform?: NodeJS.Platform;
  /** Overrides detection outright, for tests that must not depend on where they run. */
  readonly installMethod?: InstallMethod;
  readonly npm?: NpmRunner;
  /** Tool-side template roots, so a test can simulate "the new tool ships this". */
  readonly template?: ToolRoots;
  readonly serverRunning?: (context: WorkspaceCommandContext) => Promise<boolean>;
  readonly stopServer?: (context: WorkspaceCommandContext) => Promise<void>;
  readonly startServer?: (context: WorkspaceCommandContext) => Promise<void>;
  readonly now?: () => Date;
}

export async function runUpgrade(
  context: CommandContext,
  effects: UpgradeEffects = {},
): Promise<void> {
  const checkOnly = context.flags.boolean("check");
  const actor = resolveActor(context.flags, context.env);
  const located = locateWorkspace(context);
  const nested = createNestedOutput(context.out);
  const workspaceContext =
    located.workspace === null
      ? null
      : workspaceContextFor(context, located.workspace, actor, nested.output);

  // Before anything else: §2.4 restarts the server only if it "was running when
  // the upgrade began", and every later step is capable of changing the answer.
  const wasRunning =
    workspaceContext === null
      ? false
      : await (effects.serverRunning ?? serverIsRunning)(workspaceContext);

  const source = releaseSource(context.env);
  const verdict = evaluateRelease(
    context.version,
    await lookupLatestRelease({
      fetch: effects.fetch ?? globalThis.fetch,
      api: source.api,
      repo: source.repo,
      version: context.version,
      timeoutMs: CHECK_TIMEOUT_MS,
    }),
  );
  const method =
    effects.installMethod ?? detectInstallMethod(effects.packageRoot, effects.platform);

  if (checkOnly) {
    await reportCheck(context, { located, verdict, method, effects, actor, nested });
    return;
  }

  const journal =
    located.workspace === null
      ? silentJournal
      : openJournal({
          root: located.workspace.root,
          startedAt: (effects.now ?? (() => new Date()))(),
          from: context.version,
          to: verdict.check.latest ?? "(unknown)",
        });

  try {
    await performUpgrade(context, {
      located,
      workspaceContext,
      wasRunning,
      verdict,
      method,
      effects,
      actor,
      nested,
      journal,
    });
  } catch (error) {
    // A detached run's only witness is this file, so a refusal is recorded in it
    // exactly like a success — an upgrade that declined and said nothing anywhere
    // readable is indistinguishable from one that never started.
    journal.note(`failed: ${isCliError(error) ? error.message : String(error)}`);
    journal.finish({ error: toProblem(error) });
    throw error;
  }
}

interface Located {
  readonly workspace: Workspace | null;
  readonly detail: string | null;
}

/**
 * The workspace, if there is a usable one — and never a failure if there is not.
 *
 * `corpus upgrade` upgrades the *tool*, which is installed once and shared by
 * every workspace on the machine, so refusing to run outside one would make the
 * common case ("upgrade my corpus") depend on being in the right directory. What
 * a missing workspace costs is the two halves that are about a workspace: the
 * template sync and the restart. Both are reported as skipped, with the reason.
 */
function locateWorkspace(context: CommandContext): Located {
  const start = context.flags.string("workspace") ?? context.env.CORPUS_WORKSPACE ?? context.cwd;
  if (findWorkspaceRoot(start) === undefined) {
    return {
      workspace: null,
      detail: `no workspace above ${start}, so no template sync and no server restart`,
    };
  }
  try {
    return {
      workspace: resolveWorkspace({
        cwd: context.cwd,
        env: context.env,
        workspaceFlag: context.flags.string("workspace"),
      }),
      detail: null,
    };
  } catch (cause) {
    // A broken config must not block a tool upgrade — it is quite often what the
    // upgrade is being run to fix.
    if (cause instanceof WorkspaceConfigError) {
      return { workspace: null, detail: `${cause.message}; the workspace half was skipped` };
    }
    throw cause;
  }
}

/** The context the lifecycle verbs and the template sync expect, built by hand. */
function workspaceContextFor(
  context: CommandContext,
  workspace: Workspace,
  actor: Actor,
  out: Output,
): WorkspaceCommandContext {
  return {
    ...context,
    out,
    workspace,
    actor,
    client: createClient({
      workspace,
      actor,
      ...(context.flags.number("timeout") === undefined
        ? {}
        : { timeoutMs: context.flags.number("timeout") as number }),
    }),
  };
}

async function serverIsRunning(context: WorkspaceCommandContext): Promise<boolean> {
  const state = await inspectServer({
    pidfilePath: serverPidfilePath(context.workspace.root),
    probe: () => probeHealth(context.client, context.workspace.root),
  });
  // Only `running` counts. A stale pidfile, a wedged pid, or another workspace's
  // server on our port are all states `corpus server start` refuses to act on,
  // and an upgrade must not turn one of them into a spawned process.
  return state.kind === "running";
}

interface Stage {
  readonly located: Located;
  readonly verdict: ReturnType<typeof evaluateRelease>;
  readonly method: InstallMethod;
  readonly effects: UpgradeEffects;
  readonly actor: Actor;
  readonly nested: ReturnType<typeof createNestedOutput>;
}

/**
 * `--check`: says what a full run would do, and writes nothing at all — not the
 * tarball, not the template, not even the report file. That includes the
 * workspace half: the plan is computed as a dry run, against the tool installed
 * *now*, because the files a newer tool would ship do not exist on this machine
 * until it has been installed. Saying so is more useful than pretending.
 */
async function reportCheck(context: CommandContext, stage: Stage): Promise<void> {
  const template =
    stage.located.workspace === null
      ? null
      : await applyWorkspaceUpgrade(
          {
            root: stage.located.workspace.root,
            version: context.version,
            actor: stage.actor,
            dryRun: true,
          },
          stage.effects.template ?? {},
        );

  const result: UpgradeResult = {
    mode: "check",
    check: stage.verdict.check,
    tool: {
      installed: false,
      from: context.version,
      to: stage.verdict.check.latest,
      method: stage.method.kind,
      prefix: stage.method.kind === "npm-global" ? stage.method.prefix : null,
      command: null,
      tarball: null,
    },
    workspace: stage.located.workspace?.root ?? null,
    workspaceDetail: stage.located.detail,
    template,
    templateFailure: null,
    conflicts: conflictsFrom(template),
    server: null,
    reportPath: null,
  };

  context.out.emit(result);
  renderCheck(context.out, result, stage.method);
}

interface RunStage extends Stage {
  readonly workspaceContext: WorkspaceCommandContext | null;
  readonly wasRunning: boolean;
  readonly journal: Journal;
}

async function performUpgrade(context: CommandContext, stage: RunStage): Promise<void> {
  const { verdict, method, effects, journal } = stage;
  const say = (line: string): void => {
    context.out.line(line);
    journal.note(line);
  };

  if (!verdict.check.reachable) {
    throw new RefusedError(
      `could not check for a newer release: ${verdict.check.detail ?? "unknown"}`,
      {
        code: "upgrade_unreachable",
        hint: "Nothing was downloaded or installed. Check the network and run `corpus upgrade` again.",
      },
    );
  }

  if (!verdict.check.upgradeAvailable) {
    await reportAlreadyCurrent(context, stage, say);
    return;
  }

  const assets = verdict.assets;
  if (!verdict.check.verifiable || assets === null) {
    throw new RefusedError(
      `release ${verdict.check.latest ?? "?"} cannot be verified, so it will not be installed`,
      {
        code: "upgrade_unverifiable",
        hint:
          "SPEC.md §2.4 verifies a release's published checksum before installing it. Install this one by hand if you " +
          "trust it, or wait for a release that publishes one.",
        details: { detail: verdict.check.detail },
      },
    );
  }

  if (method.kind === "undetectable") throw refuseUndetectable(method, assets.tarball.url);
  if (!isWritable(method.globalRoot)) throw refuseUnwritable(method, assets.tarball.url);

  say(`corpus ${context.version} → ${verdict.check.latest ?? "?"}`);

  const download = await downloadAndVerify({
    fetch: effects.fetch ?? globalThis.fetch,
    assets,
    version: context.version,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
  say(
    `  verified ${assets.tarball.name} (${formatBytes(download.bytes)}, sha256 ${download.sha256.slice(0, 12)}…)`,
  );

  const server: {
    wasRunning: boolean;
    stopped: boolean;
    restarted: boolean;
    detail: string | null;
  } = {
    wasRunning: stage.wasRunning,
    stopped: false,
    restarted: false,
    detail: stage.wasRunning
      ? null
      : "it was not running when the upgrade began, so it was left stopped",
  };

  let template: UpgradeReport | null = null;
  let templateFailure: UpgradeResult["templateFailure"] = null;
  // A record rather than a `let`: the install command is written on one path and
  // read on another, with a `finally` in between, and a plain variable is either
  // dead on initialisation or possibly-unassigned at the read.
  const installed: { command: string | null; version: string | null } = {
    command: null,
    version: null,
  };
  let failure: Error | undefined;

  // Each nested step speaks for itself — `corpus server stop` already says
  // `stopped (pid 4711)` — so the composite prints their lines rather than a
  // second sentence about the same event. It only has to copy them into the
  // report file, which the parent output cannot do for it: under `--json` those
  // lines are suppressed on stdout, and the file is where a detached run's
  // account has to be complete.
  let drained = 0;
  const drain = (): void => {
    const lines = stage.nested.lines();
    for (const line of lines.slice(drained)) journal.note(`  ${line}`);
    drained = lines.length;
  };

  try {
    if (stage.workspaceContext !== null && stage.wasRunning) {
      // npm rewrites the package directory this process is running from, and the
      // server loads some of its dependencies lazily; a live server through that
      // is a crash waiting for the wrong moment.
      await (effects.stopServer ?? runStop)(stage.workspaceContext);
      server.stopped = true;
      drain();
    }

    const install = await (effects.npm ?? npmInstall)({
      method,
      tarballPath: download.path,
      env: context.env,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    installed.command = install.command;
    // What is on disk now, read back rather than assumed. The release's tag and
    // the tarball's own manifest are two claims, and only the second one is what
    // the operator will be running a second from now.
    installed.version = installedVersionAt(method.packageRoot) ?? verdict.check.latest;
    say(`  installed ${installed.version ?? "?"} with \`${install.command}\``);
    if (installed.version !== null && installed.version !== verdict.check.latest) {
      say(
        `  note: the release was published as ${verdict.check.latest ?? "?"} but its package declares ` +
          `${installed.version}; the installed version is the one reported here.`,
      );
    }

    if (stage.workspaceContext !== null) {
      try {
        // The template is read from the tool's own directory on every call, and
        // npm has just replaced it, so this compares against the *new* copies.
        template = await applyWorkspaceUpgrade(
          {
            root: stage.workspaceContext.workspace.root,
            version: installed.version ?? context.version,
            actor: stage.actor,
          },
          effects.template ?? {},
        );
        say("  workspace template:");
        renderUpgradeReport(stage.nested.output, template);
        drain();
      } catch (cause) {
        // Loudly, and without pretending the run succeeded: the tool moved and
        // the workspace did not, which is a state somebody has to finish.
        templateFailure = {
          message: cause instanceof Error ? cause.message : String(cause),
          hint: isCliError(cause) ? (cause.hint ?? null) : null,
        };
        say(
          `  the tool is now ${installed.version ?? "?"} but this workspace's template files were NOT updated: ` +
            templateFailure.message,
        );
        say(
          "  fix the cause and run `corpus workspace upgrade` — the tool half does not need repeating.",
        );
        failure = cause instanceof Error ? cause : new InternalError(String(cause));
      }
    }
  } finally {
    // Whatever happened above, a server that was running is put back. A failed
    // sync is a reason to tell somebody, not a reason to leave the board down.
    if (stage.workspaceContext !== null && server.stopped) {
      try {
        await (effects.startServer ?? runStart)(stage.workspaceContext);
        server.restarted = true;
        drain();
      } catch (cause) {
        server.detail = `the server did not come back: ${cause instanceof Error ? cause.message : String(cause)}`;
        say(`  ${server.detail} — start it with \`corpus server start\``);
      }
    }
    discardDownload(download);
  }

  const result: UpgradeResult = {
    mode: "upgrade",
    check: verdict.check,
    tool: {
      installed: true,
      from: context.version,
      to: installed.version,
      method: method.kind,
      prefix: method.prefix,
      command: installed.command,
      tarball: { name: assets.tarball.name, sha256: download.sha256, bytes: download.bytes },
    },
    workspace: stage.located.workspace?.root ?? null,
    workspaceDetail: stage.located.detail,
    template,
    templateFailure,
    conflicts: conflictsFrom(template),
    server,
    reportPath: journal.relativePath,
  };

  renderConflicts(context.out, result.conflicts, (line) => {
    journal.note(line);
  });
  if (journal.relativePath !== null) {
    context.out.line(`report written to ${journal.relativePath}`);
  }
  journal.finish(result);
  context.out.emit(result);

  // Emitted first, then rethrown: the machine-readable half of a partly-finished
  // upgrade is exactly what its caller needs, and losing it to the failure would
  // leave nothing but a message.
  if (failure !== undefined) throw failure;
}

/**
 * Already on the newest release. §2.4's promise here is that the run **touches
 * nothing** — so the template is inspected as a dry run and reported, never
 * applied. A workspace whose files have drifted from an already-current tool is
 * `corpus workspace upgrade`'s business, and this says so rather than doing it
 * silently under a command the operator asked to upgrade the *tool*.
 */
async function reportAlreadyCurrent(
  context: CommandContext,
  stage: RunStage,
  say: (line: string) => void,
): Promise<void> {
  const template =
    stage.located.workspace === null
      ? null
      : await applyWorkspaceUpgrade(
          {
            root: stage.located.workspace.root,
            version: context.version,
            actor: stage.actor,
            dryRun: true,
          },
          stage.effects.template ?? {},
        );

  const result: UpgradeResult = {
    mode: "upgrade",
    check: stage.verdict.check,
    tool: {
      installed: false,
      from: context.version,
      to: stage.verdict.check.latest,
      method: stage.method.kind,
      prefix: stage.method.kind === "npm-global" ? stage.method.prefix : null,
      command: null,
      tarball: null,
    },
    workspace: stage.located.workspace?.root ?? null,
    workspaceDetail: stage.located.detail,
    template,
    templateFailure: null,
    conflicts: conflictsFrom(template),
    server: {
      wasRunning: stage.wasRunning,
      stopped: false,
      restarted: false,
      detail: "nothing was installed, so the server was left exactly as it was",
    },
    reportPath: stage.journal.relativePath,
  };

  say(
    stage.verdict.check.latest === null
      ? `corpus ${context.version} — no newer release to install${detailSuffix(stage.verdict.check.detail)}`
      : `corpus ${context.version} is already the latest release${detailSuffix(stage.verdict.check.detail)}; nothing was installed`,
  );
  if (template !== null && !template.upToDate) {
    say(
      "  this workspace's template files differ from the installed tool's — `corpus workspace upgrade` " +
        "applies them; nothing was written here.",
    );
    renderUpgradeReport(stage.nested.output, template);
    for (const line of stage.nested.lines()) stage.journal.note(`  ${line}`);
  }
  renderConflicts(context.out, result.conflicts, (line) => {
    stage.journal.note(line);
  });
  stage.journal.finish(result);
  context.out.emit(result);
}

function detailSuffix(detail: string | null): string {
  return detail === null ? "" : ` (${detail})`;
}

/**
 * The conflicts, taken from the sync's own verdicts rather than recomputed. A
 * second opinion about which files are unresolved is exactly the drift the
 * shared three-way rule exists to prevent.
 */
function conflictsFrom(template: UpgradeReport | null): readonly UpgradeConflict[] {
  if (template === null) return [];
  return conflictsOf(template).map((change) => ({
    path: change.path,
    source: change.source,
    detail: change.detail ?? null,
    resolve: conflictResolutionCommand(change.path),
  }));
}

/**
 * The one block a person must not miss, printed last and set apart from
 * everything that merely happened (§2.4). Under `--json` it prints nothing —
 * the `conflicts` key is the machine-readable form of exactly this.
 */
function renderConflicts(
  out: Output,
  conflicts: readonly UpgradeConflict[],
  record: (line: string) => void,
): void {
  if (conflicts.length === 0) return;

  const lines = [
    "",
    `${plural(conflicts.length, "conflict")} to resolve — the tool changed ${conflicts.length === 1 ? "this file" : "these files"} ` +
      "and this workspace had edited it too, so nothing was overwritten and nothing was merged:",
    ...conflicts.flatMap((conflict) => [
      `  ${conflict.path}${conflict.detail === null ? "" : ` — ${conflict.detail}`}`,
      `    ${conflict.resolve}`,
    ]),
  ];
  for (const line of lines) {
    out.line(line);
    record(line);
  }
}

function renderCheck(out: Output, result: UpgradeResult, method: InstallMethod): void {
  const { check } = result;
  if (!check.reachable) {
    out.line(`corpus ${check.installed} — could not check: ${check.detail ?? "unknown"}`);
    return;
  }
  if (check.latest === null) {
    out.line(`corpus ${check.installed} — ${check.detail ?? "no release to compare against"}`);
  } else if (check.upgradeAvailable) {
    out.line(`corpus ${check.installed} → ${check.latest} available`);
    if (check.notesUrl !== null) out.line(`  release notes: ${check.notesUrl}`);
    if (!check.verifiable) {
      out.line(`  NOT installable: ${check.detail ?? "the release publishes no checksum"}`);
    } else if (method.kind === "undetectable") {
      out.line(`  NOT installable here: ${method.reason}`);
    }
  } else {
    out.line(`corpus ${check.installed} is the latest release${detailSuffix(check.detail)}`);
  }

  const template = result.template;
  if (template !== null && !template.upToDate) {
    out.line("  workspace template changes are pending against the installed tool:");
    const nested = createNestedOutput(out, "    ");
    renderUpgradeReport(nested.output, template);
  }
  renderConflicts(out, result.conflicts, () => undefined);
  out.line("nothing was downloaded, installed or written (--check).");
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export const upgradeCommand: StandaloneCommandSpec = {
  name: "upgrade",
  // A standalone command: it must run outside a workspace (the tool is installed
  // once per machine, not once per workspace) and it must survive the server it
  // restarts, so it resolves the workspace itself and tolerates not finding one.
  requiresWorkspace: false,
  summary:
    "Install the latest release, bring this workspace's template files with it, and restart.",
  description:
    "Upgrades the **tool**, and everything that has to move with it (SPEC.md §2.4). One run: query " +
    "the GitHub Releases API, download the release tarball over HTTPS, **verify its published " +
    "checksum**, reinstall through the same npm-global path this copy was installed with, bring " +
    "the workspace's template files up to the new tool's, and restart the workspace's server — " +
    "**if and only if** it was running when the upgrade began.\n\n" +
    "**On demand, always.** Corpus never checks for, downloads, or installs anything in the " +
    "background, and never phones home. Nothing here runs unless it is typed.\n\n" +
    "**It refuses rather than guesses.** A release with no published checksum is not an upgrade " +
    "target and is not installed. A copy of corpus whose install method cannot be detected — a " +
    "source checkout, a project-local `node_modules`, an `npx` cache — is not upgraded either: " +
    "the refusal names what it could not establish and gives the command to run by hand. It never " +
    "elevates itself, and an unwritable npm prefix is a refusal, not a `sudo`. Every refusal " +
    "leaves the installation exactly as it found it and exits 7.\n\n" +
    "**The workspace half is not optional.** `corpus init` copies the agent's skills into the " +
    "workspace and from that moment they are the workspace's own documents, so a tool update that " +
    "ignored them would leave the loop running last version's instructions. The sync is the same " +
    "three-way compare `corpus workspace upgrade` performs, called rather than reimplemented: a " +
    "file the workspace never touched is updated, a file the workspace edited is **never** " +
    "overwritten, and everything written lands in one attributed commit, so `corpus skill " +
    "rollback` undoes a bad upgrade like any other change.\n\n" +
    "**A conflict is unresolved work, not a notice.** A file this workspace edited that the tool " +
    "also changed is reported apart from everything that merely happened, each entry naming " +
    "`corpus workspace diff <path>` — the verb that shows what moved upstream. Corpus never " +
    "merges them: a skill is prose that instructs the agent, and a plausible-looking auto-merge " +
    "would corrupt the instructions the loop runs on. Under `--json` they are the `conflicts` " +
    "array, so an agent can tell what it still owes without reading prose. Conflicts do not fail " +
    "the run: the upgrade succeeded, and exits 0 with the list.\n\n" +
    "**The report is written to `.corpus/upgrade.log`**, not only printed. An upgrade started " +
    "from the board runs detached and its last act restarts the server the browser was talking " +
    "to, so the file is the only place the answer can still be read afterwards. It is truncated " +
    "at the start of every run and ends in one `report:` line carrying the whole result as JSON.\n\n" +
    "Run outside a workspace it still upgrades the tool, and says that the template sync and the " +
    "restart were skipped. `CORPUS_RELEASES_API` and `CORPUS_RELEASES_REPO` point it at a fork or " +
    "a mirror instead of `trupin/corpus`.",
  args: [],
  flags: [
    {
      name: "check",
      type: "boolean",
      description:
        "Report only: what is installed, what the newest release is, whether it can be verified and installed here, and which workspace template changes are pending. Downloads nothing, installs nothing, writes nothing — not even the report file. Exits 0 whether or not an upgrade exists, and whether or not GitHub could be reached.",
    },
  ],
  examples: [
    {
      command: "corpus upgrade --check",
      description:
        "Ask once whether a newer release exists, and whether it could be installed here.",
    },
    {
      command: "corpus upgrade",
      description:
        "Install the latest release, sync this workspace's template files, and restart the server if it was running.",
    },
    {
      command: "corpus upgrade --json",
      description:
        'One JSON value. `check` is the release comparison (`{"installed":"0.3.0","latest":"0.4.0",' +
        '"upgradeAvailable":true,"verifiable":true,…}`), `tool` what was installed, `template` the ' +
        "sync report, `server` whether it was restarted, `reportPath` where the written report is — " +
        'and `conflicts` the unresolved work: `[{"path":".claude/skills/comment/SKILL.md",' +
        '"source":"template","detail":"modified here — 3 lines only here, 1 line only in the new copy",' +
        '"resolve":"corpus workspace diff .claude/skills/comment/SKILL.md"}]`.',
    },
  ],
  handler: (context) => runUpgrade(context),
};
