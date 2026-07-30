import { InternalError } from "../../errors.js";
import { serverPidfilePath } from "../../paths.js";
import type { WorkspaceCommandContext, WorkspaceCommandSpec } from "../../registry/types.js";
import { removePidfile, waitForExit } from "./daemon.js";
import { foreignServerDetail, inspectServer, probeHealth } from "./state.js";

export interface StopDependencies {
  /** How long SIGTERM is given before SIGKILL; production uses the daemon default. */
  readonly termTimeoutMs?: number;
  readonly killTimeoutMs?: number;
}

/**
 * Graceful first, forceful only if it must be, and never forceful towards a
 * process that is not ours. The four not-running cases all exit 0: a script
 * that stops unconditionally should not have to know which one it hit.
 *
 * "Ours" is decided by the health answer's `workspace` field, not by the fact
 * that something answered: a second workspace pointed at the same port would
 * otherwise make its neighbour's server look like this one's (CLI-008 item 1).
 */
export async function runStop(
  context: WorkspaceCommandContext,
  dependencies: StopDependencies = {},
): Promise<void> {
  const { workspace, out, client } = context;
  const pidfilePath = serverPidfilePath(workspace.root);
  const state = await inspectServer({
    pidfilePath,
    probe: () => probeHealth(client, workspace.root),
  });

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
    // The pid is alive but nothing answered on the configured port. Signalling
    // it would kill whatever inherited a reused pid — and deleting its pidfile
    // is no safer (CLI-014, extending CLI-009 from `foreign` to this branch).
    // "Alive, and not answering there" is equally the shape of this workspace's
    // *own* daemon: still serving the port it was started with after `port` was
    // re-pointed in the config, or wedged mid-shutdown. The pidfile is the only
    // handle the CLI has on that process; deleting it makes `stop` answer "not
    // running" while the server keeps serving, and nothing short of `lsof`
    // finds it again. A dead pid's file is cleanup; a live pid's file is
    // evidence.
    const { pid, port } = state.record;
    out.emit({
      stopped: false,
      running: false,
      reason: "pid alive but not answering",
      pidfileKept: true,
      pid,
      pidfilePort: port,
    });
    out.line(
      `not stopped — pid ${String(pid)} is alive but nothing answered on :${String(workspace.port)}, and it was left alone`,
    );
    out.line(`  Its pidfile was kept: ${unownedRemedy(pid, port, workspace.port)}`);
    return;
  }

  if (state.kind === "foreign") {
    // Our pid is alive, but the port answers as another workspace's server, so
    // this pid is not the process that owns it. Signalling on the strength of a
    // health check we did not earn would stop somebody else's server.
    //
    // The pidfile is kept (CLI-009). A live pid is most often this workspace's
    // own daemon, still listening on the port it was started with, after `port`
    // was re-pointed in the config — exactly the case `status` reports here.
    // Deleting the file would discard the only handle the CLI has on that
    // daemon: `stop` would then answer "not running" while the server keeps
    // serving, and nothing short of `lsof` could find it again. Only a dead
    // pid's file is cleanup.
    const { pid, port } = state.record;
    out.emit({
      stopped: false,
      running: false,
      reason: "port held by another workspace",
      pidfileKept: true,
      pid,
      pidfilePort: port,
      foreignWorkspace: state.health.workspace,
    });
    out.line(
      `not stopped — ${foreignServerDetail(workspace.port, state.health)}, and pid ${String(pid)} was left alone`,
    );
    out.line(
      `  Its pidfile was kept: pid ${String(pid)} was started on :${String(port)}, so it may be this ` +
        `workspace's own server. Point \`port\` in .corpus/config.json back at ${String(port)} and stop ` +
        `again, or stop pid ${String(pid)} directly.`,
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

/**
 * What to do about a kept pidfile whose pid is alive but silent. The remedy
 * depends on whether the config still names the port that pid was started on:
 * when it does not, the file is the record of where that daemon actually is,
 * and pointing `port` back at it is the fix; when it does, the process is
 * genuinely not answering where it should be, and only inspecting it will say
 * why.
 */
function unownedRemedy(pid: number, pidfilePort: number, configuredPort: number): string {
  const named = String(pid);
  if (pidfilePort !== configuredPort) {
    return (
      `pid ${named} was started on :${String(pidfilePort)}, so it may be this workspace's own ` +
      `server. Point \`port\` in .corpus/config.json back at ${String(pidfilePort)} and stop ` +
      `again, or stop pid ${named} directly.`
    );
  }
  return (
    `pid ${named} was started on :${String(pidfilePort)}, so it may be this workspace's own ` +
    `server, wedged or still shutting down. Check it with \`ps -p ${named}\` and stop it ` +
    "directly if it is; once that pid is gone, `corpus server stop` removes the file."
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
    "so and exits 0, so scripts can stop unconditionally. A pidfile naming a **dead** pid is " +
    "cleaned rather than acted on — an unrelated process is never signalled. A pidfile naming a " +
    "**live** pid that is not this workspace's server — nothing answers on the configured port, " +
    "or **another workspace's** server holds it — leaves that pid alone **and keeps its " +
    "pidfile**: it is usually this workspace's own daemon on the port it was started with, and " +
    "deleting the file would leave a running server nothing can stop. The message says which " +
    "port the pidfile names, so the daemon can be reached again.",
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
