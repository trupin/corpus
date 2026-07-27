import { CheckFailedError } from "../../errors.js";
import { serverPidfilePath } from "../../paths.js";
import type { WorkspaceCommandSpec } from "../../registry/types.js";
import { removePidfile } from "./daemon.js";
import { inspectServer, probeHealth, type ServerState } from "./state.js";

/**
 * The one report shape, emitted under `--json` and rendered for humans from the
 * same object — the two can never describe different states.
 */
export interface ServerStatusReport {
  readonly running: boolean;
  readonly healthy: boolean;
  readonly workspace: string;
  readonly url: string;
  readonly pid: number | null;
  readonly port: number | null;
  readonly startedAt: string | null;
  readonly uptimeSeconds: number | null;
  readonly version: string | null;
  /** `stopped`, `stale pidfile removed`, `unowned pid` or `ok`. */
  readonly detail: string;
}

export function buildReport(
  state: ServerState,
  workspace: { readonly root: string; readonly baseUrl: string; readonly port: number },
): ServerStatusReport {
  const base = {
    workspace: workspace.root,
    url: workspace.baseUrl,
  };

  switch (state.kind) {
    case "stopped":
      return {
        ...base,
        running: false,
        healthy: false,
        pid: null,
        port: workspace.port,
        startedAt: null,
        uptimeSeconds: null,
        version: null,
        detail: "not running",
      };
    case "stale":
      return {
        ...base,
        running: false,
        healthy: false,
        pid: null,
        port: state.record.port,
        startedAt: state.record.startedAt,
        uptimeSeconds: null,
        version: null,
        detail: "not running (stale pidfile removed)",
      };
    case "unowned":
      return {
        ...base,
        running: false,
        healthy: false,
        pid: state.record.pid,
        port: state.record.port,
        startedAt: state.record.startedAt,
        uptimeSeconds: null,
        version: state.record.version,
        detail: `pid ${String(state.record.pid)} is alive but is not answering on :${String(state.record.port)}`,
      };
    case "running":
      return {
        ...base,
        running: true,
        healthy: true,
        pid: state.record.pid,
        port: state.record.port,
        startedAt: state.record.startedAt,
        uptimeSeconds: Math.round(state.health.uptimeSeconds),
        version: state.health.version,
        detail: "ok",
      };
  }
}

export function renderReport(report: ServerStatusReport): string {
  if (!report.running) return report.detail;
  return [
    `running — pid ${String(report.pid)} on :${String(report.port)}`,
    `corpus ${String(report.version)}`,
    `up ${String(report.uptimeSeconds)}s`,
    report.url,
  ].join(", ");
}

export const statusCommand: WorkspaceCommandSpec = {
  name: "status",
  summary: "Report whether this workspace's server is running, and how it is doing.",
  description:
    "Combines the pidfile with a live `GET /api/health` so a stale or reused pid is never " +
    "reported as running — a pidfile whose process is gone is cleaned up on the spot. Exits 0 " +
    "when the server is running and answering, and 6 when it is not, so scripts can gate on " +
    "it (`corpus server status || corpus server start`). Under `--json` the whole report is " +
    "one object on stdout in both states.",
  args: [],
  flags: [],
  examples: [
    {
      command: "corpus server status",
      description: "Report the state of this workspace's server.",
    },
    {
      command: "corpus server status --json",
      description: "One JSON object: running, pid, port, uptime, version.",
    },
    {
      command: "corpus server status || corpus server start",
      description: "Start the server only when it is not already up.",
    },
  ],
  handler: async (context) => {
    const { workspace, out, client } = context;
    const pidfilePath = serverPidfilePath(workspace.root);
    const state = await inspectServer({ pidfilePath, probe: () => probeHealth(client) });

    // Reporting the truth includes making it true: a pidfile naming a process
    // that no longer exists is cleaned here, not left for the next command.
    if (state.kind === "stale") removePidfile(pidfilePath);

    const report = buildReport(state, workspace);
    out.emit(report);
    out.line(renderReport(report));

    if (!report.running) {
      throw new CheckFailedError(
        state.kind === "unowned"
          ? `the workspace server is not answering on :${String(report.port)}`
          : "the workspace server is not running",
        { hint: "Start it with `corpus server start`." },
      );
    }
  },
};
