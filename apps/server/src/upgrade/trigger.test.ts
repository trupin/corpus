import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpawnFn } from "./trigger.js";
import {
  IN_FLIGHT_MAX_MS,
  UPGRADE_CONSOLE_NAME,
  UPGRADE_PIDFILE_NAME,
  UPGRADE_REPORT_NAME,
  clearInFlight,
  processIsAlive,
  readInFlight,
  startDetachedUpgrade,
  upgradeBanner,
} from "./trigger.js";

let root: string;
let workspaceRoot: string;
let corpusDir: string;
let packageRoot: string;

const NOW = new Date("2026-08-26T10:00:00.000Z");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-upgrade-"));
  workspaceRoot = join(root, "ws");
  corpusDir = join(workspaceRoot, ".corpus");
  packageRoot = join(root, "pkg");
  mkdirSync(corpusDir, { recursive: true });
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(join(packageRoot, "dist", "corpus.js"), "// fixture\n", "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Recorded {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: Parameters<SpawnFn>[2];
}

function recordingSpawn(pid: number | undefined): {
  readonly spawn: SpawnFn;
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    calls.push({ command, args, options });
    return { pid, unref: () => undefined } as unknown as ReturnType<SpawnFn>;
  };
  return { spawn, calls };
}

function options(overrides: Partial<Parameters<typeof startDetachedUpgrade>[0]> = {}) {
  return {
    workspaceRoot,
    corpusDir,
    packageRoot,
    env: { PATH: "/usr/bin" },
    isAlive: () => true,
    now: () => NOW,
    ...overrides,
  };
}

