import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InternalError } from "../../errors.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import {
  isProcessAlive,
  readPidfile,
  removePidfile,
  resolveServerEntry,
  serverEntryCandidates,
  spawnServer,
  startBanner,
  waitForExit,
  waitForHealth,
  writePidfile,
  type PidfileRecord,
  type SpawnFn,
} from "./daemon.js";

afterEach(removeTempDirs);

const RECORD: PidfileRecord = {
  pid: 4242,
  port: 8790,
  startedAt: "2026-07-26T10:00:00.000Z",
  version: "1.2.3",
};

describe("the pidfile", () => {
  it("round-trips", () => {
    const path = join(makeTempDir("pidfile"), ".corpus", "server.pid");
    writePidfile(path, RECORD);
    expect(readPidfile(path)).toEqual(RECORD);
  });

  it("reads as absent when it is missing, truncated or the wrong shape", () => {
    const dir = makeTempDir("pidfile-bad");
    expect(readPidfile(join(dir, "missing.pid"))).toBeUndefined();

    writeFileSync(join(dir, "truncated.pid"), '{"pid": 12');
    expect(readPidfile(join(dir, "truncated.pid"))).toBeUndefined();

    writeFileSync(join(dir, "shape.pid"), '{"pid": -1, "port": 8790}');
    expect(readPidfile(join(dir, "shape.pid"))).toBeUndefined();
  });

  it("reports whether removal had anything to remove", () => {
    const path = join(makeTempDir("pidfile-rm"), "server.pid");
    expect(removePidfile(path)).toBe(false);
    writePidfile(path, RECORD);
    expect(removePidfile(path)).toBe(true);
    expect(readPidfile(path)).toBeUndefined();
  });
});

describe("isProcessAlive", () => {
  it("is true for this process and false for one that has exited", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    // A pid above the platform maximum can never be live.
    expect(isProcessAlive(0x7fffffff)).toBe(false);
  });

  it("counts a process owned by someone else as taken", () => {
    const eperm = () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    };
    expect(isProcessAlive(1, eperm)).toBe(true);
  });
});

describe("startBanner", () => {
  it("delimits each run with its timestamp, pid and port", () => {
    expect(startBanner(RECORD)).toBe(
      "--- corpus server start 2026-07-26T10:00:00.000Z pid=4242 port=8790 ---\n",
    );
  });
});

