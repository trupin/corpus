import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveCliEntry } from "./entry.js";

/**
 * SPEC.md §2.4's "Upgrade & restart", as the one thing a server can honestly do
 * about it: start the CLI and get out of the way.
 *
 * **Detached is not an optimisation.** The last act of `corpus upgrade` is
 * restarting the server that asked for it, so the child cannot be this
 * process's child in any surviving sense — it has to outlive the parent it is
 * about to replace. Hence `detached: true`, `unref()`, and both output streams
 * pointed at a file rather than at pipes this process will stop reading the
 * moment it is killed.
 *
 * **The log file is the whole reporting channel**, which is why the `202`
 * carries its path. Everything §2.4 requires an upgrade to report — what was
 * updated, what was left alone, and every conflict listed apart from both —
 * happens minutes later, in another process, across a restart that drops the
 * caller's SSE stream. Nothing about it can come back over the connection the
 * trigger answered on.
 */

/**
 * The upgrade's **report** — the file `UpgradeStarted.logPath` names, holding
 * what was updated, what was left alone and every conflict listed apart from
 * both (SPEC.md §2.4).
 *
 * **The CLI owns this file, not the server.** `apps/cli/src/paths.ts` declares
 * the same name, truncates it at the start of every run and writes to it as it
 * goes, ending in one JSON object after a `report:` marker. The server's only
 * business with it is naming it in the `202`, and the coupling is guarded by a
 * test that reads the CLI's declaration rather than trusted to a comment.
 *
 * The server explicitly does **not** redirect the child's output here. It tried
 * that once and the result was one file with two writers: the CLI truncated over
 * the server's banner and then wrote every line twice, once through stdout and
 * once through the report.
 */
export const UPGRADE_REPORT_NAME = "upgrade.log";

/**
 * Where the child's stdout and stderr go instead, and the reason there are two
 * files rather than one.
 *
 * The report only exists once the CLI has booted far enough to open it. A `node`
 * that cannot start — a missing loader in a source checkout, a corrupted
 * bundle — says so on stderr and then exits, and with `stdio: "ignore"` that
 * sentence would be lost and the trigger would look like an upgrade that simply
 * never happened. This file is the same insurance `corpus server start` buys
 * with `.corpus/server.log`.
 */
export const UPGRADE_CONSOLE_NAME = "upgrade-console.log";
export const UPGRADE_PIDFILE_NAME = "upgrade.pid";

/**
 * After this long, a pidfile is not evidence of an upgrade in flight.
 *
 * An upgrade is a download, an `npm install -g` and a server restart: minutes at
 * worst on a slow link. Half an hour is not a generous timeout, it is a
 * different situation — a machine that slept, a child killed by something that
 * did not get to clean up, a pid the kernel has since reused. The liveness probe
 * catches most of those; this catches the case where it cannot, and its cost if
 * it is ever wrong is one refusal that should have been a refusal, rather than a
 * workspace permanently unable to upgrade because of a file nobody knows to
 * delete.
 */
export const IN_FLIGHT_MAX_MS = 30 * 60 * 1000;

const PidfileSchema = z.object({ pid: z.number().int().positive(), startedAt: z.string().min(1) });
export type UpgradePidfile = z.infer<typeof PidfileSchema>;

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface UpgradeTriggerOptions {
  readonly workspaceRoot: string;
  /** Absolute path of `.corpus/` — the pidfile and the log both live in it. */
  readonly corpusDir: string;
  /** Where the CLI is looked for; `defaultPackageRoot()` in a running server. */
  readonly packageRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly spawn?: SpawnFn;
  /** Whether a pid is a live process. Injected so no test signals a real one. */
  readonly isAlive?: (pid: number) => boolean;
  readonly now?: () => Date;
}

export type UpgradeTriggerResult =
  | {
      readonly kind: "started";
      /** The CLI's report — what the `202` names. Does not exist yet. */
      readonly reportPath: string;
      /** The child's stdout and stderr, which exists from this moment. */
      readonly consolePath: string;
      readonly pid: number;
    }
  /** An upgrade is already running — the `409`, carrying when it began. */
  | { readonly kind: "in-flight"; readonly startedAt: string }
  /** The CLI is not where either layout puts it — a broken installation. */
  | { readonly kind: "no-cli"; readonly searched: readonly string[] }
  /** The child could not be started at all; `detail` is the OS's word for why. */
  | { readonly kind: "failed"; readonly detail: string };

