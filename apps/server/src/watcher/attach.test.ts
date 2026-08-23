import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { createServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { silentLogger } from "../logger.js";
import {
  REBUILD_QUERY_KEYS,
  attachProjection,
  openWorkspaceProjection,
} from "../projection/index.js";
import { attachWatcher } from "./attach.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";

let root: string;
let workspaceRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s007-attach-"));
  workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(): ServerConfig {
  return {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
    attachments: DEFAULT_ATTACHMENT_LIMITS,
    dataDir: join(workspaceRoot, "data"),
    configPath: join(workspaceRoot, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    version: "9.9.9",
    logLevel: "silent",
    uiDistDir: undefined,
    embedding: { kind: "absent" },
    warnings: [],
  };
}

describe("attachWatcher", () => {
  it("watches the workspace and broadcasts through the server's own bus", async () => {
    const config = makeConfig();
    const projection = openWorkspaceProjection(config, silentLogger);
    const server = createServer(config, { logger: silentLogger, projection, heartbeatMs: 0 });
    attachProjection(server);

    const batches: QueryKey[][] = [];
    server.bus.subscribe((keys) => batches.push([...keys]));

    const watcher = attachWatcher(server);
    expect(watcher).toBeDefined();
    await watcher?.ready;
    await new Promise((resolve) => setTimeout(resolve, 300));

    writeFileSync(
      join(workspaceRoot, "data", "docs", "a.md"),
      "---\nid: doc_aaa\ntype: note\ntitle: A\n---\n\nBody.\n",
      "utf8",
    );

    await vi.waitFor(
      () => {
        expect(batches.flat().map((key) => JSON.stringify(key))).toContain(
          JSON.stringify(["docs", "doc_aaa"]),
        );
      },
      { timeout: 8000, interval: 25 },
    );
    expect(projection.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_aaa" }]);

    // The disposer runs before the projection's, because disposers unwind in
    // reverse registration order.
    await server.close();
    expect(projection.sqlite.open).toBe(false);
  });

  /**
   * SERVER-025, through the real chokidar. The file is written between the boot
   * scan and `attachWatcher`, which is exactly the shape of the window: the scan
   * has already run, and `ignoreInitial: true` means the watcher's initial walk
   * will find the file and say nothing about it. Before the catch-up, this row
   * never appeared — measured on a real server as 30 documents lost in a 290 ms
   * band, still missing a minute later.
   */
  it("projects a file that landed in the window between the boot scan and the watcher", async () => {
    const config = makeConfig();
    writeFileSync(
      join(workspaceRoot, "data", "docs", "scanned.md"),
      "---\nid: doc_scanned\ntype: note\ntitle: Scanned\n---\n\nPresent at boot.\n",
      "utf8",
    );
    const projection = openWorkspaceProjection(config, silentLogger);
    expect(projection.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_scanned" }]);

    const server = createServer(config, { logger: silentLogger, projection, heartbeatMs: 0 });
    attachProjection(server);
    const batches: QueryKey[][] = [];
    server.bus.subscribe((keys) => batches.push([...keys]));

    // The window: after the scan, before anything is watching.
    writeFileSync(
      join(workspaceRoot, "data", "docs", "missed.md"),
      "---\nid: doc_missed\ntype: note\ntitle: Missed\n---\n\nWritten into the window.\n",
      "utf8",
    );

    const watcher = attachWatcher(server);
    try {
      await vi.waitFor(
        () => {
          expect(projection.prepare("SELECT id FROM documents ORDER BY id").all()).toEqual([
            { id: "doc_missed" },
            { id: "doc_scanned" },
          ]);
        },
        { timeout: 8000, interval: 25 },
      );
      expect(batches).toEqual([[...REBUILD_QUERY_KEYS, ["reflect"]]]);
    } finally {
      await watcher?.close();
      await server.close();
    }
  });

  it("does nothing when the server was built without a projection", () => {
    const server = createServer(makeConfig(), { logger: silentLogger, heartbeatMs: 0 });
    expect(attachWatcher(server)).toBeUndefined();
  });
});
