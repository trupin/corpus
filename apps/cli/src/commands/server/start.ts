import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { Health } from "@corpus/contract";
import { ServerUnreachableError } from "../../errors.js";
import { serverLogPath, serverPidfilePath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { maintainOrWarn } from "../workspace/maintenance.js";
import {
  removePidfile,
  resolveServerEntry,
  spawnServer,
  startBanner,
  waitForExit,
  waitForHealth,
  writePidfile,
  type PidfileRecord,
  type ServerEntry,
} from "./daemon.js";
import { tailLines } from "./logs.js";
import { foreignServerDetail, inspectServer, probeHealth } from "./state.js";

/** Log lines shown when the daemon never becomes ready — enough to see the cause. */
export const FAILURE_LOG_LINES = 20;

export interface StartDependencies {
  /** Entry point to daemonize; production resolves the installed server. */
  readonly entry?: ServerEntry;
  readonly readyTimeoutMs?: number;
}

/**
 * Spawn detached → wait for `/api/health` → record the pidfile. The pidfile is
 * written last on purpose: a file naming a pid that never became a server is
 * worse than no file, because the next `start` would refuse on account of it.
 *
 * That guarantee only holds if readiness means *our* server answered. Two
 * workspaces pointed at one port used to defeat it completely: the child died
 * `EADDRINUSE` while the readiness probe was answered by the workspace that got
 * there first, so `start` wrote a pidfile for a corpse and reported success
 * (CLI-008 item 1). The port is therefore attributed twice — once before
 * spawning anything, and again on every readiness poll.
 */
export async function runStart(
  context: WorkspaceCommandContext,
  dependencies: StartDependencies = {},
): Promise<void> {
  const { workspace, out, client } = context;
  const pidfilePath = serverPidfilePath(workspace.root);
  const logPath = serverLogPath(workspace.root);
  const url = workspace.baseUrl;

  const state = await inspectServer({
    pidfilePath,
    probe: () => probeHealth(client, workspace.root),
  });

  if (state.kind === "running") {
    out.emit({
      running: true,
      alreadyRunning: true,
      pid: state.record.pid,
      port: state.record.port,
      url,
      version: state.health.version,
      // An already-running server is the sole writer, so nothing was maintained
      // — the field is present and null rather than absent, so one reader shape
      // covers both answers.
      maintenance: null,
    });
    out.line(
      `already running on :${String(state.record.port)} (pid ${String(state.record.pid)}) — ${url}`,
    );
    return;
  }

  if (state.kind === "unowned") {
    throw new ServerUnreachableError(
      `pid ${String(state.record.pid)} from ${pidfilePath} is alive but is not answering on :${String(state.record.port)}`,
      { hint: "Run `corpus server stop` to clear it, then start again." },
    );
  }

  if (state.kind === "foreign") {
    throw new ServerUnreachableError(foreignServerDetail(workspace.port, state.health), {
      hint: PORT_CONFLICT_HINT,
    });
  }

  // A pidfile whose process is gone is exactly what `kill -9` leaves behind.
  if (state.kind === "stale") removePidfile(pidfilePath);

  // Nothing of ours is running, so anything answering on the port belongs to
  // someone else. Asking now costs one request and saves spawning a child whose
  // only possible fate is `EADDRINUSE` — and, before this check existed, a
  // pidfile naming that child after it died.
  await refuseAnOccupiedPort(context);

  // The one instant in a workspace's life when its repository provably has no
  // writer: the server is the sole writer (CLAUDE.md Architecture Decision 2),
  // every way one could be running has just been ruled out above, and the child
  // that will become the next one has not been spawned yet. That is why Corpus's
  // own maintenance lives here and not in the server (CLI-037) — and why it must
  // stay below `refuseAnOccupiedPort` rather than above it.
  const maintenance = await maintainOrWarn({ dir: workspace.root });
  // Reported as it happens rather than folded into the success line: it is
  // finished by the time the daemon is spawned, and a start that then fails
  // should still say what it did to the repository first.
  for (const line of maintenance.lines) out.line(line);

  const entry = dependencies.entry ?? resolveServerEntry();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");

  try {
    let exited = false;
    const child = spawnServer({
      workspaceRoot: workspace.root,
      entry,
      logFd,
      env: context.env,
    });
    child.once("exit", () => {
      exited = true;
    });

    const record: PidfileRecord = {
      pid: child.pid ?? 0,
      port: workspace.port,
      startedAt: new Date().toISOString(),
      version: context.version,
    };
    appendFileSync(logPath, startBanner(record));

    const ready = await waitForHealth({
      probe: () => ourHealth(context),
      hasExited: () => exited,
      ...(dependencies.readyTimeoutMs === undefined
        ? {}
        : { timeoutMs: dependencies.readyTimeoutMs }),
    });

    if (ready.kind !== "healthy") {
      await abandon(child.pid, ready.kind === "exited");
      throw new ServerUnreachableError(
        ready.kind === "exited"
          ? "the server exited during startup"
          : "the server did not become ready in time",
        {
          hint: `See ${logPath} for the full log.`,
          details: { log: tailLines(logPath, FAILURE_LOG_LINES) },
        },
      );
    }

    writePidfile(pidfilePath, record);
    out.emit({
      running: true,
      alreadyRunning: false,
      pid: record.pid,
      port: record.port,
      url,
      version: ready.payload.version,
      maintenance: maintenance.outcome,
    });
    out.line(`corpus ${ready.payload.version} listening on ${url} (pid ${String(record.pid)})`);
    out.line("  logs: corpus server logs -f");
  } finally {
    closeSync(logFd);
  }
}

const PORT_CONFLICT_HINT =
  "Give this workspace its own port: change `port` in .corpus/config.json (or set CORPUS_PORT), then start again.";

/**
 * The readiness poll's single question: did **our** server answer? A healthy
 * response from another workspace's server is not readiness, and treating it as
 * such is what let a dead child be recorded as a running one.
 */
async function ourHealth(context: WorkspaceCommandContext): Promise<Health | undefined> {
  const outcome = await probeHealth(context.client, context.workspace.root);
  return outcome.kind === "ours" ? outcome.health : undefined;
}

/**
 * Refuses when the port is already serving — whoever it serves. A foreign
 * server means the two workspaces are contending and the config has to change;
 * one of ours means a server for this workspace is up with no pidfile naming it,
 * which `stop` cannot clear and which `start` must not paper over by spawning a
 * child that dies on the bind.
 */
async function refuseAnOccupiedPort(context: WorkspaceCommandContext): Promise<void> {
  const { workspace, client } = context;
  const holder = await probeHealth(client, workspace.root);

  if (holder.kind === "foreign") {
    throw new ServerUnreachableError(foreignServerDetail(workspace.port, holder.health), {
      hint: PORT_CONFLICT_HINT,
    });
  }

  if (holder.kind === "ours") {
    throw new ServerUnreachableError(
      `a server for this workspace is already listening on :${String(workspace.port)}, but no pidfile names it`,
      {
        hint: `Find it with \`lsof -nP -iTCP:${String(workspace.port)} -sTCP:LISTEN\` and stop it by pid, then start again.`,
      },
    );
  }
}

/**
 * A child that never became ready must not be left running: it would hold the
 * port against the next `corpus server start` while answering nothing, and no
 * pidfile would name it.
 */
async function abandon(pid: number | undefined, alreadyExited: boolean): Promise<void> {
  if (pid === undefined || alreadyExited) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  if (!(await waitForExit({ pid, timeoutMs: 2000 }))) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone between the check and the signal.
    }
  }
}

