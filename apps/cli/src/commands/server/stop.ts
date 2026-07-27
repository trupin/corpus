import { InternalError } from "../../errors.js";
import { serverPidfilePath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { removePidfile, waitForExit } from "./daemon.js";
import { inspectServer, probeHealth } from "./state.js";

export interface StopDependencies {
  /** How long SIGTERM is given before SIGKILL; production uses the daemon default. */
  readonly termTimeoutMs?: number;
  readonly killTimeoutMs?: number;
}

/**
 * Graceful first, forceful only if it must be, and never forceful towards a
 * process that is not ours. The three not-running cases all exit 0: a script
 * that stops unconditionally should not have to know which one it hit.
 */
export async function runStop(
  context: WorkspaceCommandContext,
  dependencies: StopDependencies = {},
): Promise<void> {
  const { workspace, out, client } = context;
  const pidfilePath = serverPidfilePath(workspace.root);
  const state = await inspectServer({ pidfilePath, probe: () => probeHealth(client) });

  if (state.kind === "stopped") {
    out.emit({ stopped: false, running: false, reason: "not running" });
    out.line("not running");
    return;
  }

  if (state.kind === "stale") {
    removePidfile(pidfilePath);
    out.emit({ stopped: false, running: false, reason: "stale pidfile removed" });
    out.line("not running (stale pidfile removed)");
    return;
  }

  if (state.kind === "unowned") {
    // The pid is alive but is not this workspace's server. Signalling it would
    // kill whatever inherited the pid; the pidfile is the thing that is wrong.
    removePidfile(pidfilePath);
    out.emit({
      stopped: false,
      running: false,
      reason: "stale pidfile removed",
      unrelatedPid: state.record.pid,
    });
    out.line(
      `not running (stale pidfile removed) — pid ${String(state.record.pid)} is alive but is not this workspace's server, and was left alone`,
    );
    return;
  }

  const { pid, port } = state.record;
  signal(pid, "SIGTERM");

  let escalated = false;
  const termWait =
    dependencies.termTimeoutMs === undefined ? {} : { timeoutMs: dependencies.termTimeoutMs };
  if (!(await waitForExit({ pid, ...termWait }))) {
    escalated = true;
    signal(pid, "SIGKILL");
    if (!(await waitForExit({ pid, timeoutMs: dependencies.killTimeoutMs ?? 2000 }))) {
      throw new InternalError(`the server (pid ${String(pid)}) did not exit after SIGKILL`, {
        hint: "Investigate the process directly; the pidfile has been left in place.",
      });
    }
  }

  removePidfile(pidfilePath);
  out.emit({ stopped: true, running: false, pid, port, escalated });
  out.line(
    escalated
      ? `stopped (pid ${String(pid)}) — it ignored SIGTERM and was killed`
      : `stopped (pid ${String(pid)})`,
  );
}

/** A process that vanished between the liveness check and the signal is a success. */
function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone; `waitForExit` will agree immediately.
  }
}

export const stopCommand: WorkspaceCommandSpec = {
  name: "stop",
  summary: "Stop this workspace's server.",
  description:
    "Sends SIGTERM, waits for the process to exit, escalates to SIGKILL only if it will not, " +
    "and removes the pidfile. Stopping a server that is not running is not an error: it says " +
    "so and exits 0, so scripts can stop unconditionally. A pidfile naming a dead or reused " +
    "pid is cleaned rather than acted on — an unrelated process is never signalled.",
  args: [],
  flags: [],
  examples: [
    { command: "corpus server stop", description: "Stop the server for this workspace." },
    {
      command: "corpus server stop --json",
      description: "Machine-readable form: what was stopped, or that nothing was running.",
    },
  ],
  handler: (context) => runStop(context),
};
