import type { Health } from "@corpus/contract";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTOR } from "@corpus/contract";
import type { CliClient } from "../../client.js";
import { CheckFailedError, ExitCode, ServerUnreachableError, exitCodeFor } from "../../errors.js";
import { serverPidfilePath } from "../../paths.js";
import { createTestContext } from "../../registry/fixtures.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import type { Workspace } from "../../workspace.js";
import { writePidfile, type PidfileRecord } from "./daemon.js";
import { buildReport, renderReport, statusCommand } from "./status.js";
import type { ServerState } from "./state.js";

afterEach(removeTempDirs);

const HEALTH: Health = { status: "ok", version: "1.2.3", uptimeSeconds: 12.6, workspace: "/ws" };

const RECORD: PidfileRecord = {
  pid: process.pid,
  port: 8790,
  startedAt: "2026-07-26T10:00:00.000Z",
  version: "1.2.3",
};

const WORKSPACE = { root: "/ws", baseUrl: "http://127.0.0.1:8790", port: 8790 };

function client(health: Health | undefined): CliClient {
  return {
    baseUrl: WORKSPACE.baseUrl,
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
    baseUrl: WORKSPACE.baseUrl,
  };
}

describe("buildReport", () => {
  it("reports a running server with its health, not just its pidfile", () => {
    const state: ServerState = { kind: "running", record: RECORD, health: HEALTH };
    expect(buildReport(state, WORKSPACE)).toEqual({
      running: true,
      healthy: true,
      workspace: "/ws",
      url: WORKSPACE.baseUrl,
      pid: RECORD.pid,
      port: 8790,
      startedAt: RECORD.startedAt,
      uptimeSeconds: 13,
      version: "1.2.3",
      detail: "ok",
    });
  });

  it("reports a stopped server with the port it would use", () => {
    const report = buildReport({ kind: "stopped" }, WORKSPACE);
    expect(report).toMatchObject({ running: false, pid: null, port: 8790, detail: "not running" });
  });

  it("never presents a stale pid as running", () => {
    const report = buildReport({ kind: "stale", record: RECORD }, WORKSPACE);
    expect(report.running).toBe(false);
    expect(report.pid).toBeNull();
    expect(report.detail).toContain("stale pidfile removed");
  });

  it("names the unanswered port when the pid is alive but the server is not", () => {
    const report = buildReport({ kind: "unowned", record: RECORD }, WORKSPACE);
    expect(report).toMatchObject({ running: false, healthy: false, pid: RECORD.pid });
    expect(report.detail).toContain("is not answering on :8790");
  });
});

describe("renderReport", () => {
  it("renders one line carrying pid, port, version, uptime and url", () => {
    const report = buildReport({ kind: "running", record: RECORD, health: HEALTH }, WORKSPACE);
    expect(renderReport(report)).toBe(
      `running — pid ${String(process.pid)} on :8790, corpus 1.2.3, up 13s, http://127.0.0.1:8790`,
    );
  });

  it("renders the detail alone when it is not running", () => {
    expect(renderReport(buildReport({ kind: "stopped" }, WORKSPACE))).toBe("not running");
  });
});

describe("corpus server status", () => {
  async function run(options: {
    readonly label: string;
    readonly record?: PidfileRecord;
    readonly health?: Health;
    readonly json?: boolean;
  }) {
    const root = makeTempDir(options.label);
    if (options.record !== undefined) writePidfile(serverPidfilePath(root), options.record);
    const harness = createTestContext({ json: options.json ?? false });
    const error = await statusCommand
      .handler({
        ...harness.context,
        workspace: workspaceAt(root),
        client: client(options.health),
        actor: DEFAULT_ACTOR,
      })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);
    return { root, harness, error };
  }

  it("exits 0 when the server is running", async () => {
    const { harness, error } = await run({ label: "status-up", record: RECORD, health: HEALTH });
    expect(error).toBeUndefined();
    expect(harness.stdout()).toContain("running — pid");
  });

  it("reports and exits 6 when the server is stopped", async () => {
    const { harness, error } = await run({ label: "status-down" });
    expect(exitCodeFor(error)).toBe(ExitCode.checkFailed);
    expect(error).toBeInstanceOf(CheckFailedError);
    expect(harness.stdout()).toBe("not running\n");
  });

  it("emits exactly one JSON value on stdout in both states", async () => {
    const up = await run({ label: "status-json-up", record: RECORD, health: HEALTH, json: true });
    expect(JSON.parse(up.harness.stdout())).toMatchObject({ running: true });

    const down = await run({ label: "status-json-down", json: true });
    expect(JSON.parse(down.harness.stdout())).toMatchObject({ running: false, pid: null });
    // The report is emitted first and the failure is raised afterwards, so
    // stdout still carries exactly one value even on the non-zero path.
    expect(down.harness.stdout().trimEnd().split("\n")).toHaveLength(1);
  });

  it("cleans a stale pidfile rather than leaving it for the next command", async () => {
    const { root, error } = await run({
      label: "status-stale",
      record: { ...RECORD, pid: 0x7ffffffe },
      health: HEALTH,
    });
    expect(existsSync(serverPidfilePath(root))).toBe(false);
    expect(exitCodeFor(error)).toBe(ExitCode.checkFailed);
  });

  it("does not remove a pidfile whose pid is alive but unresponsive", async () => {
    const { root, harness, error } = await run({ label: "status-unowned", record: RECORD });
    expect(existsSync(serverPidfilePath(root))).toBe(true);
    expect(harness.stdout()).toContain("is not answering on :8790");
    expect(exitCodeFor(error)).toBe(ExitCode.checkFailed);
  });
});
