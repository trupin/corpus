// Boot wiring: what the server says about the seam, and what it refuses to do
// about it (sprint-021 TEST-843's visible half, TEST-847, TEST-849).

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type CorpusServer } from "../app.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import type { ServerConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { openWorkspaceProjection } from "../projection/index.js";
import { attachSemanticIndex } from "./attach.js";
import { createStaticEmbeddedEngine } from "./embedded-engine.js";
import { writeEmbedding } from "./embeddings.js";
import type { FetchLike } from "./http-provider.js";
import type { EmbeddingSettings } from "./settings.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";

let root: string;
let workspaceRoot: string;
let lines: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s021-semantic-attach-"));
  workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  lines = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const makeConfig = (embedding: EmbeddingSettings): ServerConfig => ({
  workspaceRoot,
  corpusDir: join(workspaceRoot, ".corpus"),
  attachments: DEFAULT_ATTACHMENT_LIMITS,
  dataDir: join(workspaceRoot, "data"),
  configPath: join(workspaceRoot, ".corpus", "config.json"),
  host: "127.0.0.1",
  port: 0,
  token: TOKEN,
  version: "9.9.9",
  logLevel: "info",
  uiDistDir: undefined,
  embedding,
  warnings: [],
});

function boot(embedding: EmbeddingSettings): CorpusServer {
  const config = makeConfig(embedding);
  const logger = createLogger("info", { write: (line) => lines.push(line) });
  const projection = openWorkspaceProjection(config, logger);
  return createServer(config, { logger, projection });
}

const engine = createStaticEmbeddedEngine({
  model: "all-MiniLM-L6-v2",
  embedBatch: (texts) => Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
});

