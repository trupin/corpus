import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { silentLogger } from "../logger.js";
import { attachProjection } from "./attach.js";
import { cacheDbPath } from "./db.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";

let root: string;
let workspaceRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-attach-"));
  workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "data", "docs", "a.md"),
    `---\nid: doc_aaa\ntype: note\ntitle: A\n---\n\nBody.\n`,
    "utf8",
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(): ServerConfig {
  return {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
    dataDir: join(workspaceRoot, "data"),
    configPath: join(workspaceRoot, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "9.9.9",
    logLevel: "silent",
    uiDistDir: undefined,
    warnings: [],
  };
}

describe("attachProjection", () => {
  it("opens the workspace's projection and closes it with the server", async () => {
    const server = createServer(makeConfig(), { logger: silentLogger });
    const db = attachProjection(server);

    expect(existsSync(cacheDbPath(server.config))).toBe(true);
    expect(db.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_aaa" }]);

    await server.close();
    expect(db.sqlite.open).toBe(false);
  });

  it("hands the queue its events mirror, so a transition lands in the table", async () => {
    const server = createServer(makeConfig(), { logger: silentLogger });
    const db = attachProjection(server);

    const event = await server.queue.enqueue({
      type: "comment.created",
      source: "cli",
      payload: {},
    });
    expect(db.prepare("SELECT id, status FROM events").all()).toEqual([
      { id: event.id, status: "pending" },
    ]);

    await server.queue.claimAll();
    expect(db.prepare("SELECT status FROM events WHERE id = ?").get(event.id)).toEqual({
      status: "in-progress",
    });

    await server.close();
  });

  it("rebuilds the events table from a queue directory seeded while it was down", async () => {
    mkdirSync(join(workspaceRoot, ".corpus", "queue", "pending"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".corpus", "queue", "pending", "evt_seed00000000.json"),
      JSON.stringify({
        id: "evt_seed00000000",
        type: "comment.created",
        created: "2026-07-19T10:05:00Z",
        source: "cli",
        payload: {},
      }),
      "utf8",
    );

    const server = createServer(makeConfig(), { logger: silentLogger });
    const db = attachProjection(server);

    expect(db.prepare("SELECT id, status FROM events").all()).toEqual([
      { id: "evt_seed00000000", status: "pending" },
    ]);
    await server.close();
  });

  it("survives a second close, because disposers run once", async () => {
    const server = createServer(makeConfig(), { logger: silentLogger });
    const db = attachProjection(server);
    await server.close();
    await server.close();
    expect(db.sqlite.open).toBe(false);
  });
});
