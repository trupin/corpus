import type { Health } from "@corpus/contract";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliClient } from "../../client.js";
import { ServerUnreachableError } from "../../errors.js";
import { makeTempDir, removeTempDirs } from "../../testing/temp.js";
import { writePidfile, type PidfileRecord } from "./daemon.js";
import { foreignServerDetail, inspectServer, probeHealth, sameWorkspace } from "./state.js";

afterEach(removeTempDirs);

const OURS = "/ws";

const HEALTH: Health = {
  status: "ok",
  version: "1.2.3",
  uptimeSeconds: 12.6,
  workspace: OURS,
};

/** The same healthy answer, from the server of a workspace next door. */
const FOREIGN_HEALTH: Health = { ...HEALTH, workspace: "/other-ws" };

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
    untimedApi: undefined as never,
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
  it("attributes an answer that names this workspace to us", async () => {
    expect(await probeHealth(clientAnswering(HEALTH), OURS)).toEqual({
      kind: "ours",
      health: HEALTH,
    });
  });

  it("attributes an answer naming another workspace to that workspace, not to ours", async () => {
    expect(await probeHealth(clientAnswering(FOREIGN_HEALTH), OURS)).toEqual({
      kind: "foreign",
      health: FOREIGN_HEALTH,
    });
  });

  it("turns any transport failure into 'not there' rather than throwing", async () => {
    expect(await probeHealth(clientAnswering(undefined), OURS)).toEqual({ kind: "unreachable" });
  });
});

describe("sameWorkspace", () => {
  it("ignores a trailing slash and a non-normalized path", () => {
    expect(sameWorkspace("/ws/a/", "/ws/a")).toBe(true);
    expect(sameWorkspace("/ws/a/../a", "/ws/a")).toBe(true);
  });

  it("distinguishes siblings, and a prefix that is not the same directory", () => {
    expect(sameWorkspace("/ws/a", "/ws/b")).toBe(false);
    expect(sameWorkspace("/ws/a", "/ws/ab")).toBe(false);
  });

  it("follows symlinks, so /tmp and /private/tmp are one workspace", () => {
    const root = makeTempDir("state-symlink");
    const real = join(root, "workspace");
    mkdirSync(real);
    const link = join(root, "link");
    symlinkSync(real, link);

    expect(sameWorkspace(link, real)).toBe(true);
  });

  it("compares paths that no longer exist rather than calling them different", () => {
    const gone = join(makeTempDir("state-gone"), "deleted-workspace");
    expect(sameWorkspace(gone, gone)).toBe(true);
  });
});

describe("foreignServerDetail", () => {
  it("names the port and the workspace that holds it", () => {
    expect(foreignServerDetail(8955, FOREIGN_HEALTH)).toBe(
      ":8955 is held by another workspace's server (/other-ws)",
    );
  });
});

describe("inspectServer", () => {
  it("is stopped with no pidfile", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-none"),
      probe: () => Promise.resolve({ kind: "ours", health: HEALTH }),
    });
    expect(state.kind).toBe("stopped");
  });

  it("is stale when the recorded pid is gone — a kill -9 leaves exactly this", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-stale", { ...RECORD, pid: 0x7ffffffe }),
      probe: () => Promise.resolve({ kind: "ours", health: HEALTH }),
    });
    expect(state).toMatchObject({ kind: "stale" });
  });

  it("is unowned when the pid is alive but nothing answers on its port", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-unowned", RECORD),
      probe: () => Promise.resolve({ kind: "unreachable" }),
    });
    expect(state).toMatchObject({ kind: "unowned", record: { pid: process.pid } });
  });

  it("is foreign — never running — when the port answers for another workspace", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-foreign", RECORD),
      probe: () => Promise.resolve({ kind: "foreign", health: FOREIGN_HEALTH }),
    });
    expect(state).toMatchObject({ kind: "foreign", health: { workspace: "/other-ws" } });
  });

  it("is running only when the pid is alive and the port identifies as ours", async () => {
    const state = await inspectServer({
      pidfilePath: pidfileIn("state-running", RECORD),
      probe: () => Promise.resolve({ kind: "ours", health: HEALTH }),
    });
    expect(state).toMatchObject({ kind: "running", health: HEALTH });
  });

  it("never asks the network about a pid that does not exist", async () => {
    let probed = 0;
    await inspectServer({
      pidfilePath: pidfileIn("state-noprobe", { ...RECORD, pid: 0x7ffffffe }),
      probe: () => {
        probed += 1;
        return Promise.resolve({ kind: "ours" as const, health: HEALTH });
      },
    });
    expect(probed).toBe(0);
  });
});