describe("resolveServerEntry", () => {
  it("prefers the packaged layout and needs no loader for it", () => {
    const packageRoot = makeTempDir("entry-packaged");
    mkdirSync(join(packageRoot, "server"), { recursive: true });
    writeFileSync(join(packageRoot, "server", "main.js"), "");

    const entry = resolveServerEntry(packageRoot);
    expect(entry.layout).toBe("packaged");
    expect(entry.nodeArgs).toEqual([]);
  });

  it("falls back to the monorepo source, which needs the TypeScript loader", () => {
    const apps = makeTempDir("entry-source");
    const packageRoot = join(apps, "cli");
    mkdirSync(packageRoot);
    mkdirSync(join(apps, "server", "src"), { recursive: true });
    writeFileSync(join(apps, "server", "src", "main.ts"), "");

    const entry = resolveServerEntry(packageRoot);
    expect(entry.layout).toBe("source");
    expect(entry.nodeArgs[0]).toBe("--import");
    expect(entry.nodeArgs[1]).toMatch(/^file:\/\/.*tsx/);
  });

  it("names every path it looked at when the server is missing", () => {
    const packageRoot = makeTempDir("entry-missing");
    const error = (() => {
      try {
        resolveServerEntry(packageRoot);
        return undefined;
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(InternalError);
    expect((error as InternalError).details).toEqual({
      searched: serverEntryCandidates(packageRoot).map((c) => c.modulePath),
    });
  });
});

describe("spawnServer", () => {
  function capture(): { spawn: SpawnFn; calls: unknown[][] } {
    const calls: unknown[][] = [];
    const child = { pid: 99, unref: () => undefined, once: () => child };
    const spawn = ((...args: unknown[]) => {
      calls.push(args);
      return child;
    }) as unknown as SpawnFn;
    return { spawn, calls };
  }

  it("detaches, redirects both streams to the log, and unrefs", () => {
    const { spawn, calls } = capture();
    spawnServer({
      workspaceRoot: "/ws",
      entry: { modulePath: "/tool/main.js", nodeArgs: [], layout: "packaged" },
      logFd: 7,
      env: {},
      spawn,
    });

    expect(calls[0]?.[0]).toBe(process.execPath);
    expect(calls[0]?.[1]).toEqual(["/tool/main.js"]);
    expect(calls[0]?.[2]).toMatchObject({
      cwd: "/ws",
      detached: true,
      stdio: ["ignore", 7, 7],
    });
  });

  it("passes CORPUS_WORKSPACE and never invents a token or a port", () => {
    const { spawn, calls } = capture();
    spawnServer({
      workspaceRoot: "/ws",
      entry: { modulePath: "/tool/main.js", nodeArgs: ["--import", "loader"], layout: "source" },
      logFd: 7,
      env: { PATH: "/usr/bin" },
      spawn,
    });

    expect(calls[0]?.[1]).toEqual(["--import", "loader", "/tool/main.js"]);
    const options = calls[0]?.[2] as { env: Record<string, string | undefined> };
    expect(options.env).toEqual({ PATH: "/usr/bin", CORPUS_WORKSPACE: "/ws" });
    expect(options.env.CORPUS_TOKEN).toBeUndefined();
    expect(options.env.CORPUS_PORT).toBeUndefined();
  });

  /**
   * Regression: git exports its whole namespace to the hooks it runs, so
   * `corpus server start` from inside one used to hand `GIT_DIR` & co. to a
   * *long-lived* daemon — the workspace's sole writer, which auto-commits on
   * every mutation. Every one of those commits would have landed in the hook's
   * repository for as long as the server ran.
   */
  it("strips inherited GIT_* variables so the daemon's auto-commits cannot be redirected", () => {
    const { spawn, calls } = capture();
    spawnServer({
      workspaceRoot: "/ws",
      entry: { modulePath: "/tool/main.js", nodeArgs: [], layout: "packaged" },
      logFd: 7,
      env: {
        PATH: "/usr/bin",
        HOME: "/home/operator",
        GIT_DIR: "/elsewhere/.git",
        GIT_WORK_TREE: "/elsewhere",
        GIT_INDEX_FILE: "/elsewhere/.git/index",
        GIT_OBJECT_DIRECTORY: "/elsewhere/.git/objects",
        GIT_AUTHOR_NAME: "Hook Leak",
        GIT_AUTHOR_EMAIL: "leak@hook.invalid",
        GIT_COMMITTER_NAME: "Hook Leak",
        GIT_COMMITTER_EMAIL: "leak@hook.invalid",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "user.name",
        GIT_CONFIG_VALUE_0: "Hook Config",
      },
      spawn,
    });

    const options = calls[0]?.[2] as { env: Record<string, string | undefined> };
    expect(Object.keys(options.env).filter((name) => name.startsWith("GIT_"))).toEqual([]);
    // Everything outside git's namespace still reaches the child.
    expect(options.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/operator",
      CORPUS_WORKSPACE: "/ws",
    });
  });
});

describe("waitForHealth", () => {
  const noSleep = () => Promise.resolve();

  it("returns the payload as soon as the server answers", async () => {
    let attempts = 0;
    const result = await waitForHealth({
      probe: () => Promise.resolve(++attempts >= 3 ? { version: "1" } : undefined),
      sleep: noSleep,
    });
    expect(result).toEqual({ kind: "healthy", payload: { version: "1" } });
    expect(attempts).toBe(3);
  });

  it("stops waiting the moment the child dies", async () => {
    const result = await waitForHealth({
      probe: () => Promise.resolve(undefined),
      hasExited: () => true,
      sleep: noSleep,
    });
    expect(result).toEqual({ kind: "exited" });
  });

  it("times out against something that accepts but never answers", async () => {
    let clock = 0;
    const result = await waitForHealth({
      probe: () => Promise.resolve(undefined),
      timeoutMs: 500,
      intervalMs: 100,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      now: () => clock,
    });
    expect(result).toEqual({ kind: "timeout" });
    expect(clock).toBeGreaterThanOrEqual(500);
  });
});

describe("waitForExit", () => {
  it("is immediate when the process is already gone", async () => {
    expect(await waitForExit({ pid: 1, isAlive: () => false })).toBe(true);
  });

  it("reports failure when the process outlives the window", async () => {
    let clock = 0;
    expect(
      await waitForExit({
        pid: 1,
        isAlive: () => true,
        timeoutMs: 300,
        intervalMs: 100,
        sleep: (ms) => {
          clock += ms;
          return Promise.resolve();
        },
        now: () => clock,
      }),
    ).toBe(false);
  });

  it("returns true once the process disappears mid-wait", async () => {
    let alive = 3;
    expect(
      await waitForExit({
        pid: 1,
        isAlive: () => alive-- > 0,
        sleep: () => Promise.resolve(),
      }),
    ).toBe(true);
  });
});
