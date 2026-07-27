import type { Health } from "@corpus/contract";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliClient } from "../../client.js";
import { ServerUnreachableError } from "../../errors.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import { writePidfile, type PidfileRecord } from "./daemon.js";
import { inspectServer, probeHealth } from "./state.js";

afterEach(removeTempDirs);

const HEALTH: Health = {
  status: "ok",
  version: "1.2.3",
  uptimeSeconds: 12.6,
  workspace: "/ws",
};

const RECORD: PidfileRecord = {
  pid: process.pid,
  port: 8790,
  startedAt: "2026-07-26T10:00:00.000Z",
  version: "1.2.3",
};

function clientAnswering(health: Health | undefined): CliClient {
  return {
    baseUrl: "http://127.0.0.1:8790",
    api: undefined as never,
    request: <T>() =>
      health === undefined
        ? Promise.reject(new ServerUnreachableError("nothing there"))
        : Promise.resolve(health as T),
  };
}

function pidfileIn(label: string, record?: PidfileRecord): string {
  const path = join(makeTempDir(label), "server.pid");
  if (record !== undefined) writePidfile(path, record);
  return path;
}

describe("probeHealth", () => {
  it("returns the payload when the server answers", async () => {
    expect(await probeHealth(clientAnswering(HEALTH))).toEqual(HEALTH);
  });

  it("turns any transport failure into 'not there' rather than throwing", async () => {
    expect(await probeHealth(clientAnswering(undefined))).toBeUndefined();
  });
});

describe("inspectServer", () => {
  it("is stopped with no pidfile", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-none"),
      probe: () => Promise.resolve(HEALTH),
    });
    expect(state.kind).toBe("stopped");
  });

  it("is stale when the recorded pid is gone — a kill -9 leaves exactly this", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-stale", { ...RECORD, pid: 0x7ffffffe }),
      probe: () => Promise.resolve(HEALTH),
    });
    expect(state).toMatchObject({ kind: "stale" });
  });

  it("is unowned when the pid is alive but nothing answers on its port", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-unowned", RECORD),
      probe: () => Promise.resolve(undefined),
    });
    expect(state).toMatchObject({ kind: "unowned", record: { pid: process.pid } });
  });

  it("is running only when the pid is alive and the port identifies as ours", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-running", RECORD),
      probe: () => Promise.resolve(HEALTH),
    });
    expect(state).toMatchObject({ kind: "running", health: HEALTH });
  });

  it("never asks the network about a pid that does not exist", async () => {
    let probed = 0;
    await inspectServer({
      pidfilePath: pidfileIn("state-noprobe", { ...RECORD, pid: 0x7ffffffe }),
      probe: () => {
        probed += 1;
        return Promise.resolve(HEALTH);
      },
    });
    expect(probed).toBe(0);
  });
});
