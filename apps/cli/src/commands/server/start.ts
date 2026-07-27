import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { ServerUnreachableError } from "../../errors.js";
import { serverLogPath, serverPidfilePath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
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
import { inspectServer, probeHealth } from "./state.js";

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
 */
export async function runStart(
  context: WorkspaceCommandContext,
  dependencies: StartDependencies = {},
): Promise<void> {
  const { workspace, out, client } = context;
  const pidfilePath = serverPidfilePath(workspace.root);
  const logPath = serverLogPath(workspace.root);
  const url = workspace.baseUrl;

  const state = await inspectServer({ pidfilePath, probe: () => probeHealth(client) });

  if (state.kind === "running") {
    out.emit({
      running: true,
      alreadyRunning: true,
      pid: state.record.pid,
      port: state.record.port,
      url,
      version: state.health.version,
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

  // A pidfile whose process is gone is exactly what `kill -9` leaves behind.
  if (state.kind === "stale") removePidfile(pidfilePath);

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
      probe: () => probeHealth(client),
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
    });
    out.line(`corpus ${ready.payload.version} listening on ${url} (pid ${String(record.pid)})`);
    out.line("  logs: corpus server logs -f");
  } finally {
    closeSync(logFd);
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
    "until `GET /api/health` answers before reporting the board URL. The daemon outlives the " +
    "shell that started it. Idempotent: an already-running server is reported and the command " +
    "exits 0. If it never becomes ready, the tail of the log is printed rather than a silent " +
    "failure.",
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
