import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Health } from "@corpus/contract";
import type { CliClient } from "../../client.js";
import { isProcessAlive, readPidfile, type PidfileRecord, type SignalSender } from "./daemon.js";

/**
 * What the workspace's server is actually doing, decided from two independent
 * pieces of evidence: the pidfile says a process should exist, and `/api/health`
 * says the thing listening on the recorded port is **this workspace's** server.
 *
 * Both are needed. A pid alone is not proof — pids are reused, and a pidfile
 * outlives a `kill -9` — which is why SPEC.md §2.1 requires that a stale or
 * reused pid is never reported as "running".
 *
 * Neither is a bare `200` from `/api/health` proof. Two workspaces configured to
 * the same port are a single edit apart (`.corpus/config.json`, `CORPUS_PORT`),
 * and the one that loses the race gets a perfectly healthy answer from the other
 * one's server. `/api/health` carries `workspace` — the absolute path of the
 * workspace that server owns — precisely so the answer can be attributed, and
 * that comparison is what separates `running` from `foreign` below.
 */

export type ServerState =
  /** No pidfile, or one that does not parse. */
  | { readonly kind: "stopped" }
  /** A pidfile whose process is gone: `kill -9`, a crash, a reboot. */
  | { readonly kind: "stale"; readonly record: PidfileRecord }
  /**
   * The pid is alive but nothing on the recorded port identifies as this
   * workspace's server: either the pid was reused by something unrelated, or
   * the server is wedged. Either way it must not be reported as running, and
   * `stop` must not send it a signal.
   */
  | { readonly kind: "unowned"; readonly record: PidfileRecord }
  /**
   * The pid is alive and the port answers — as **another workspace's** server.
   * Reported separately from `unowned` because the remedy is different: the
   * port is contended, and nothing this workspace does to its own process will
   * change that.
   */
  | { readonly kind: "foreign"; readonly record: PidfileRecord; readonly health: Health }
  | { readonly kind: "running"; readonly record: PidfileRecord; readonly health: Health };

/** What answered on the port, and whether it belongs to this workspace. */
export type ProbeOutcome =
  /** Nothing answered: connection refused, reset, or timed out. */
  | { readonly kind: "unreachable" }
  /** A corpus server answered, but it owns a different workspace. */
  | { readonly kind: "foreign"; readonly health: Health }
  | { readonly kind: "ours"; readonly health: Health };

/**
 * One `/api/health` attempt, attributed — errors are the answer, not a throw.
 *
 * The workspace root is compared after `realpath`, so the same directory reached
 * through a symlink (`/tmp` → `/private/tmp` on macOS) or through a `--workspace`
 * path that differs from the server's own cwd is still recognised as ours. A
 * path that no longer exists falls back to a plain absolute comparison rather
 * than being declared foreign on the strength of a failed `stat`.
 */
export async function probeHealth(client: CliClient, workspaceRoot: string): Promise<ProbeOutcome> {
  let health: Health;
  try {
    health = await client.request((api) => api.GET("/api/health"));
  } catch {
    return { kind: "unreachable" };
  }
  return sameWorkspace(health.workspace, workspaceRoot)
    ? { kind: "ours", health }
    : { kind: "foreign", health };
}

export function sameWorkspace(one: string, other: string): boolean {
  return canonicalPath(one) === canonicalPath(other);
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/** The one phrasing of "someone else's server is on our port", used by every verb. */
export function foreignServerDetail(port: number, health: Health): string {
  return `:${String(port)} is held by another workspace's server (${health.workspace})`;
}

export interface InspectOptions {
  readonly pidfilePath: string;
  readonly probe: () => Promise<ProbeOutcome>;
  readonly kill?: SignalSender;
}

export async function inspectServer(options: InspectOptions): Promise<ServerState> {
  const record = readPidfile(options.pidfilePath);
  if (record === undefined) return { kind: "stopped" };
  if (!isProcessAlive(record.pid, options.kill)) return { kind: "stale", record };

  const outcome = await options.probe();
  switch (outcome.kind) {
    case "ours":
      return { kind: "running", record, health: outcome.health };
    case "foreign":
      return { kind: "foreign", record, health: outcome.health };
    case "unreachable":
      return { kind: "unowned", record };
  }
}
