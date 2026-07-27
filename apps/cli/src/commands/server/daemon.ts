import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { InternalError } from "../../errors.js";
import { sanitizeGitEnv, type ChildEnv } from "../../git-env.js";
import { cliPackageRoot } from "../../version.js";

/**
 * Process supervision for the per-workspace server (SPEC.md §2.1). Supervision
 * cannot go through the process being supervised, which is why the pidfile and
 * the logfile under `.corpus/` are the CLI's own two writes (§2.2 rule 4).
 *
 * Nothing here is global: pidfile, logfile, port and token all live in the
 * workspace, so any number of workspaces run their servers side by side with no
 * registry to keep in sync.
 */

/** How long `corpus server start` waits for the daemon to answer `/api/health`. */
export const READY_TIMEOUT_MS = 15_000;
export const READY_POLL_MS = 100;

/** How long `corpus server stop` waits after SIGTERM before escalating. */
export const STOP_TIMEOUT_MS = 10_000;
export const STOP_POLL_MS = 100;

export const PidfileSchema = z.looseObject({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  startedAt: z.string().min(1),
  version: z.string().min(1),
});

export type PidfileRecord = z.infer<typeof PidfileSchema>;

/**
 * The recorded pidfile, or `undefined` when there is none *or* it does not
 * parse. A corrupt pidfile is indistinguishable from no pidfile for every
 * decision the lifecycle verbs make, and treating it as "running" would be the
 * one answer that is certainly wrong.
 */
export function readPidfile(path: string): PidfileRecord | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    const result = PidfileSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function writePidfile(path: string, record: PidfileRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

/** Removes the pidfile if present; reports whether there was one. */
export function removePidfile(path: string): boolean {
  const existed = existsSync(path);
  rmSync(path, { force: true });
  return existed;
}

export type SignalSender = (pid: number, signal: NodeJS.Signals | 0) => void;

const sendSignal: SignalSender = (pid, signal) => {
  process.kill(pid, signal);
};

/**
 * Whether a process with this pid exists. Signal `0` performs the permission and
 * existence checks without delivering anything — `EPERM` means it exists but is
 * someone else's, which still counts as "the pid is taken".
 */
export function isProcessAlive(pid: number, kill: SignalSender = sendSignal): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionError(error);
  }
}

function isPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
}

export interface ServerEntry {
  /** Absolute path of the module `node` is asked to run. */
  readonly modulePath: string;
  /** Extra `node` arguments it needs — the TypeScript loader in the dev layout. */
  readonly nodeArgs: readonly string[];
  readonly layout: "packaged" | "source";
}

/**
 * Where the server's entry point lives, resolved from the installed package
 * rather than from cwd so a global install works. Two layouts, same shape as
 * `resolveTemplateRoot`: the staged JS the tarball will carry (INFRA-008), and
 * the monorepo's TypeScript source, which needs `tsx` to run.
 */
export function serverEntryCandidates(packageRoot: string = cliPackageRoot()): readonly {
  readonly modulePath: string;
  readonly layout: ServerEntry["layout"];
}[] {
  return [
    { modulePath: join(packageRoot, "server", "main.js"), layout: "packaged" },
    {
      modulePath: resolve(packageRoot, "..", "server", "src", "main.ts"),
      layout: "source",
    },
  ];
}

export function resolveServerEntry(packageRoot: string = cliPackageRoot()): ServerEntry {
  const candidates = serverEntryCandidates(packageRoot);
  const found = candidates.find((candidate) => existsSync(candidate.modulePath));
  if (found === undefined) {
    throw new InternalError("the corpus server is missing from this installation", {
      hint: "Reinstall the `corpus` tool; the server ships inside the package.",
      details: { searched: candidates.map((candidate) => candidate.modulePath) },
    });
  }
  return {
    modulePath: found.modulePath,
    layout: found.layout,
    nodeArgs: found.layout === "source" ? ["--import", tsxLoaderUrl()] : [],
  };
}

/**
 * The `tsx` ESM loader, as a file URL. `--import` resolves bare specifiers
 * against the *child's* cwd — which is the workspace, where `tsx` is not
 * installed — so the absolute URL is the only form that works.
 */
