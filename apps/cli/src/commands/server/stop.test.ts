import type { Health } from "@corpus/contract";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTOR } from "@corpus/contract";
import type { CliClient } from "../../client.js";
import { ServerUnreachableError } from "../../errors.js";
import { serverPidfilePath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import type { Workspace } from "../../workspace.js";
import { writePidfile, type PidfileRecord } from "./daemon.js";
import { stopCommand } from "./stop.js";

afterEach(removeTempDirs);

const HEALTH: Health = { status: "ok", version: "1.2.3", uptimeSeconds: 1, workspace: "/ws" };

function client(health: Health | undefined): CliClient {
  return {
    baseUrl: "http://127.0.0.1:8790",
    api: undefined as never,
    untimedApi: undefined as never,
    request: <T>() =>
      health === undefined
        ? Promise.reject(new ServerUnreachableError("nothing there"))
        : Promise.resolve(health as T),
  };
}

function workspaceAt(root: string): Workspace {
  return {
    root,
    configPath: join(root, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 8790,
    token: "t",
    dataDir: "data",
    baseUrl: "http://127.0.0.1:8790",
  };
}

async function stop(options: {
  readonly label: string;
  readonly record?: PidfileRecord;
  readonly health?: Health;
  readonly json?: boolean;
}) {
  const root = makeTempDir(options.label);
  if (options.record !== undefined) writePidfile(serverPidfilePath(root), options.record);
  const harness = createTestContext({ json: options.json ?? false });
  await stopCommand.handler({
    ...harness.context,
    workspace: workspaceAt(root),
    client: client(options.health),
    actor: DEFAULT_ACTOR,
  });
  return { root, output: harness.stdout() };
}

describe("corpus server stop", () => {
  it("is not an error when nothing is running", async () => {
    const { output } = await stop({ label: "stop-none" });
    expect(output).toBe("not running\n");
  });

  it("cleans a pidfile whose process is gone", async () => {
    const { root, output } = await stop({
      label: "stop-stale",
      record: {
        pid: 0x7ffffffe,
        port: 8790,
        startedAt: "2026-07-26T10:00:00.000Z",
        version: "1.2.3",
      },
      health: HEALTH,
    });
    expect(output).toBe("not running (stale pidfile removed)\n");
    expect(existsSync(serverPidfilePath(root))).toBe(false);
  });

  it("never signals a live pid because another workspace's server answered", async () => {
    // The dangerous shape: something healthy IS on the port, so a probe that
    // only asked "did anyone answer?" would treat `process.pid` as this
    // workspace's server and SIGTERM the test runner.
    const { root, output } = await stop({
      label: "stop-foreign",
      record: {
        pid: process.pid,
        port: 8791,
        startedAt: "2026-07-26T10:00:00.000Z",
        version: "1.2.3",
      },
      health: { ...HEALTH, workspace: "/elsewhere" },
    });
    expect(output).toContain(":8790 is held by another workspace's server (/elsewhere)");
    expect(output).toContain("was left alone");
    // CLI-009: the live pid is very likely this workspace's own server on the
    // port it was started with (:8791) before `port` was re-pointed at :8790.
    // Deleting its pidfile would strand a daemon `stop` could never reach.
    expect(existsSync(serverPidfilePath(root))).toBe(true);
    expect(output).toContain("pidfile was kept");
    expect(output).toContain("back at 8791");
  });

  it("emits the kept pidfile in the JSON form too", async () => {
    const { output } = await stop({
      label: "stop-foreign-json",
      json: true,
      record: {
        pid: process.pid,
        port: 8791,
        startedAt: "2026-07-26T10:00:00.000Z",
        version: "1.2.3",
      },
      health: { ...HEALTH, workspace: "/elsewhere" },
    });

    expect(JSON.parse(output)).toEqual({
      stopped: false,
      running: false,
      reason: "port held by another workspace",
      pidfileKept: true,
      pid: process.pid,
      pidfilePort: 8791,
      foreignWorkspace: "/elsewhere",
    });
  });

  it("still removes the pidfile of a dead pid when the port is held by another workspace", async () => {
    // The other half of the pair: cleanup is what a *dead* pid earns, whatever
    // is on the port.
    const { root, output } = await stop({
      label: "stop-foreign-dead",
      record: {
        pid: 0x7ffffffe,
        port: 8791,
        startedAt: "2026-07-26T10:00:00.000Z",
        version: "1.2.3",
      },
      health: { ...HEALTH, workspace: "/elsewhere" },
    });

    expect(output).toBe("not running (stale pidfile removed)\n");
    expect(existsSync(serverPidfilePath(root))).toBe(false);
  });

  it("never signals a live pid that is not this workspace's server", async () => {
    // `process.pid` stands in for the reused pid: if `stop` signalled it, this
    // test process would die rather than fail.
    const { root, output } = await stop({
      label: "stop-unowned",
      record: {
        pid: process.pid,
        port: 8790,
        startedAt: "2026-07-26T10:00:00.000Z",
        version: "1.2.3",
      },
    });
    expect(output).toContain("stale pidfile removed");
    expect(output).toContain("was left alone");
    expect(existsSync(serverPidfilePath(root))).toBe(false);
  });
});