/** `process.kill(pid, 0)` — signal 0 tests for existence and delivers nothing. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM means it exists and belongs to somebody else, which is still alive.
    return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM";
  }
}

/**
 * Reads the guard's pidfile, and answers only the question the guard asks: is
 * there an upgrade in flight right now. An unreadable, unparseable, dead or
 * ancient record is `null` — none of those is an upgrade, and none of them is
 * worth refusing over.
 */
export function readInFlight(
  pidfilePath: string,
  isAlive: (pid: number) => boolean,
  now: Date,
): UpgradePidfile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pidfilePath, "utf8"));
  } catch {
    return null;
  }

  const record = PidfileSchema.safeParse(parsed);
  if (!record.success) return null;

  const startedAt = Date.parse(record.data.startedAt);
  if (Number.isNaN(startedAt) || now.getTime() - startedAt > IN_FLIGHT_MAX_MS) return null;
  return isAlive(record.data.pid) ? record.data : null;
}

/**
 * One banner per run, so a log that has held several is readable as a history
 * rather than as one run with a confusing middle. Written before the child owns
 * the file, which is also what proves the path in the `202` is real: the caller
 * can open it and find something even if the child dies before writing a byte.
 */
export function upgradeBanner(startedAt: string, command: string): string {
  return `--- corpus upgrade ${startedAt} ${command} ---\n`;
}

export function startDetachedUpgrade(options: UpgradeTriggerOptions): UpgradeTriggerResult {
  const spawn = options.spawn ?? nodeSpawn;
  const isAlive = options.isAlive ?? processIsAlive;
  const now = (options.now ?? (() => new Date()))();

  const pidfilePath = join(options.corpusDir, UPGRADE_PIDFILE_NAME);
  const inFlight = readInFlight(pidfilePath, isAlive, now);
  if (inFlight !== null) return { kind: "in-flight", startedAt: inFlight.startedAt };

  const lookup = resolveCliEntry(options.packageRoot);
  if (lookup.kind === "missing") return { kind: "no-cli", searched: lookup.searched };

  const reportPath = join(options.corpusDir, UPGRADE_REPORT_NAME);
  const consolePath = join(options.corpusDir, UPGRADE_CONSOLE_NAME);
  const startedAt = now.toISOString();
  const argv = [...lookup.entry.nodeArgs, lookup.entry.modulePath, "upgrade"];

  let logFd: number;
  try {
    mkdirSync(dirname(consolePath), { recursive: true });
    // Truncating, not appending: this file answers "what did the last upgrade
    // print", and a file accumulating every run would grow without bound in a
    // directory nothing prunes. The banner goes in before the child owns the
    // descriptor, which is also what makes the `202` honest — a caller can open
    // this and find the command that was run even if the child dies silently.
    writeFileSync(consolePath, upgradeBanner(startedAt, `${process.execPath} ${argv.join(" ")}`));
    logFd = openSync(consolePath, "a");
  } catch (cause) {
    return { kind: "failed", detail: `${consolePath} could not be opened (${reason(cause)})` };
  }

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, argv, {
      cwd: options.workspaceRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      // `CORPUS_WORKSPACE` and nothing invented. The upgrade reads the port and
      // token from `.corpus/config.json` exactly as `corpus server start` does,
      // and a token passed through an environment nobody reads is pure exposure.
      env: { ...options.env, CORPUS_WORKSPACE: options.workspaceRoot },
    });
  } catch (cause) {
    closeSync(logFd);
    return { kind: "failed", detail: `the upgrade could not be started (${reason(cause)})` };
  } finally {
    // The child holds its own duplicate of the descriptor from the moment it is
    // spawned; keeping this one open would leak one per trigger.
    try {
      closeSync(logFd);
    } catch {
      /* already closed by the failure path */
    }
  }

  child.unref();
  const pid = child.pid;
  if (pid === undefined) {
    return { kind: "failed", detail: "the upgrade process was created without a pid" };
  }

  try {
    writeFileSync(pidfilePath, `${JSON.stringify({ pid, startedAt } satisfies UpgradePidfile)}\n`);
  } catch {
    // The upgrade is already running and refusing to say so would be a lie. The
    // only thing lost is the guard against a second trigger, and a second
    // trigger is a worse outcome than no guard only if it happens — whereas
    // reporting a failure here would strand a real upgrade nobody is watching.
  }

  return { kind: "started", reportPath, consolePath, pid };
}

/** Clears the guard. Exposed for the tests that prove a stale file is not a refusal. */
export function clearInFlight(corpusDir: string): void {
  rmSync(join(corpusDir, UPGRADE_PIDFILE_NAME), { force: true });
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