function tsxLoaderUrl(): string {
  try {
    return pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  } catch (cause) {
    throw new InternalError(
      "this is a source checkout of corpus and `tsx` is not installed, so the server cannot be started",
      { hint: "Run `npm install` at the repository root.", cause },
    );
  }
}

export type SpawnFn = typeof nodeSpawn;

export interface SpawnServerOptions {
  readonly workspaceRoot: string;
  readonly entry: ServerEntry;
  /** Open, append-mode descriptor of `.corpus/server.log`; both streams go there. */
  readonly logFd: number;
  readonly env: ChildEnv;
  readonly spawn?: SpawnFn;
}

/**
 * Detached spawn with both output streams redirected to the log, then `unref()`
 * so `corpus server start` can exit while the server keeps running — the daemon
 * outlives the shell that started it.
 *
 * The child's environment is the CLI's own plus `CORPUS_WORKSPACE`, and nothing
 * else. The server takes its port and token from `.corpus/config.json`; there is
 * no `CORPUS_TOKEN` to pass (passing a secret through an environment nobody
 * reads is pure exposure) and synthesizing a `CORPUS_PORT` would let the daemon
 * bind a port the config does not name (sprint-003 Open Conflict 13).
 *
 * Minus git's own namespace, which is stripped by {@link sanitizeGitEnv}. This
 * daemon is the workspace's sole writer and auto-commits on every mutation
 * (SPEC.md §2.2), so a `GIT_DIR` inherited from a hook that ran
 * `corpus server start` would not merely misdirect one command — it would
 * misdirect every commit the server makes for as long as it runs.
 */
export function spawnServer(options: SpawnServerOptions): ChildProcess {
  const spawn = options.spawn ?? nodeSpawn;
  const child = spawn(process.execPath, [...options.entry.nodeArgs, options.entry.modulePath], {
    cwd: options.workspaceRoot,
    detached: true,
    stdio: ["ignore", options.logFd, options.logFd],
    env: { ...sanitizeGitEnv(options.env), CORPUS_WORKSPACE: options.workspaceRoot },
  });
  child.unref();
  return child;
}

/** Delimits one run in the shared logfile, so `corpus server logs` reads as a history. */
export function startBanner(record: Pick<PidfileRecord, "pid" | "port" | "startedAt">): string {
  return `--- corpus server start ${record.startedAt} pid=${String(record.pid)} port=${String(record.port)} ---\n`;
}

export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) =>
  new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });

export interface WaitForHealthOptions<T> {
  /** One probe attempt; resolves the payload when healthy, `undefined` otherwise. */
  readonly probe: () => Promise<T | undefined>;
  /** True once the child has exited — a dead server is not worth waiting out. */
  readonly hasExited?: () => boolean;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly sleep?: Sleep;
  readonly now?: () => number;
}

export type WaitForHealthResult<T> =
  | { readonly kind: "healthy"; readonly payload: T }
  | { readonly kind: "exited" }
  | { readonly kind: "timeout" };

/** Polls until the server answers, the child dies, or the window closes. */
export async function waitForHealth<T>(
  options: WaitForHealthOptions<T>,
): Promise<WaitForHealthResult<T>> {
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? READY_POLL_MS;
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  for (;;) {
    const payload = await options.probe();
    if (payload !== undefined) return { kind: "healthy", payload };
    if (options.hasExited?.() === true) return { kind: "exited" };
    if (now() >= deadline) return { kind: "timeout" };
    await sleep(intervalMs);
  }
}

export interface WaitForExitOptions {
  readonly pid: number;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly isAlive?: (pid: number) => boolean;
  readonly sleep?: Sleep;
  readonly now?: () => number;
}

/** True when the process is gone before the window closes. */
export async function waitForExit(options: WaitForExitOptions): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? STOP_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? STOP_POLL_MS;
  const alive = options.isAlive ?? ((pid: number) => isProcessAlive(pid));
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  for (;;) {
    if (!alive(options.pid)) return true;
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