export const startCommand: WorkspaceCommandSpec = {
  name: "start",
  summary: "Start this workspace's server as a background daemon.",
  description:
    "Spawns the server detached, with its output appended to `.corpus/server.log`, and waits " +
    "until `GET /api/health` answers **for this workspace** before reporting the board URL. The " +
    "daemon outlives the shell that started it. Idempotent: an already-running server is reported " +
    "and the command exits 0. A port that another workspace's server already holds is refused " +
    "before anything is spawned (exit 4) — its health answer is never mistaken for this " +
    "workspace's, and no pidfile is written. If the daemon never becomes ready, the tail of the " +
    "log is printed rather than a silent failure.\n\n" +
    "**A start is also when Corpus maintains the workspace's git repository** (`corpus workspace " +
    "maintain`). Git's own background maintenance is off in a Corpus workspace, because a " +
    "detached repack racing the server's commits can leave the object store permanently corrupt; " +
    "the packing is rescheduled to here, the one instant when the sole writer is provably absent " +
    "— after every running server has been ruled out and before the next one is spawned. It " +
    "packs only when the loose-object count is past git's own `gc.auto` threshold, so most " +
    "starts say nothing about it, and a workspace that predates this behaviour is brought under " +
    "it by its next start. Maintenance never blocks the start: a failure is reported as a " +
    "warning and the server comes up anyway.",
  args: [],
  flags: [],
  examples: [
    { command: "corpus server start", description: "Start the server for this workspace." },
    {
      command: "corpus server start --json",
      description: "Machine-readable form: pid, port and board URL as one JSON value.",
    },
  ],
  handler: (context) => runStart(context),
};
