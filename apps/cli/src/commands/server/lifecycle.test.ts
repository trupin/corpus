import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTOR } from "@corpus/contract";
import { createClient } from "../../client.js";
import { ExitCode, exitCodeFor } from "../../errors.js";
import { serverLogPath, serverPidfilePath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import { run } from "../../run.js";
import { ephemeralPort, makeTempDir, removeTempDirs } from "../../testing/temp.js";
import { resolveWorkspace, type Workspace } from "../../workspace.js";
import { runInit } from "../init/index.js";
import { isPortFree } from "../init/port.js";
import { isProcessAlive, readPidfile, writePidfile } from "./daemon.js";
import { runStart } from "./start.js";
import { statusCommand } from "./status.js";
import { runStop, stopCommand } from "./stop.js";

/**
 * The lifecycle verbs against a real detached child process, a real socket and a
 * real pidfile. The daemon here is a stand-in `node:http` server rather than
 * `@corpus/server` — `apps/cli` must not depend on `apps/server` — but every
 * other hop is the production one: real `spawn`, real `unref`, real `fetch`
 * through the generated client, real signals.
 */

afterEach(removeTempDirs);

/** A minimal server that answers `/api/health` exactly as the contract declares. */
const STUB_SERVER = `
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CORPUS_WORKSPACE;
const config = JSON.parse(readFileSync(join(root, ".corpus", "config.json"), "utf8"));
const started = Date.now();
console.log("stub server booting for " + root);

createServer((request, response) => {
  if (request.url === "/api/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: "ok",
      version: "9.9.9",
      uptimeSeconds: (Date.now() - started) / 1000,
      workspace: root,
    }));
    return;
  }
  response.writeHead(404).end();
}).listen(config.port, "127.0.0.1", () => {
  console.log("stub server listening on " + config.port);
});

process.on("SIGTERM", () => { process.exit(0); });
`;

const CRASHING_SERVER = `
console.error("Error: listen EADDRINUSE: address already in use 127.0.0.1");
process.exit(1);
`;

/** Binds the port but answers nothing usable: the readiness poll must time out. */
const MUTE_SERVER = `
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CORPUS_WORKSPACE;
const config = JSON.parse(readFileSync(join(root, ".corpus", "config.json"), "utf8"));
console.log("mute server bound, answering 500 to everything");
createServer((_request, response) => { response.writeHead(500).end(); })
  .listen(config.port, "127.0.0.1");
`;

/** Healthy, but deaf to SIGTERM: `stop` has to escalate. */
const STUBBORN_SERVER = STUB_SERVER.replace(
  'process.on("SIGTERM", () => { process.exit(0); });',
  'process.on("SIGTERM", () => { console.log("ignoring SIGTERM"); });',
);

interface Harness {
  readonly root: string;
  readonly workspace: Workspace;
  readonly entryPath: string;
}

async function makeWorkspace(label: string, source = STUB_SERVER): Promise<Harness> {
  const root = makeTempDir(label);
  const init = createTestContext({ cwd: root, flags: { port: await ephemeralPort() } });
  await runInit(init.context);

  const entryPath = join(root, "stub-server.mjs");
  writeFileSync(entryPath, source);

  return {
    root,
    entryPath,
    workspace: resolveWorkspace({ cwd: root, env: {} }),
  };
}

function context(harness: Harness, options: { readonly json?: boolean } = {}) {
  const test = createTestContext({ json: options.json ?? false, version: "9.9.9" });
  return {
    harness: test,
    ctx: {
      ...test.context,
      workspace: harness.workspace,
      client: createClient({ workspace: harness.workspace, timeoutMs: 2000 }),
      actor: DEFAULT_ACTOR,
    },
  };
}

function stubEntry(harness: Harness) {
  return { entry: { modulePath: harness.entryPath, nodeArgs: [], layout: "packaged" } } as const;
}

async function waitForPortToFree(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await isPortFree(port))) {
    if (Date.now() > deadline) throw new Error(`port ${String(port)} was never released`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("the server lifecycle, end to end", () => {
  it("starts a daemon that outlives the command, then stops it cleanly", async () => {
    const harness = await makeWorkspace("life-start");

    const start = context(harness);
    await runStart(start.ctx, stubEntry(harness));

    const record = readPidfile(serverPidfilePath(harness.root));
    expect(record).toBeDefined();
    expect(record?.port).toBe(harness.workspace.port);
    expect(record?.version).toBe("9.9.9");
    expect(isProcessAlive(record?.pid ?? 0)).toBe(true);
    expect(start.harness.stdout()).toContain(`listening on ${harness.workspace.baseUrl}`);

    // The banner delimits the run, and the child's own output followed it.
    const log = readFileSync(serverLogPath(harness.root), "utf8");
    expect(log).toMatch(/^--- corpus server start .* pid=\d+ port=\d+ ---$/m);
    expect(log).toContain("stub server listening on");

    // Status agrees with reality, through a real HTTP round-trip.
    const status = context(harness, { json: true });
    await statusCommand.handler(status.ctx);
    expect(JSON.parse(status.harness.stdout())).toMatchObject({
      running: true,
      healthy: true,
      pid: record?.pid,
      version: "9.9.9",
    });

    // Starting again is idempotent and does not spawn a second process.
    const again = context(harness);
    await runStart(again.ctx, stubEntry(harness));
    expect(again.harness.stdout()).toContain(`already running on :${String(record?.port ?? 0)}`);
    expect(readPidfile(serverPidfilePath(harness.root))?.pid).toBe(record?.pid);

    const stop = context(harness);
    await stopCommand.handler(stop.ctx);
    expect(stop.harness.stdout()).toContain(`stopped (pid ${String(record?.pid ?? 0)})`);
    expect(existsSync(serverPidfilePath(harness.root))).toBe(false);
    expect(isProcessAlive(record?.pid ?? 0)).toBe(false);

    // And stopping a stopped server is not an error.
    const stopAgain = context(harness);
    await stopCommand.handler(stopAgain.ctx);
    expect(stopAgain.harness.stdout()).toBe("not running\n");
  }, 30_000);

  it("surfaces the log tail and leaves no pidfile when the daemon cannot bind", async () => {
    const harness = await makeWorkspace("life-crash", CRASHING_SERVER);
    const start = context(harness);

    const error = await runStart(start.ctx, { ...stubEntry(harness), readyTimeoutMs: 5000 })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect((error as { details: { log: string[] } }).details.log.join("\n")).toContain(
      "EADDRINUSE",
    );
    expect(existsSync(serverPidfilePath(harness.root))).toBe(false);
  }, 30_000);

  it("cleans a pidfile left by a killed server and starts again", async () => {
    const harness = await makeWorkspace("life-stale");
    await runStart(context(harness).ctx, stubEntry(harness));
    const first = readPidfile(serverPidfilePath(harness.root));

    // `kill -9`: the process is gone, the pidfile is not.
    process.kill(first?.pid ?? 0, "SIGKILL");
    while (isProcessAlive(first?.pid ?? 0)) await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(serverPidfilePath(harness.root))).toBe(true);

    const status = context(harness);
    await statusCommand.handler(status.ctx).catch(() => undefined);
    expect(status.harness.stdout()).toContain("stale pidfile removed");
    expect(existsSync(serverPidfilePath(harness.root))).toBe(false);

    const restart = context(harness);
    await runStart(restart.ctx, stubEntry(harness));
    const second = readPidfile(serverPidfilePath(harness.root));
    expect(second?.pid).not.toBe(first?.pid);

    await stopCommand.handler(context(harness).ctx);
  }, 30_000);

  it("exits 6 from the real run loop when the server is not running", async () => {
    const harness = await makeWorkspace("life-exit-code");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await run({
      argv: ["server", "status", "--json"],
      cwd: harness.root,
      env: {},
      stdout: (text) => void stdout.push(text),
      stderr: (text) => void stderr.push(text),
      isTTY: false,
    });

    expect(code).toBe(ExitCode.checkFailed);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ running: false });
    expect(JSON.parse(stderr.join(""))).toMatchObject({ error: { code: "check_failed" } });
  }, 30_000);

  it("keeps two workspaces on separate ports, pidfiles and tokens", async () => {
    const a = await makeWorkspace("life-two-a");
    const b = await makeWorkspace("life-two-b");
    expect(a.workspace.port).not.toBe(b.workspace.port);
    expect(a.workspace.token).not.toBe(b.workspace.token);

    await runStart(context(a).ctx, stubEntry(a));
    await runStart(context(b).ctx, stubEntry(b));

    const statusA = context(a, { json: true });
    const statusB = context(b, { json: true });
    await statusCommand.handler(statusA.ctx);
    await statusCommand.handler(statusB.ctx);

    const reportA = JSON.parse(statusA.harness.stdout()) as { pid: number; port: number };
    const reportB = JSON.parse(statusB.harness.stdout()) as { pid: number; port: number };
    expect(reportA.pid).not.toBe(reportB.pid);
    expect(reportA.port).toBe(a.workspace.port);
    expect(reportB.port).toBe(b.workspace.port);

    await stopCommand.handler(context(a).ctx);
    // Stopping A leaves B running and reachable.
    const stillB = context(b, { json: true });
    await statusCommand.handler(stillB.ctx);
    expect(JSON.parse(stillB.harness.stdout())).toMatchObject({ running: true });

    await stopCommand.handler(context(b).ctx);
  }, 30_000);

  it("kills a child that binds but never becomes ready, and writes no pidfile", async () => {
    const harness = await makeWorkspace("life-mute", MUTE_SERVER);
    const start = context(harness);

    const error = await runStart(start.ctx, { ...stubEntry(harness), readyTimeoutMs: 1500 })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect((error as Error).message).toContain("did not become ready in time");
    expect((error as { details: { log: string[] } }).details.log.join("\n")).toContain(
      "mute server bound",
    );
    expect(existsSync(serverPidfilePath(harness.root))).toBe(false);

    // The child was not left holding the port for the next `start`.
    await waitForPortToFree(harness.workspace.port);
  }, 30_000);

  it("escalates to SIGKILL when the server ignores SIGTERM", async () => {
    const harness = await makeWorkspace("life-stubborn", STUBBORN_SERVER);
    await runStart(context(harness).ctx, stubEntry(harness));
    const record = readPidfile(serverPidfilePath(harness.root));

    const stop = context(harness);
    await runStop(stop.ctx, { termTimeoutMs: 500 });

    expect(stop.harness.stdout()).toContain("it ignored SIGTERM and was killed");
    expect(isProcessAlive(record?.pid ?? 0)).toBe(false);
    expect(existsSync(serverPidfilePath(harness.root))).toBe(false);
  }, 30_000);

  it("refuses to start when another workspace's server holds the port, and writes no pidfile", async () => {
    // Two real workspaces, one port — the shape a copied `.corpus/config.json`
    // or a shared `CORPUS_PORT` produces. Before CLI-008, B's child died
    // EADDRINUSE while the readiness probe was answered by A, so `start`
    // reported success and recorded a pidfile naming the dead child.
    const a = await makeWorkspace("life-contend-a");
    const b = await makeWorkspace("life-contend-b", CRASHING_SERVER);
    await runStart(context(a).ctx, stubEntry(a));

    const contended = {
      ...b,
      workspace: { ...b.workspace, port: a.workspace.port, baseUrl: a.workspace.baseUrl },
    };
    const start = context(contended);
    const error = await runStart(start.ctx, { ...stubEntry(b), readyTimeoutMs: 5000 })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect((error as Error).message).toBe(
      `:${String(a.workspace.port)} is held by another workspace's server (${a.root})`,
    );
    expect(existsSync(serverPidfilePath(b.root))).toBe(false);
    expect(start.harness.stdout()).toBe("");

    // A is untouched by the attempt, and B still reports itself as stopped.
    const statusB = context(contended, { json: true });
    await statusCommand.handler(statusB.ctx).catch(() => undefined);
    expect(JSON.parse(statusB.harness.stdout())).toMatchObject({ running: false, pid: null });

    const statusA = context(a, { json: true });
    await statusCommand.handler(statusA.ctx);
    expect(JSON.parse(statusA.harness.stdout())).toMatchObject({ running: true, healthy: true });

    await stopCommand.handler(context(a).ctx);
  }, 30_000);

  it("refuses to start over a live pid whose port answers for another workspace", async () => {
    // The pidfile names a live process (this test runner) and something healthy
    // IS on the port — the exact pair that used to read as "already running".
    const a = await makeWorkspace("life-foreign-a");
    const b = await makeWorkspace("life-foreign-b");
    await runStart(context(a).ctx, stubEntry(a));

    writePidfile(serverPidfilePath(b.root), {
      pid: process.pid,
      port: a.workspace.port,
      startedAt: new Date().toISOString(),
      version: "9.9.9",
    });
    const contended = {
      ...b,
      workspace: { ...b.workspace, port: a.workspace.port, baseUrl: a.workspace.baseUrl },
    };

    const error = await runStart(context(contended).ctx, stubEntry(b))
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect((error as Error).message).toContain("is held by another workspace's server");
    expect((error as Error).message).toContain(a.root);

    await stopCommand.handler(context(a).ctx);
  }, 30_000);

  it("keeps the pidfile when the port was re-pointed at another workspace, so the daemon stays stoppable", async () => {
    // CLI-009: B's own daemon is alive on the port it was started with, and B's
    // `port` has since been re-pointed at A's — a copied `.corpus/config.json`,
    // an exported `CORPUS_PORT`. `stop` used to delete B's pidfile here, which
    // left B's server running with nothing able to name it: every later `stop`
    // answered "not running" while the daemon kept serving.
    const a = await makeWorkspace("life-repoint-a");
    const b = await makeWorkspace("life-repoint-b");
    await runStart(context(a).ctx, stubEntry(a));
    await runStart(context(b).ctx, stubEntry(b));
    const record = readPidfile(serverPidfilePath(b.root));

    const repointed = {
      ...b,
      workspace: { ...b.workspace, port: a.workspace.port, baseUrl: a.workspace.baseUrl },
    };
    const stop = context(repointed);
    await stopCommand.handler(stop.ctx);

    expect(stop.harness.stdout()).toContain("not stopped");
    expect(stop.harness.stdout()).toContain("is held by another workspace's server");
    expect(stop.harness.stdout()).toContain("pidfile was kept");
    expect(existsSync(serverPidfilePath(b.root))).toBe(true);
    expect(isProcessAlive(record?.pid ?? 0)).toBe(true);

    // A was never signalled, and the surviving pidfile is enough to stop B once
    // the config points back at the port it was started on.
    const recovered = context(b);
    await stopCommand.handler(recovered.ctx);
    expect(recovered.harness.stdout()).toContain(`stopped (pid ${String(record?.pid ?? 0)})`);
    expect(isProcessAlive(record?.pid ?? 0)).toBe(false);
    expect(existsSync(serverPidfilePath(b.root))).toBe(false);

    const statusA = context(a, { json: true });
    await statusCommand.handler(statusA.ctx);
    expect(JSON.parse(statusA.harness.stdout())).toMatchObject({ running: true, healthy: true });

    await stopCommand.handler(context(a).ctx);
  }, 30_000);

  it("refuses to start a second server for this workspace when no pidfile names the first", async () => {
    const harness = await makeWorkspace("life-orphan-daemon");
    await runStart(context(harness).ctx, stubEntry(harness));
    const record = readPidfile(serverPidfilePath(harness.root));

    // The pidfile is gone but the daemon is not — a deleted `.corpus/` file, or
    // a server started by hand. Spawning here would only produce EADDRINUSE.
    rmSync(serverPidfilePath(harness.root));

    const error = await runStart(context(harness).ctx, stubEntry(harness))
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect((error as Error).message).toContain("already listening on");
    expect((error as Error).message).toContain("no pidfile names it");
    expect(existsSync(serverPidfilePath(harness.root))).toBe(false);

    process.kill(record?.pid ?? 0, "SIGTERM");
    await waitForPortToFree(harness.workspace.port);
  }, 30_000);

  it("refuses to start over a live pid that answers nothing", async () => {
    const harness = await makeWorkspace("life-unowned");
    writePidfile(serverPidfilePath(harness.root), {
      pid: process.pid,
      port: harness.workspace.port,
      startedAt: new Date().toISOString(),
      version: "9.9.9",
    });

    const error = await runStart(context(harness).ctx, stubEntry(harness))
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(exitCodeFor(error)).toBe(ExitCode.serverUnreachable);
    expect((error as Error).message).toContain("is alive but is not answering");
  }, 30_000);
});
