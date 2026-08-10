import { RefusedError } from "../../errors.js";
import { serverPidfilePath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { renderColumns } from "../columns.js";
import { inspectServer, probeHealth } from "../server/state.js";
import {
  maintainRepository,
  renderMaintenance,
  type MaintenanceOutcome,
  type RepositoryObjects,
} from "./maintenance.js";

/**
 * `corpus workspace maintain` — the visible half of CLI-037's ruling.
 *
 * Corpus takes git's background scheduler out of a workspace's repository (see
 * `maintenance.ts` for why) and packs it itself, normally at `corpus server
 * start`. That covers every workspace that is ever restarted, which is nearly
 * all of them — but "nearly" is not a maintenance story, and a decision nobody
 * can see or run is indistinguishable from a workspace that silently never
 * packs. So the same code path is a verb:
 *
 * - it is where the object store's state is **readable** — how many loose
 *   objects there are, and how far that is from the point Corpus packs;
 * - it is the answer for a server that stays up for months and is never
 *   restarted;
 * - and it re-applies the settings, so a repository someone re-enabled
 *   maintenance in comes back under the rule without waiting for a restart.
 *
 * **It refuses while this workspace's server is running**, and that refusal is
 * the whole point rather than a limitation. Packing races a concurrent writer;
 * racing a concurrent writer is the bug (SERVER-089 measured a corrupt object
 * store in 8 of 25 runs). The server is the sole writer (CLAUDE.md Architecture
 * Decision 2), so "the server is stopped" is a *provable* absence of one, and it
 * is the only precondition under which Corpus rewrites the object store. There
 * is deliberately no flag to override it.
 */

export interface MaintainReport {
  readonly workspace: string;
  /** Settings written by this run; empty when the repository already carried them. */
  readonly settings: readonly string[];
  readonly before: RepositoryObjects;
  readonly after: RepositoryObjects | null;
  readonly packed: boolean;
  /** Whether the loose-object count was above the threshold before this run. */
  readonly due: boolean;
  readonly threshold: number;
}

export function toReport(workspace: string, outcome: MaintenanceOutcome): MaintainReport {
  return {
    workspace,
    settings: outcome.settings,
    before: outcome.before,
    after: outcome.after,
    packed: outcome.packed,
    due: outcome.before.loose > outcome.threshold,
    threshold: outcome.threshold,
  };
}

/**
 * The counts, then whatever the run did. The block comes first and always: the
 * question this verb answers is "what state is my repository's object store in",
 * and a run that packed nothing still has to answer it.
 */
export function renderMaintainReport(report: MaintainReport): readonly string[] {
  const objects = report.after ?? report.before;
  const lines = [
    ...renderColumns([
      ["loose objects", String(objects.loose)],
      ["packed objects", String(objects.packed)],
      ["packs", String(objects.packs)],
      ["packs at", `${String(report.threshold)} loose objects`],
    ]),
  ];

  const done = renderMaintenance({
    settings: report.settings,
    before: report.before,
    after: report.after,
    packed: report.packed,
    threshold: report.threshold,
  });
  lines.push(...done.map((line) => `  ${line}`));

  if (!report.packed) {
    lines.push(
      report.due
        ? "  nothing was packed (--settings-only)."
        : "  nothing to pack yet; corpus packs at server start once the count is above the threshold.",
    );
  }
  return lines;
}

export async function runWorkspaceMaintain(context: WorkspaceCommandContext): Promise<void> {
  const { workspace, out } = context;

  const state = await inspectServer({
    pidfilePath: serverPidfilePath(workspace.root),
    probe: () => probeHealth(context.client, workspace.root),
  });
  if (state.kind === "running") {
    throw new RefusedError(
      `this workspace's server is running (pid ${String(state.record.pid)} on :${String(state.record.port)}), ` +
        "and it is the only writer of this repository",
      {
        code: "server_running",
        hint: "Run `corpus server stop`, then `corpus workspace maintain`. A start will maintain it for you.",
      },
    );
  }

  const outcome = await maintainRepository({
    dir: workspace.root,
    force: context.flags.boolean("force"),
    settingsOnly: context.flags.boolean("settings-only"),
  });

  const report = toReport(workspace.root, outcome);
  out.emit(report);
  for (const line of renderMaintainReport(report)) out.line(line);
}

export const maintainCommand: WorkspaceCommandSpec = {
  name: "maintain",
  summary: "Pack this workspace's git repository, and report the state of its object store.",
  description:
    "Corpus turns git's own background maintenance **off** in every workspace it creates, and " +
    "maintains the repository itself instead. Since git 2.29 every `git commit` ends by spawning " +
    "a detached `git maintenance run --auto`, which rewrites the object store at a moment of its " +
    "own choosing — concurrently with the server's next commit and with anything reading git " +
    "beside it. The server is the sole writer of this repository and reads its own commits " +
    "straight back, so that second unscheduled writer is a race, and a lost race leaves a " +
    "**permanently corrupt** object store: the audit trail SPEC.md §4 makes the only recovery " +
    "for a deletion.\n\n" +
    "So the packing is rescheduled rather than abandoned. `corpus server start` runs it " +
    "automatically, at the one instant a workspace provably has no writer — after it has " +
    "established that no server for this workspace is running. This verb is the same run, on " +
    "demand: it reports the loose-object count, the packed count and the threshold, applies the " +
    "settings to a repository that lacks them, and packs when the count is above the threshold. " +
    "The threshold is git's own `gc.auto` default, so a workspace is packed about as often as " +
    "git would have packed it — counted exactly, rather than estimated from one directory.\n\n" +
    "**It refuses while this workspace's server is running** (exit 7, nothing changed), because " +
    "packing beside the writer is the race being removed. Stop the server first, or just start " +
    "it and let the start maintain the repository. There is no flag to override the refusal.",
  args: [],
  flags: [
    {
      name: "force",
      type: "boolean",
      description:
        "Pack now, whatever the loose-object count. The refusal to run beside a live server still applies.",
    },
    {
      name: "settings-only",
      type: "boolean",
      description:
        "Apply the maintenance settings and report the counts, but pack nothing — what `corpus workspace upgrade` does, since it is allowed to run against a live server.",
    },
  ],
  examples: [
    {
      command: "corpus workspace maintain",
      description: "Report the object store, and pack it if it is over the threshold.",
    },
    {
      command: "corpus workspace maintain --force",
      description: "Pack now, however few loose objects there are.",
    },
    {
      command: "corpus workspace maintain --json",
      description: "Machine-readable form: counts before and after, and whether anything packed.",
    },
  ],
  handler: (context) => runWorkspaceMaintain(context),
};
