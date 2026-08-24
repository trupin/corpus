// The two index-maintenance endpoints over a real `createServer` app: mounted,
// authenticated, contract-shaped, and — the one thing only an HTTP test can
// show — answering the same state word `/api/search` does, in one request pair.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiErrorSchema, IndexStatusSchema, SearchResultsSchema } from "@corpus/contract";
import { createServer, type CorpusServer } from "../app.js";
import type { ServerConfig } from "../config.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import { silentLogger } from "../logger.js";
import { attachProjection, openWorkspaceProjection } from "../projection/attach.js";
import { createStaticEmbeddedEngine } from "./embedded-engine.js";
import { recordedIdentities } from "./embeddings.js";
import { embedChunks } from "./vector-fixture.js";
import { indexCounts } from "./worker.js";

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const DIM = 4;
const IDENTITY = `local/fixture@${String(DIM)}`;

let root: string;
let workspaceRoot: string;
let server: CorpusServer;

const doc = (id: string, body: string): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${id}\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\n${body}\n`;

function write(relative: string, content: string): void {
  const abs = join(workspaceRoot, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

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

/** The lifecycle seam, exactly as `runServerProcess` runs it, minus the socket. */
function boot(): void {
  const config = makeConfig();
  const projection = openWorkspaceProjection(config, silentLogger);
  server = createServer(config, { logger: silentLogger, projection, heartbeatMs: 0 });
  attachProjection(server);
}

/**
 * Binds an engine the way `lifecycle.ts` does — after the routes are mounted —
 * so a resolution is possible at all. Everything it embeds is a fixed vector, so
 * a query matches every chunk equally and the ranking is not the subject here.
 */
function useEngine(): void {
  server.semantic?.useEngine(
    createStaticEmbeddedEngine({
      model: "fixture",
      embedBatch: (texts) => Promise.resolve(texts.map(() => [1, 0, 0, 0].slice(0, DIM))),
    }),
  );
}

const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
  server.app.request(path, { ...init, headers: { ...AUTH, ...init.headers } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s021-index-routes-"));
  workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  write("data/docs/a.md", doc("doc_aaa", "## Alpha\n\nThe northern harbour is quiet."));
  write("data/docs/b.md", doc("doc_bbb", "## Beta\n\nThe southern harbour is busy."));
});

afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("authentication", () => {
  it("refuses both verbs without the workspace token", async () => {
    boot();
    for (const [path, method] of [
      ["/api/index/status", "GET"],
      ["/api/index/rebuild", "POST"],
    ] as const) {
      const response = await server.app.request(path, { method });
      expect(response.status).toBe(401);
      expect(ApiErrorSchema.parse(await response.json()).code).toBe("unauthorized");
    }
  });
});

describe("GET /api/index/status", () => {
  it("answers the contract's IndexStatus for a workspace with no vectors", async () => {
    boot();

    const response = await request("/api/index/status");
    expect(response.status).toBe(200);
    const body = IndexStatusSchema.parse(await response.json());
    expect(body).toMatchObject({
      indexed: 0,
      failed: 0,
      identity: null,
      rebuilding: false,
      state: "disabled",
    });
    expect(body.pending).toBe(indexCounts(server.projection!).total);
  });

  it("reports the same state word `/api/search` does, in one pair of calls", async () => {
    boot();
    useEngine();
    embedChunks(server.projection!, IDENTITY, () => [1, 0, 0, 0]);

    const status = IndexStatusSchema.parse(await (await request("/api/index/status")).json());
    const results = SearchResultsSchema.parse(
      await (await request("/api/search?q=harbour")).json(),
    );

    // The contract reuses one schema for both fields so this cannot drift; the
    // test is what proves the *server* honours it rather than deriving twice.
    expect(status.state).toBe("current");
    expect(results.semanticIndex).toBe(status.state);
    expect(status.identity).toBe(IDENTITY);
  });

  it("takes no acting party and needs no body", async () => {
    boot();
    // Neither route declares a header schema, so an actor header is simply
    // ignored rather than validated — these verbs touch only derived state and
    // have nothing to attribute (SPEC.md §9.2).
    const response = await request("/api/index/status", { headers: { "X-Corpus-Actor": "agent" } });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/index/rebuild", () => {
  it("answers 202 with the post-queue snapshot", async () => {
    boot();
    useEngine();
    embedChunks(server.projection!, IDENTITY, () => [1, 0, 0, 0]);
    const total = indexCounts(server.projection!).total;

    const response = await request("/api/index/rebuild", { method: "POST" });
    expect(response.status).toBe(202);

    const body = IndexStatusSchema.parse(await response.json());
    expect(body).toMatchObject({
      indexed: 0,
      failed: 0,
      pending: total,
      identity: null,
      rebuilding: true,
      state: "indexing",
    });
    // Accepted, not completed: the vectors are gone the moment it answers, and
    // nothing has replaced them yet.
    expect(recordedIdentities(server.projection!)).toEqual([]);
  });

  it("accepts no body at all, which is what the contract declares", async () => {
    boot();
    const response = await request("/api/index/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonsense: true }),
    });
    // No request schema means nothing to validate and nothing to reject — the
    // route carries no `400`, and an ignored body must not become one.
    expect(response.status).toBe(202);
  });
});

/**
 * SERVER-116, over the wiring rather than over the announcer. The unit block in
 * `announce.test.ts` proves the rule; this proves that `app.ts` and
 * `worker-attach.ts` actually hand the two emitters the one announcer, which is
 * the half a unit test cannot see.
 */
describe("the index's state word reaches the surfaces that embed a copy of it", () => {
  const framesOf = (server: CorpusServer): { keys: string[] } => {
    const keys: string[] = [];
    server.bus.subscribe((batch) => {
      for (const key of batch) keys.push(JSON.stringify(key));
    });
    return { keys };
  };

  it("announces the board's prefix on a rebuild's edges and not otherwise", async () => {
    boot();
    useEngine();
    // The word settles before anything is watched, so what follows is a
    // transition and not a first reading.
    expect((await request("/api/index/status")).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const frames = framesOf(server);
    const response = await request("/api/index/rebuild", { method: "POST" });
    expect(response.status).toBe(202);
    // The rebuild's own drain is detached, so let it finish and lower the flag.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // `["index"]` on every announcement, as always — and `["docs"]` only where
    // the word moved, which is what an open search overlay is waiting for.
    expect(frames.keys).toContain(JSON.stringify(["index"]));
    expect(frames.keys).toContain(JSON.stringify(["docs"]));
    expect(frames.keys.filter((key) => key === JSON.stringify(["docs"])).length).toBeLessThan(
      frames.keys.filter((key) => key === JSON.stringify(["index"])).length + 1,
    );
  });
});
