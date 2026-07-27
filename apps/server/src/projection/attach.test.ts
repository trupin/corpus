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

  it("survives a second close, because disposers run once", async () => {
    const server = createServer(makeConfig(), { logger: silentLogger });
    const db = attachProjection(server);
    await server.close();
    await server.close();
    expect(db.sqlite.open).toBe(false);
  });
});