describe("attachSemanticIndex", () => {
  it("reports the resolved provider on one info line", async () => {
    const server = boot({ kind: "absent" });
    const { ready } = attachSemanticIndex(server, { embeddedEngine: engine });

    const report = await ready;

    expect(report.resolution).toMatchObject({ kind: "provider", source: "embedded" });
    expect(lines.join("\n")).toContain("semantic index: local/all-MiniLM-L6-v2@3 (embedded)");
    await server.close();
  });

  it("reports zero config with no engine as disabled, at info level", async () => {
    const server = boot({ kind: "absent" });
    const { ready } = attachSemanticIndex(server);

    await ready;

    const disabled = lines.filter((line) => line.includes("semantic index disabled"));
    expect(disabled).toHaveLength(1);
    expect(disabled[0]).toContain('"level":"info"');
    expect(lines.some((line) => line.includes('"level":"error"'))).toBe(false);
    await server.close();
  });

  /** TEST-843's visible half: an operator watching the log sees the failure. */
  it("reports a configured provider that cannot be reached at error level", async () => {
    const server = boot({
      kind: "configured",
      provider: { kind: "ollama", endpoint: "http://127.0.0.1:9", model: "nomic-embed-text" },
    });
    const fetchFn = vi.fn<FetchLike>(() => Promise.reject(new Error("connect ECONNREFUSED")));

    const { ready } = attachSemanticIndex(server, { fetchFn, embeddedEngine: engine });
    const report = await ready;

    expect(report.resolution).toMatchObject({ kind: "error", reason: "provider-unreachable" });
    const errors = lines.filter((line) => line.includes('"level":"error"'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("semantic index unavailable");
    await server.close();
  });

  /**
   * TEST-849. The whole log is searched, in both directions — a resolution that
   * succeeded and one that failed — because the failure path is where a key
   * would most plausibly leak, quoted back inside somebody else's error body.
   */
  it("never logs key material, on the path that works or the one that fails", async () => {
    const key = "sk-live-attach-9999";
    const configured: EmbeddingSettings = {
      kind: "configured",
      provider: {
        kind: "openai",
        endpoint: "https://api.example.com/v1",
        model: "text-embedding-3-small",
        apiKey: key,
      },
    };

    const ok = boot(configured);
    await attachSemanticIndex(ok, {
      fetchFn: () => Promise.resolve(Response.json({ data: [{ index: 0, embedding: [1, 2] }] })),
    }).ready;
    await ok.close();

    const failing = boot(configured);
    await attachSemanticIndex(failing, {
      fetchFn: () => Promise.resolve(new Response(`rejected key ${key}`, { status: 401 })),
    }).ready;
    await failing.close();

    expect(lines.some((line) => line.includes("semantic index: openai/"))).toBe(true);
    expect(lines.some((line) => line.includes("semantic index unavailable"))).toBe(true);
    expect(lines.filter((line) => line.includes(key))).toEqual([]);
  });

  /**
   * TEST-847 at the boot seam: the mismatch is reported and nothing else
   * happens. Acting on it belongs to SERVER-044.
   */
  it("reports an identity mismatch without touching a single row", async () => {
    const server = boot({ kind: "absent" });
    const db = server.projection;
    if (db === undefined) throw new Error("expected a projection");
    writeEmbedding(db, {
      state: "ready",
      chunkId: "c1",
      identity: "local/all-MiniLM-L6-v2@999",
      vector: Float32Array.from([1, 2, 3]),
      updatedMs: 1,
    });

    const report = await attachSemanticIndex(server, { embeddedEngine: engine }).ready;

    expect(report.check).toEqual({
      kind: "mismatch",
      recorded: "local/all-MiniLM-L6-v2@999",
      resolved: "local/all-MiniLM-L6-v2@3",
    });
    expect(lines.join("\n")).toContain("semantic index identity changed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM chunk_embeddings").get()).toEqual({ n: 1 });
    await server.close();
  });

  it("reports a mixed index loudly, because two identities is drift", async () => {
    const server = boot({ kind: "absent" });
    const db = server.projection;
    if (db === undefined) throw new Error("expected a projection");
    for (const [chunkId, identity] of [
      ["a", "local/one@3"],
      ["b", "local/two@3"],
    ]) {
      writeEmbedding(db, {
        state: "ready",
        chunkId: chunkId ?? "",
        identity: identity ?? "",
        vector: Float32Array.from([1, 2, 3]),
        updatedMs: 1,
      });
    }

    const report = await attachSemanticIndex(server).ready;

    expect(report.check).toMatchObject({ kind: "mixed" });
    expect(lines.some((line) => line.includes("more than one model"))).toBe(true);
    await server.close();
  });

  it("says the index is intact when nothing can embed right now", async () => {
    const server = boot({ kind: "absent" });
    const db = server.projection;
    if (db === undefined) throw new Error("expected a projection");
    writeEmbedding(db, {
      state: "ready",
      chunkId: "c1",
      identity: "local/gone@3",
      vector: Float32Array.from([1, 2, 3]),
      updatedMs: 1,
    });

    const report = await attachSemanticIndex(server).ready;

    expect(report.check).toMatchObject({ kind: "unresolved", recorded: "local/gone@3" });
    expect(lines.join("\n")).toContain("existing vectors stay as they are");
    await server.close();
  });

  /**
   * The disposer aborts *and awaits*: a resolution still writing log lines into a
   * process whose database has already closed is the failure this ordering
   * exists to prevent.
   */
  it("aborts and awaits its resolution before the server finishes closing", async () => {
    const server = boot({
      kind: "configured",
      provider: { kind: "ollama", endpoint: "http://127.0.0.1:9", model: "m" },
    });
    let aborted = false;
    const fetchFn: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });

    const { ready } = attachSemanticIndex(server, { fetchFn });
    await server.close();

    expect(aborted).toBe(true);
    await expect(ready).resolves.toMatchObject({ resolution: { kind: "error" } });
  });

  it("survives a server built without a projection", async () => {
    const config = makeConfig({ kind: "absent" });
    const logger = createLogger("info", { write: (line) => lines.push(line) });
    const server = createServer(config, { logger });

    const report = await attachSemanticIndex(server, { embeddedEngine: engine }).ready;

    expect(report.check).toEqual({ kind: "no-index" });
    await server.close();
  });
});
