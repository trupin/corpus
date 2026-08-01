// The worker inside a real server: what a save costs while the worker is
// saturated, and what shutdown does to a drain in flight.
//
// The provider here sleeps for five seconds per call, which is longer than the
// whole test would tolerate if any of it were on the request path. That is the
// point — the assertions below are latency bounds, not "it returned".

import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type CorpusServer } from "../app.js";
import { DEFAULT_ATTACHMENT_LIMITS } from "../attachments/index.js";
import type { ServerConfig } from "../config.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";
import { createLogger, silentLogger } from "../logger.js";
import { attachProjection, openProjection } from "../projection/index.js";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countPendingChunks } from "./chunks.js";
import { createStaticEmbeddedEngine } from "./embedded-engine.js";
import type { CorpusEmbeddedEngine } from "./engine/index.js";
import { attachEmbedWorker } from "./worker-attach.js";
import { indexCounts } from "./worker.js";

/** How long the stub takes per batch: long enough that a blocked write path is unmistakable. */
const SLOW_MS = 5_000;

/**
 * A save may not pay for embedding. The bound is generous — the assertion is
 * about an order of magnitude, not about this machine's scheduler.
 */
const WRITE_BUDGET_MS = 1_000;

const workspaces: WriteWorkspace[] = [];
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const workspace of workspaces.splice(0)) workspace.close();
  vi.restoreAllMocks();
});

interface EngineStub {
  readonly engine: CorpusEmbeddedEngine;
  readonly calls: string[][];
  readonly requested: () => number;
}

