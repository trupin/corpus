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
}) {
  const root = makeTempDir(options.label);
  if (options.record !== undefined) writePidfile(serverPidfilePath(root), options.record);
  const harness = createTestContext({});
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