describe("startDetachedUpgrade", () => {
  it("spawns the packaged CLI's `upgrade`, detached, with both streams in the log", () => {
    const { spawn: fake, calls } = recordingSpawn(4242);
    const result = startDetachedUpgrade(options({ spawn: fake }));

    expect(result).toEqual({
      kind: "started",
      reportPath: join(corpusDir, "upgrade.log"),
      consolePath: join(corpusDir, "upgrade-console.log"),
      pid: 4242,
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.command).toBe(process.execPath);
    expect(call?.args).toEqual([join(packageRoot, "dist", "corpus.js"), "upgrade"]);
    expect(call?.options.detached).toBe(true);
    expect(call?.options.cwd).toBe(workspaceRoot);
    // Same descriptor for stdout and stderr: a detached child's only witness is
    // the file, and a pipe this process stops reading is no witness at all.
    const stdio = call?.options.stdio as [string, number, number];
    expect(stdio[0]).toBe("ignore");
    expect(stdio[1]).toBe(stdio[2]);
    expect(typeof stdio[1]).toBe("number");
  });

  it("passes the workspace and nothing invented", () => {
    const { spawn: fake, calls } = recordingSpawn(4242);
    startDetachedUpgrade(options({ spawn: fake }));

    expect(calls[0]?.options.env).toEqual({ PATH: "/usr/bin", CORPUS_WORKSPACE: workspaceRoot });
    // No token. The upgrade reads `.corpus/config.json` exactly as `corpus
    // server start` does, and a secret in an environment nobody reads is
    // exposure with no reader.
    expect(JSON.stringify(calls[0]?.options.env)).not.toContain("TOKEN");
  });

  it("writes the console log's banner before the child owns the file", () => {
    const { spawn: fake } = recordingSpawn(4242);
    startDetachedUpgrade(options({ spawn: fake }));

    const log = readFileSync(join(corpusDir, UPGRADE_CONSOLE_NAME), "utf8");
    expect(log.startsWith(`--- corpus upgrade ${NOW.toISOString()} `)).toBe(true);
    // The command is in the banner, so the log answers "what was actually run"
    // for a person reading it after the server that ran it was replaced.
    expect(log).toContain(join(packageRoot, "dist", "corpus.js"));
    expect(log.trimEnd().endsWith("upgrade ---")).toBe(true);
    expect(upgradeBanner("t", "cmd")).toBe("--- corpus upgrade t cmd ---\n");
  });

  it("truncates the console log, so it always describes the last upgrade", () => {
    writeFileSync(join(corpusDir, UPGRADE_CONSOLE_NAME), "an older run said this\n", "utf8");
    const { spawn: fake } = recordingSpawn(4242);
    startDetachedUpgrade(options({ spawn: fake }));

    expect(readFileSync(join(corpusDir, UPGRADE_CONSOLE_NAME), "utf8")).not.toContain(
      "an older run",
    );
  });

  /*
   * The bug this split exists for. Redirecting the child's output into the
   * report gave one file two writers: the CLI truncates it at the start of its
   * run, wiping the banner, and then every line landed twice — once through
   * stdout and once through the report itself. Observed on a real run before it
   * was fixed.
   */
  it("does not touch the report the CLI owns", () => {
    writeFileSync(join(corpusDir, UPGRADE_REPORT_NAME), "the previous run's report\n", "utf8");
    const { spawn: fake, calls } = recordingSpawn(4242);
    startDetachedUpgrade(options({ spawn: fake }));

    expect(readFileSync(join(corpusDir, UPGRADE_REPORT_NAME), "utf8")).toBe(
      "the previous run's report\n",
    );
    // And the descriptor the child writes through is the console log's, not the
    // report's — which is the thing that made them collide.
    expect(existsSync(join(corpusDir, UPGRADE_CONSOLE_NAME))).toBe(true);
    expect(calls[0]?.options.stdio).toBeDefined();
  });

  /**
   * The report's name is declared twice — here and in `apps/cli/src/paths.ts`,
   * which is the half that actually creates the file — because apps do not
   * import apps. A comment saying "keep these in sync" is not a guard, so this
   * reads the CLI's declaration and fails if it moves. The alternative was
   * lifting the constant into `@corpus/contract`; it was rejected as a third
   * contract change for one string, and this catches the same drift.
   */
  it("names the report the CLI actually writes", () => {
    const cliPaths = resolve(import.meta.dirname, "..", "..", "..", "cli", "src", "paths.ts");
    const source = readFileSync(cliPaths, "utf8");
    expect(source).toContain(`export const UPGRADE_LOGFILE = "${UPGRADE_REPORT_NAME}";`);
  });

  it("records the child's pid as the guard", () => {
    const { spawn: fake } = recordingSpawn(777);
    startDetachedUpgrade(options({ spawn: fake }));

    const record: unknown = JSON.parse(readFileSync(join(corpusDir, UPGRADE_PIDFILE_NAME), "utf8"));
    expect(record).toEqual({ pid: 777, startedAt: NOW.toISOString() });
  });

  it("refuses a second trigger while the first is alive", () => {
    const { spawn: fake, calls } = recordingSpawn(4242);
    startDetachedUpgrade(options({ spawn: fake }));
    const second = startDetachedUpgrade(options({ spawn: fake }));

    expect(second).toEqual({ kind: "in-flight", startedAt: NOW.toISOString() });
    // The refusal is the point: two installs racing over one npm prefix is how
    // a working installation becomes a broken one.
    expect(calls).toHaveLength(1);
  });

  it("does not refuse when the recorded process has gone", () => {
    const { spawn: fake, calls } = recordingSpawn(4242);
    startDetachedUpgrade(options({ spawn: fake }));
    const second = startDetachedUpgrade(options({ spawn: fake, isAlive: () => false }));

    expect(second.kind).toBe("started");
    expect(calls).toHaveLength(2);
  });

  it("does not refuse over a record older than the in-flight window", () => {
    const { spawn: fake } = recordingSpawn(4242);
    startDetachedUpgrade(options({ spawn: fake }));

    const later = new Date(NOW.getTime() + IN_FLIGHT_MAX_MS + 1);
    const second = startDetachedUpgrade(options({ spawn: fake, now: () => later }));
    expect(second.kind).toBe("started");
  });

  it("reports where it looked when the CLI is missing, and starts nothing", () => {
    const { spawn: fake, calls } = recordingSpawn(4242);
    const result = startDetachedUpgrade(options({ spawn: fake, packageRoot: join(root, "gone") }));

    expect(result.kind).toBe("no-cli");
    expect(calls).toHaveLength(0);
    // Nothing was written either: a broken installation must not leave a
    // pidfile that refuses every later attempt.
    expect(existsSync(join(corpusDir, UPGRADE_PIDFILE_NAME))).toBe(false);
  });

  it("reports a spawn that throws rather than claiming an upgrade started", () => {
    const failing: SpawnFn = () => {
      throw new Error("EACCES");
    };
    const result = startDetachedUpgrade(options({ spawn: failing }));
    expect(result).toEqual({ kind: "failed", detail: "the upgrade could not be started (EACCES)" });
  });

  it("reports a child created without a pid", () => {
    const { spawn: fake } = recordingSpawn(undefined);
    expect(startDetachedUpgrade(options({ spawn: fake })).kind).toBe("failed");
  });

  it("creates `.corpus/` when it is not there", () => {
    rmSync(corpusDir, { recursive: true, force: true });
    const { spawn: fake } = recordingSpawn(4242);
    expect(startDetachedUpgrade(options({ spawn: fake })).kind).toBe("started");
    expect(existsSync(join(corpusDir, UPGRADE_CONSOLE_NAME))).toBe(true);
  });
});

describe("readInFlight", () => {
  const pidfilePath = () => join(corpusDir, UPGRADE_PIDFILE_NAME);

  it("is null when there is no file", () => {
    expect(readInFlight(pidfilePath(), () => true, NOW)).toBeNull();
  });

  it("is null for a file that is not JSON, rather than throwing", () => {
    writeFileSync(pidfilePath(), "half a write", "utf8");
    expect(readInFlight(pidfilePath(), () => true, NOW)).toBeNull();
  });

  it("is null for JSON that is not a record this guard wrote", () => {
    writeFileSync(pidfilePath(), JSON.stringify({ pid: "not a number" }), "utf8");
    expect(readInFlight(pidfilePath(), () => true, NOW)).toBeNull();
  });

  it("is null for an unparseable timestamp", () => {
    writeFileSync(pidfilePath(), JSON.stringify({ pid: 5, startedAt: "whenever" }), "utf8");
    expect(readInFlight(pidfilePath(), () => true, NOW)).toBeNull();
  });

  it("reads back a live, recent record", () => {
    writeFileSync(pidfilePath(), JSON.stringify({ pid: 5, startedAt: NOW.toISOString() }), "utf8");
    expect(readInFlight(pidfilePath(), () => true, NOW)).toEqual({
      pid: 5,
      startedAt: NOW.toISOString(),
    });
  });
});

describe("clearInFlight", () => {
  it("removes the guard, and does not mind it already being gone", () => {
    writeFileSync(join(corpusDir, UPGRADE_PIDFILE_NAME), "{}", "utf8");
    clearInFlight(corpusDir);
    expect(existsSync(join(corpusDir, UPGRADE_PIDFILE_NAME))).toBe(false);
    expect(() => {
      clearInFlight(corpusDir);
    }).not.toThrow();
  });
});

describe("processIsAlive", () => {
  it("says this process is alive and an implausible pid is not", () => {
    expect(processIsAlive(process.pid)).toBe(true);
    expect(processIsAlive(0x7ffffff)).toBe(false);
  });
});

/**
 * The acceptance criterion no stub can stand in for: **the spawned upgrade
 * actually survives the server that started it**. `corpus upgrade`'s last act is
 * restarting this process, so a child that dies with its parent would take the
 * upgrade down at exactly the moment it mattered.
 *
 * Real processes, no fakes: a parent that spawns a sleeping grandchild through
 * `startDetachedUpgrade`'s own options, then is killed. The grandchild writes to
 * a file after the parent is gone; the file existing is the proof.
 */
describe("detachment, against real processes", () => {
  /**
   * `detached: true` on POSIX makes the child a **process-group leader**, and
   * that is the whole mechanism: a child in its parent's group dies when the
   * group is signalled, and a group leader does not. So the test signals the
   * group, which is the thing detachment actually defends against — killing the
   * parent's pid alone proves nothing, because nothing kills a child for its
   * parent's death on this platform anyway.
   */
  async function survivesGroupKill(childDetached: boolean): Promise<boolean> {
    const marker = join(root, `survived-${String(childDetached)}.txt`);
    const child = join(root, "child.js");
    writeFileSync(
      child,
      `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'); }, 1200);\n`,
      "utf8",
    );
    const parent = join(root, "parent.js");
    writeFileSync(
      parent,
      "const { spawn } = require('node:child_process');\n" +
        `const c = spawn(process.execPath, [${JSON.stringify(child)}], ` +
        `{ detached: ${String(childDetached)}, stdio: 'ignore' });\n` +
        "c.unref();\n" +
        "setInterval(() => {}, 1000);\n",
      "utf8",
    );

    // The parent leads its own group too, so the kill below reaches it and its
    // undetached descendants and nothing of this test runner's.
    const running = spawn(process.execPath, [parent], { detached: true, stdio: "ignore" });
    await new Promise((done) => setTimeout(done, 400));
    process.kill(-(running.pid ?? 0), "SIGKILL");
    await new Promise((done) => setTimeout(done, 1600));
    return existsSync(marker);
  }

  it("leaves the upgrade running when the group its server led is killed", async () => {
    expect(await survivesGroupKill(true)).toBe(true);
  }, 20_000);

  /*
   * The converse, in the suite rather than in a note: the same fixture without
   * `detached` dies with the group. Without this, the assertion above passes on
   * a platform where nothing was ever at risk, and would keep passing if
   * `startDetachedUpgrade` dropped the flag.
   */
  it("and would not, without the flag", async () => {
    expect(await survivesGroupKill(false)).toBe(false);
  }, 20_000);
});