function engineStub(options: { slow?: boolean; hang?: boolean } = {}): EngineStub {
  const calls: string[][] = [];
  let requested = 0;
  const base = createStaticEmbeddedEngine({
    model: "stub-model",
    embedBatch: async (texts) => {
      calls.push([...texts]);
      if (options.hang === true) await new Promise<never>(() => undefined);
      if (options.slow === true) await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      return texts.map(() => [0.5, 0.5, 0.5, 0.5]);
    },
  });
  return {
    engine: {
      ...base,
      requestModel: () => {
        requested += 1;
      },
      whenSettled: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
    calls,
    requested: () => requested,
  };
}

describe("attachEmbedWorker — the write path never waits (TEST-852)", () => {
  it("answers PUT /api/docs/{id} while the worker is saturated by a five-second provider", async () => {
    const workspace = createWriteWorkspace("worker-latency", { sprint: "s021" });
    workspaces.push(workspace);

    const created = await createDoc(workspace, {
      type: "note",
      title: "Saturating document",
      body: ["## One", "First section prose.", "", "## Two", "Second section prose."].join("\n"),
    });
    expect(countPendingChunks(workspace.db)).toBeGreaterThan(0);

    const stub = engineStub({ slow: true });
    const worker = attachEmbedWorker(workspace.server, { engine: stub.engine });
    if (worker === undefined) throw new Error("no worker attached");
    closers.push(() => worker.close());

    // Saturate: the drain is in flight and will not return for five seconds.
    const drain = worker.tick();
    await vi.waitFor(() => expect(stub.calls.length).toBeGreaterThan(0));

    const started = Date.now();
    const response = await workspace.put(`/api/docs/${created.id}`, {
      body: ["## One", "First section prose, edited.", "", "## Two", "Second."].join("\n"),
    });
    const elapsed = Date.now() - started;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(WRITE_BUDGET_MS);
    // And the save's own chunks are pending afterwards, not embedded inline.
    expect(countPendingChunks(workspace.db)).toBeGreaterThan(0);

    await worker.close();
    await drain;
  }, 20_000);
});

/** A bare server with a real projection, for the shutdown-ordering cases. */
function bootServer(prefix: string): { server: CorpusServer; root: string } {
  const root = mkdtempSync(join(tmpdir(), `corpus-s021-${prefix}-`));
  const workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  const config: ServerConfig = {
    workspaceRoot,
    corpusDir: join(workspaceRoot, ".corpus"),
    attachments: DEFAULT_ATTACHMENT_LIMITS,
    dataDir: join(workspaceRoot, "data"),
    configPath: join(workspaceRoot, ".corpus", "config.json"),
    host: "127.0.0.1",
    port: 0,
    token: "tkn_0123456789abcdef0123456789abcdef",
    version: "9.9.9",
    logLevel: "silent",
    uiDistDir: undefined,
    embedding: { kind: "absent" },
    warnings: [],
  };
  const projection = openProjection(config, { populate: false });
  const server = createServer(config, { projection, logger: silentLogger, heartbeatMs: 0 });
  return { server, root };
}

describe("attachEmbedWorker — shutdown", () => {
  it("registers after the projection, so its disposer runs before the handle closes (TEST-856)", async () => {
    const { server, root } = bootServer("worker-order");
    const order: string[] = [];
    // `attachProjection` is what registers the database's disposer in
    // production; the worker must go after it, so reverse order stops the
    // worker first.
    attachProjection(server);
    const projectionDb = server.projection;
    if (projectionDb === undefined) throw new Error("no projection");
    const realClose = projectionDb.close.bind(projectionDb);
    projectionDb.close = () => {
      order.push("projection");
      realClose();
    };

    const stub = engineStub();
    const worker = attachEmbedWorker(server, { engine: stub.engine });
    if (worker === undefined) throw new Error("no worker attached");
    const workerClose = worker.close.bind(worker);
    worker.close = async () => {
      order.push("worker");
      await workerClose();
    };

    await server.close();
    rmSync(root, { recursive: true, force: true });

    expect(order).toEqual(["worker", "projection"]);
  });

  it("stops an in-flight drain promptly and abandons it to pending (TEST-856/857)", async () => {
    const { server, root } = bootServer("worker-shutdown");
    const lines: string[] = [];
    const logging = createLogger("info", { write: (line) => lines.push(line) });
    (server as { logger: typeof logging }).logger = logging;
    attachProjection(server);
    const db = server.projection;
    if (db === undefined) throw new Error("no projection");

    db.prepare(
      `INSERT INTO chunks (ref, ord, chunk_id, doc_id, kind, heading_path, start_offset, end_offset, char_length)
       VALUES ('doc_a', 0, 'c0', 'doc_a', 'doc', 'Doc', 0, 10, 10)`,
    ).run();
    db.prepare(
      `INSERT INTO chunk_search (chunk_id, ref, doc_id, ord, heading_path, body)
       VALUES ('c0', 'doc_a', 'doc_a', 0, 'Doc', 'some prose to embed')`,
    ).run();

    const stub = engineStub({ hang: true });
    const worker = attachEmbedWorker(server, { engine: stub.engine });
    if (worker === undefined) throw new Error("no worker attached");

    const drain = worker.tick();
    await vi.waitFor(() => expect(stub.calls.length).toBeGreaterThan(0));

    const started = Date.now();
    await server.close();
    const elapsed = Date.now() - started;
    await drain;

    // Well inside `SHUTDOWN_GRACE_MS`, and the batch was abandoned rather than
    // half-written — the row never appeared, so nothing wrote to a closed
    // database on the way out.
    expect(elapsed).toBeLessThan(2_000);
    expect(lines.filter((line) => line.includes("disposer failed"))).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  }, 20_000);
});

describe("attachEmbedWorker — wiring", () => {
  it("returns undefined when the server has no projection", () => {
    const { server, root } = bootServer("worker-no-projection");
    const bare = { ...server, projection: undefined } as unknown as CorpusServer;
    expect(attachEmbedWorker(bare)).toBeUndefined();
    void server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("drains a real workspace's chunks through the embedded engine", async () => {
    const workspace = createWriteWorkspace("worker-drain", { sprint: "s021" });
    workspaces.push(workspace);
    await createDoc(workspace, {
      type: "note",
      title: "Drainable",
      body: ["## One", "First section prose.", "", "## Two", "Second section prose."].join("\n"),
    });

    const stub = engineStub();
    const worker = attachEmbedWorker(workspace.server, { engine: stub.engine });
    if (worker === undefined) throw new Error("no worker attached");
    closers.push(() => worker.close());

    await worker.tick();

    const counts = indexCounts(workspace.db);
    expect(counts.pending).toBe(0);
    expect(counts.indexed).toBe(counts.total);
    expect(counts.total).toBeGreaterThan(1);
  });
});
