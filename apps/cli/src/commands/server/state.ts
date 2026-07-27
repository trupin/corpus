import type { Health } from "@corpus/contract";
import type { CliClient } from "../../client.js";
import { isProcessAlive, readPidfile, type PidfileRecord, type SignalSender } from "./daemon.js";

/**
 * What the workspace's server is actually doing, decided from two independent
 * pieces of evidence: the pidfile says a process should exist, and `/api/health`
 * says the thing listening on the recorded port is this workspace's server.
 *
 * Both are needed. A pid alone is not proof — pids are reused, and a pidfile
 * outlives a `kill -9` — which is why SPEC.md §2.1 requires that a stale or
 * reused pid is never reported as "running".
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
  | { readonly kind: "running"; readonly record: PidfileRecord; readonly health: Health };

/** One `/api/health` attempt, mapped to "is it there" — errors are the answer, not a throw. */
export async function probeHealth(client: CliClient): Promise<Health | undefined> {
  try {
    return await client.request((api) => api.GET("/api/health"));
  } catch {
    return undefined;
  }
}

export interface InspectOptions {
  readonly pidfilePath: string;
  readonly probe: () => Promise<Health | undefined>;
  readonly kill?: SignalSender;
}

export async function inspectServer(options: InspectOptions): Promise<ServerState> {
  const record = readPidfile(options.pidfilePath);
  if (record === undefined) return { kind: "stopped" };
  if (!isProcessAlive(record.pid, options.kill)) return { kind: "stale", record };

  const health = await options.probe();
  return health === undefined ? { kind: "unowned", record } : { kind: "running", record, health };
}
