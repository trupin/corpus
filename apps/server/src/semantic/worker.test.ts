// The embed worker against a real projection: what it drains, what it counts,
// what it refuses to do, and what it leaves behind when it is stopped.
//
// Every fixture below is a real workspace with real markdown files projected by
// the real projector, so "pending" is the derived left-join the product uses and
// not a flag a test wrote. The provider is the only stand-in — it is the one
// thing whose behaviour under failure, slowness and cancellation is the subject.

import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { createLogger, silentLogger } from "../logger.js";
import { openProjectionReadonly } from "../projection/db.js";
import { projectDocument } from "../projection/project-document.js";
import { rebuild } from "../projection/rebuild.js";
import { createInvalidationBus } from "../events/bus.js";
import { countPendingChunks, pendingChunkIds } from "./chunks.js";
import { blobToVector, writeEmbedding } from "./embeddings.js";
import { formatIdentity, type EmbeddingModelRef } from "./identity.js";
import { EmbeddingError, type EmbeddingProvider } from "./provider.js";
import type { ProviderResolution } from "./resolve.js";
import {
  EMBED_BACKOFF_MS,
  MAX_CHUNK_FAILURES,
  chunkEmbedInput,
  embedBackoffMs,
  indexCounts,
  startEmbedWorker,
  type EmbedWorkerHandle,
  type EmbedWorkerOptions,
} from "./worker.js";

const STUB_REF: EmbeddingModelRef = { provider: "stub", model: "model" };
const STUB_DIM = 4;
const STUB_IDENTITY = formatIdentity(STUB_REF, STUB_DIM);

const workspaces: Workspace[] = [];
const workers: EmbedWorkerHandle[] = [];

afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.close();
  for (const workspace of workspaces.splice(0)) workspace.close();
  vi.restoreAllMocks();
});

/** Deterministic, so a re-embed of the same text is byte-identical. */
function vectorFor(text: string, dim: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < dim; index += 1) {
    let acc = index + 1;
    for (const code of text) acc = (acc * 31 + code.codePointAt(0)!) % 9973;
    out.push((acc % 100) / 100 + 0.01);
  }
  return out;
}

interface StubOptions {
  readonly failAll?: boolean;
  readonly failText?: ((text: string) => boolean) | undefined;
  readonly hang?: boolean;
  readonly onBatch?: ((texts: readonly string[]) => void | Promise<void>) | undefined;
}

interface Stub {
  readonly provider: EmbeddingProvider;
  readonly identity: string;
  readonly calls: string[][];
}

function stubProvider(options: StubOptions = {}): Stub {
  const calls: string[][] = [];
  const provider: EmbeddingProvider = {
    ref: STUB_REF,
    identity: STUB_IDENTITY,
    async embed(texts) {
      calls.push([...texts]);
      await options.onBatch?.(texts);
      if (options.hang === true) await new Promise<never>(() => undefined);
      if (options.failAll === true) throw new EmbeddingError("stub provider is down");
      const refused = texts.find((text) => options.failText?.(text) === true);
      if (refused !== undefined) throw new EmbeddingError("stub refuses this passage");
      return texts.map((text) => Float32Array.from(vectorFor(text, STUB_DIM)));
    },
  };
  return { provider, identity: STUB_IDENTITY, calls };
}

const providerResolution = (stub: Stub, identity = stub.identity): ProviderResolution => ({
  kind: "provider",
  source: "embedded",
  provider: stub.provider,
  identity,
  sticky: false,
});

/** A section long enough to be a chunk of its own, short enough not to split. */
const section = (index: number): string =>
  `## Section ${String(index)}\n\nParagraph ${String(index)} about ${"topic ".repeat(12)}.\n`;

function seedWorkspace(prefix: string, docs: number, sections: number): Workspace {
  const workspace = createWorkspace(prefix);
  workspaces.push(workspace);
  for (let index = 0; index < docs; index += 1) {
    workspace.doc({
      id: `doc_${String(index).padStart(3, "0")}`,
      body: Array.from({ length: sections }, (_, s) => section(s)).join("\n"),
    });
  }
  workspace.reproject();
  return workspace;
}

function makeWorker(overrides: Partial<EmbedWorkerOptions> & Pick<EmbedWorkerOptions, "db">) {
  const worker = startEmbedWorker({
    logger: silentLogger,
    intervalMs: 0,
    resolve: () => Promise.reject(new Error("no resolver configured")),
    ...overrides,
  });
  workers.push(worker);
  return worker;
}

const embeddingRows = (
  workspace: Workspace,
): {
  chunk_id: string;
  identity: string;
  dim: number;
  vec: Buffer | null;
  state: string;
  failures: number;
}[] =>
  workspace.db
    .prepare(
      "SELECT chunk_id, identity, dim, vec, state, failures FROM chunk_embeddings ORDER BY chunk_id",
    )
    .all() as {
    chunk_id: string;
    identity: string;
    dim: number;
    vec: Buffer | null;
    state: string;
    failures: number;
  }[];

describe("indexCounts", () => {
  it("derives the three numbers from rows and always sums to the chunk total", () => {
    const workspace = seedWorkspace("counts", 1, 4);
    const ids = pendingChunkIds(workspace.db);
    expect(ids.length).toBeGreaterThan(2);

    expect(indexCounts(workspace.db)).toEqual({
      total: ids.length,
      indexed: 0,
      pending: ids.length,
      failed: 0,
    });

    writeEmbedding(workspace.db, {
      state: "ready",
      chunkId: ids[0]!,
      identity: STUB_IDENTITY,
      vector: Float32Array.from([1, 0, 0, 0]),
      updatedMs: 10,
    });
    writeEmbedding(workspace.db, {
      state: "failed",
      chunkId: ids[1]!,
      identity: STUB_IDENTITY,
      failures: 2,
      updatedMs: 10,
    });

    const counts = indexCounts(workspace.db);
    expect(counts).toEqual({
      total: ids.length,
      indexed: 1,
      pending: ids.length - 2,
      failed: 1,
    });
    expect(counts.indexed + counts.pending + counts.failed).toBe(counts.total);
  });

  it("counts an orphaned embedding in none of the three (TEST-865)", () => {
    const workspace = seedWorkspace("counts-orphan", 1, 2);
    const total = indexCounts(workspace.db).total;

    writeEmbedding(workspace.db, {
      state: "ready",
      chunkId: "0".repeat(64),
      identity: STUB_IDENTITY,
      vector: Float32Array.from([1, 0, 0, 0]),
      updatedMs: 10,
    });

    const counts = indexCounts(workspace.db);
    expect(counts).toEqual({ total, indexed: 0, pending: total, failed: 0 });
  });

  it("follows rows mutated behind its back — nothing is cached (TEST-865)", async () => {
    const workspace = seedWorkspace("counts-derived", 1, 3);
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();
    const drained = worker.counts();
    expect(drained.pending).toBe(0);
    expect(drained.indexed).toBe(drained.total);

    workspace.db.prepare("DELETE FROM chunk_embeddings").run();
    expect(worker.counts()).toEqual({
      total: drained.total,
      indexed: 0,
      pending: drained.total,
      failed: 0,
    });
  });
});

describe("startEmbedWorker — draining", () => {
  it("embeds every pending chunk and stores unit-length vectors", async () => {
    const workspace = seedWorkspace("drain", 2, 4);
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 3,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    expect(countPendingChunks(workspace.db)).toBe(0);
    const rows = embeddingRows(workspace);
    expect(rows).toHaveLength(worker.counts().total);
    for (const row of rows) {
      expect(row.state).toBe("ready");
      expect(row.identity).toBe(STUB_IDENTITY);
      expect(row.dim).toBe(STUB_DIM);
      const vector = blobToVector(row.vec!);
      const norm = Math.sqrt([...vector].reduce((sum, value) => sum + value * value, 0));
      expect(norm).toBeCloseTo(1, 5);
    }
  });

  it("embeds the heading path above the body", async () => {
    const workspace = seedWorkspace("embed-input", 1, 2);
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    const sent = stub.calls.flat();
    expect(sent.some((text) => text.includes("Section 1") && text.includes("Paragraph 1"))).toBe(
      true,
    );
    expect(chunkEmbedInput({ headingPath: "A › B", body: "text" })).toBe("A › B\n\ntext");
    expect(chunkEmbedInput({ headingPath: "", body: "text" })).toBe("text");
  });

  it("keeps indexed + pending + failed equal to the total at every observable moment (TEST-854)", async () => {
    const workspace = seedWorkspace("transactional", 3, 4);
    const total = indexCounts(workspace.db).total;
    const observations: { indexed: number; pending: number; failed: number; total: number }[] = [];

    const stub = stubProvider({
      onBatch: () => {
        // A second connection, so what it sees is what another process would.
        const reader = openProjectionReadonly(workspace.config);
        try {
          observations.push(indexCounts(reader));
        } finally {
          reader.close();
        }
      },
    });
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 4,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    expect(observations.length).toBeGreaterThan(2);
    let previous = -1;
    for (const seen of observations) {
      expect(seen.total).toBe(total);
      expect(seen.indexed + seen.pending + seen.failed).toBe(total);
      // TEST-862: progress is visible mid-drain, not only at the end.
      expect(seen.indexed).toBeGreaterThanOrEqual(previous);
      previous = seen.indexed;
    }
    expect(observations.at(-1)!.indexed).toBeGreaterThan(observations[0]!.indexed);
    expect(indexCounts(workspace.db)).toEqual({ total, indexed: total, pending: 0, failed: 0 });
  });

  it("re-embeds only what an edit changed", async () => {
    const workspace = seedWorkspace("incremental", 1, 6);
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    await worker.tick();
    const before = embeddingRows(workspace);
    stub.calls.length = 0;

    workspace.doc({
      id: "doc_000",
      body: Array.from({ length: 6 }, (_, s) =>
        s === 3 ? section(s).replace("Paragraph 3", "Paragraph three, rewritten") : section(s),
      ).join("\n"),
    });
    projectDocument(
      workspace.db,
      join(workspace.config.workspaceRoot, "data", "docs", "doc_000.md"),
    );

    expect(countPendingChunks(workspace.db)).toBe(1);
    await worker.tick();

    expect(stub.calls.flat()).toHaveLength(1);
    const after = embeddingRows(workspace);
    const survivors = after.filter((row) => before.some((old) => old.chunk_id === row.chunk_id));
    expect(survivors).toHaveLength(before.length);
  });
});

describe("startEmbedWorker — the four sources of pending work (TEST-853)", () => {
  it("a save through the projector queues its changed chunks", async () => {
    // `runMutation`'s projection step (`docs/write.ts`) is `projectDocument`,
    // which is also the watcher's `collectDocument` step: one function, so one
    // case covers both hook points the issue names separately.
    const workspace = seedWorkspace("source-save", 1, 3);
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    await worker.tick();
    expect(countPendingChunks(workspace.db)).toBe(0);

    workspace.doc({
      id: "doc_000",
      body: [section(0), section(1), "## Section 9\n\nBrand new prose entirely.\n"].join("\n"),
    });
    projectDocument(
      workspace.db,
      join(workspace.config.workspaceRoot, "data", "docs", "doc_000.md"),
    );

    expect(countPendingChunks(workspace.db)).toBe(1);
  });

  it("a new file the watcher projects queues its chunks", () => {
    const workspace = seedWorkspace("source-watcher", 1, 2);
    const before = countPendingChunks(workspace.db);

    workspace.doc({ id: "doc_oob", body: "## Out of band\n\nWritten by another editor.\n" });
    // What `watcher.ts`'s `collectDocument` does for an `add` event.
    projectDocument(
      workspace.db,
      join(workspace.config.workspaceRoot, "data", "docs", "doc_oob.md"),
    );

    expect(countPendingChunks(workspace.db)).toBe(before + 1);
  });

  it("db rebuild queues only what is genuinely new", async () => {
    const workspace = seedWorkspace("source-rebuild", 2, 3);
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    await worker.tick();
    expect(countPendingChunks(workspace.db)).toBe(0);

    workspace.doc({ id: "doc_new", body: "## Fresh\n\nNever seen before by anybody.\n" });
    workspace.db.reopenAround(() => rebuild(workspace.config, { logger: silentLogger }));

    // The rebuild carried the embeddings over, so only the new document's
    // chunks are pending — a rebuild is not a re-index (Open Conflict 5).
    expect(countPendingChunks(workspace.db)).toBe(1);
  });

  it("an identity mismatch invalidates the whole index and re-queues it", async () => {
    const workspace = seedWorkspace("source-identity", 1, 4);
    const old = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(old, "stub/old@4")),
    });
    await worker.tick();
    const total = indexCounts(workspace.db).total;
    expect(indexCounts(workspace.db).indexed).toBe(total);

    const next = stubProvider();
    const successor = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(next, "stub/new@4")),
    });
    await successor.tick();

    expect(next.calls.flat()).toHaveLength(total);
    expect(new Set(embeddingRows(workspace).map((row) => row.identity))).toEqual(
      new Set(["stub/new@4"]),
    );
  });

  it("drops only the foreign rows from a mixed index", async () => {
    const workspace = seedWorkspace("mixed-identity", 1, 4);
    const ids = pendingChunkIds(workspace.db);
    for (const [index, id] of ids.entries()) {
      writeEmbedding(workspace.db, {
        state: "ready",
        chunkId: id,
        identity: index === 0 ? STUB_IDENTITY : "stub/other@4",
        vector: Float32Array.from([1, 0, 0, 0]),
        updatedMs: 5,
      });
    }

    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    await worker.tick();

    expect(new Set(embeddingRows(workspace).map((row) => row.identity))).toEqual(
      new Set([STUB_IDENTITY]),
    );
    expect(stub.calls.flat()).toHaveLength(ids.length - 1);
  });
});

describe("startEmbedWorker — failure honesty", () => {
  const poison = (text: string): boolean => text.includes("Section 2");

  it("counts a permanently failing chunk instead of dropping it (TEST-860)", async () => {
    const workspace = seedWorkspace("poison", 1, 6);
    const stub = stubProvider({ failText: poison });
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 8,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    const counts = worker.counts();
    expect(counts.failed).toBe(1);
    expect(counts.pending).toBe(0);
    expect(counts.indexed).toBe(counts.total - 1);

    const failed = embeddingRows(workspace).filter((row) => row.state === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.failures).toBe(1);
    expect(failed[0]!.vec).toBeNull();
    expect(failed[0]!.identity).toBe(STUB_IDENTITY);
  });

  it("does not let the first chunk in the queue starve the rest (TEST-861)", async () => {
    const workspace = seedWorkspace("poison-first", 1, 6);
    const first = pendingChunkIds(workspace.db)[0]!;
    const firstBody = workspace.db
      .prepare("SELECT heading_path, body FROM chunk_search WHERE chunk_id = ? LIMIT 1")
      .get(first) as { heading_path: string; body: string };
    const firstText = chunkEmbedInput({
      headingPath: firstBody.heading_path,
      body: firstBody.body,
    });

    const stub = stubProvider({ failText: (text) => text === firstText });
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 8,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    const counts = worker.counts();
    expect(counts.failed).toBe(1);
    expect(counts.indexed).toBe(counts.total - 1);
    expect(embeddingRows(workspace).find((row) => row.chunk_id === first)!.state).toBe("failed");
  });

  it("retries a failed chunk only after its backoff, and gives up at the ceiling", async () => {
    const workspace = seedWorkspace("chunk-backoff", 1, 3);
    let clock = 1_000_000;
    const stub = stubProvider({ failText: poison });
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 8,
      now: () => clock,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();
    expect(worker.counts().failed).toBe(1);
    const attempts = stub.calls.length;

    // Still inside the first rung: nothing is offered again.
    clock += embedBackoffMs(1) - 1;
    await worker.tick();
    expect(stub.calls.length).toBe(attempts);

    for (let failures = 1; failures < MAX_CHUNK_FAILURES; failures += 1) {
      clock += embedBackoffMs(failures);
      await worker.tick();
    }
    const row = embeddingRows(workspace).find((entry) => entry.state === "failed")!;
    expect(row.failures).toBe(MAX_CHUNK_FAILURES);

    // At the ceiling it is left alone — visible, counted, and never retried.
    const settled = stub.calls.length;
    clock += embedBackoffMs(MAX_CHUNK_FAILURES) * 10;
    await worker.tick();
    expect(stub.calls.length).toBe(settled);
    expect(worker.counts().failed).toBe(1);
  });

  it("treats a provider that refuses everything as an outage, not as poisoned chunks (TEST-859)", async () => {
    const workspace = seedWorkspace("outage", 1, 4);
    const total = indexCounts(workspace.db).total;
    let clock = 2_000_000;
    const lines: string[] = [];
    const stub = stubProvider({ failAll: true });
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 8,
      now: () => clock,
      logger: createLogger("info", { write: (line) => lines.push(line) }),
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    // Nothing was written: a dead endpoint is not a corpus full of bad chunks.
    expect(indexCounts(workspace.db)).toEqual({ total, indexed: 0, pending: total, failed: 0 });
    const afterFirst = stub.calls.length;

    // Inside the first backoff window the worker does not even ask.
    clock += EMBED_BACKOFF_MS[0] - 1;
    await worker.tick();
    expect(stub.calls.length).toBe(afterFirst);

    // Each window is longer than the last, and the failure is reported once per
    // window rather than once per attempt.
    for (const [index, rung] of EMBED_BACKOFF_MS.slice(0, 3).entries()) {
      clock += rung;
      await worker.tick();
      expect(stub.calls.length).toBeGreaterThan(afterFirst);
      expect(embedBackoffMs(index + 2)).toBeGreaterThan(rung);
    }
    expect(lines.filter((line) => line.includes("stub provider is down"))).toHaveLength(1);
  });

  it("resumes cleanly once the provider comes back", async () => {
    const workspace = seedWorkspace("recovery", 1, 4);
    const total = indexCounts(workspace.db).total;
    let clock = 3_000_000;
    let down = true;
    const stub = stubProvider();
    const broken = stubProvider({ failAll: true });
    const worker = makeWorker({
      db: workspace.db,
      now: () => clock,
      resolve: () => Promise.resolve(providerResolution(down ? broken : stub)),
    });

    await worker.tick();
    expect(worker.counts().pending).toBe(total);

    down = false;
    clock += EMBED_BACKOFF_MS[0];
    await worker.tick();
    expect(worker.counts()).toEqual({ total, indexed: total, pending: 0, failed: 0 });
  });

  it("never records a vector without an identity or an identity without a vector", async () => {
    const workspace = seedWorkspace("half-row", 1, 5);
    const stub = stubProvider({ failText: poison });
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 2,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    for (const row of embeddingRows(workspace)) {
      expect(row.identity).not.toBe("");
      if (row.state === "ready") {
        expect(row.vec).not.toBeNull();
        expect(row.dim).toBe(STUB_DIM);
      } else {
        expect(row.vec).toBeNull();
      }
    }
  });
});

describe("startEmbedWorker — resolution", () => {
  it("does not resolve anything when there is nothing to index", async () => {
    const workspace = seedWorkspace("no-work", 1, 2);
    const stub = stubProvider();
    let resolutions = 0;
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => {
        resolutions += 1;
        return Promise.resolve(providerResolution(stub));
      },
    });

    await worker.tick();
    expect(resolutions).toBe(1);

    // Drained: the second tick has no reason to ask anybody anything.
    await worker.tick();
    expect(resolutions).toBe(1);
  });

  it("asks the engine for its model on the first index need, and only then", async () => {
    const workspace = seedWorkspace("lazy-model", 1, 3);
    const stub = stubProvider();
    let downloaded = false;
    const requestModel = vi.fn(() => {
      downloaded = true;
    });
    let clock = 4_000_000;
    const worker = makeWorker({
      db: workspace.db,
      now: () => clock,
      modelPollMs: 10,
      requestModel,
      resolve: () =>
        Promise.resolve(
          downloaded
            ? providerResolution(stub)
            : {
                kind: "disabled",
                reason: "model-not-downloaded",
                detail: "the model has not been downloaded yet",
              },
        ),
    });

    await worker.tick();
    expect(requestModel).toHaveBeenCalledTimes(1);
    expect(stub.calls).toHaveLength(0);
    expect(worker.counts().pending).toBeGreaterThan(0);

    clock += 10;
    await worker.tick();
    expect(worker.counts().pending).toBe(0);
  });

  it("leaves a sticky index alone and does not hot-loop over it", async () => {
    const workspace = seedWorkspace("sticky", 1, 3);
    const ids = pendingChunkIds(workspace.db);
    for (const id of ids) {
      writeEmbedding(workspace.db, {
        state: "ready",
        chunkId: id,
        identity: "stub/recorded@4",
        vector: Float32Array.from([1, 0, 0, 0]),
        updatedMs: 1,
      });
    }
    workspace.doc({ id: "doc_extra", body: "## Later\n\nAdded after the index was built.\n" });
    projectDocument(
      workspace.db,
      join(workspace.config.workspaceRoot, "data", "docs", "doc_extra.md"),
    );

    let clock = 5_000_000;
    let resolutions = 0;
    const requestModel = vi.fn();
    const worker = makeWorker({
      db: workspace.db,
      now: () => clock,
      requestModel,
      resolve: () => {
        resolutions += 1;
        return Promise.resolve({
          kind: "disabled",
          reason: "sticky-model-unavailable",
          detail: "the index was built by stub/recorded@4",
        });
      },
    });

    await worker.tick();
    expect(resolutions).toBe(1);
    expect(requestModel).not.toHaveBeenCalled();

    // The vectors are untouched and still searchable.
    expect(indexCounts(workspace.db).indexed).toBe(ids.length);
    expect(new Set(embeddingRows(workspace).map((row) => row.identity))).toEqual(
      new Set(["stub/recorded@4"]),
    );

    // And an immediate second tick asks nobody: the ceiling of the ladder.
    clock += 1;
    await worker.tick();
    expect(resolutions).toBe(1);
    clock += embedBackoffMs(EMBED_BACKOFF_MS.length);
    await worker.tick();
    expect(resolutions).toBe(2);
  });

  it("treats a resolution error as a provider outage and says so once", async () => {
    const workspace = seedWorkspace("resolution-error", 1, 3);
    const lines: string[] = [];
    let clock = 6_000_000;
    const worker = makeWorker({
      db: workspace.db,
      now: () => clock,
      logger: createLogger("info", { write: (line) => lines.push(line) }),
      resolve: () =>
        Promise.resolve({
          kind: "error",
          reason: "provider-unreachable",
          detail: "connect ECONNREFUSED 127.0.0.1:9",
        }),
    });

    await worker.tick();
    clock += EMBED_BACKOFF_MS[0];
    await worker.tick();

    expect(worker.counts().pending).toBeGreaterThan(0);
    expect(lines.filter((line) => line.includes("ECONNREFUSED"))).toHaveLength(1);
  });

  it("survives a resolver that throws", async () => {
    const workspace = seedWorkspace("resolver-throws", 1, 2);
    const worker = makeWorker({
      db: workspace.db,
      resolve: () => Promise.reject(new Error("resolution exploded")),
    });

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(worker.counts().pending).toBeGreaterThan(0);
  });
});

describe("startEmbedWorker — lifecycle", () => {
  it("returns from an in-flight batch on close without touching the database (TEST-857)", async () => {
    const workspace = seedWorkspace("cancel", 1, 4);
    const total = indexCounts(workspace.db).total;
    let entered = (): void => undefined;
    const arrived = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const stub = stubProvider({ hang: true, onBatch: () => entered() });
    const worker = startEmbedWorker({
      db: workspace.db,
      logger: silentLogger,
      intervalMs: 0,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    workspaces.push(workspace);

    const running = worker.tick();
    await arrived;
    await worker.close();
    await running;

    expect(indexCounts(workspace.db)).toEqual({ total, indexed: 0, pending: total, failed: 0 });
    expect(stub.calls).toHaveLength(1);
  });

  it("abandons the in-flight batch to pending rather than half-writing it (TEST-855/856)", async () => {
    const workspace = seedWorkspace("abandon", 1, 6);
    let entered = (): void => undefined;
    const arrived = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let batches = 0;
    const stub = stubProvider({
      onBatch: async () => {
        batches += 1;
        if (batches === 2) {
          entered();
          await new Promise<never>(() => undefined);
        }
      },
    });
    const worker = startEmbedWorker({
      db: workspace.db,
      logger: silentLogger,
      intervalMs: 0,
      batchSize: 2,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    const running = worker.tick();
    await arrived;
    await worker.close();
    await running;

    const counts = indexCounts(workspace.db);
    expect(counts.indexed).toBe(2);
    expect(counts.indexed + counts.pending + counts.failed).toBe(counts.total);
    for (const row of embeddingRows(workspace)) {
      expect(row.state).toBe("ready");
      expect(row.vec).not.toBeNull();
      expect(row.identity).toBe(STUB_IDENTITY);
    }
  });

  it("never self-schedules with intervalMs 0 (TEST-863)", async () => {
    const workspace = seedWorkspace("inert", 1, 3);
    const bus = createInvalidationBus();
    const stub = stubProvider();
    makeWorker({
      db: workspace.db,
      bus,
      intervalMs: 0,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    bus.invalidate([["docs"]]);
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(stub.calls).toHaveLength(0);
    expect(countPendingChunks(workspace.db)).toBeGreaterThan(0);
  });

  it("unrefs every timer it creates (TEST-863)", async () => {
    const workspace = seedWorkspace("unref", 1, 2);
    const unrefs: unknown[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (handler: () => void, ms?: number): ReturnType<typeof setTimeout> => {
        const timer = real(handler, ms);
        const originalUnref = timer.unref.bind(timer);
        timer.unref = () => {
          unrefs.push(timer);
          return originalUnref();
        };
        return timer;
      },
    );

    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      intervalMs: 25,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    await vi.waitFor(() => expect(unrefs.length).toBeGreaterThan(0));
    await worker.close();

    expect(unrefs.length).toBeGreaterThan(0);
  });

  it("keeps working across db rebuild's connection swap (TEST-858)", async () => {
    const workspace = seedWorkspace("rebuild-swap", 2, 4);
    const total = indexCounts(workspace.db).total;
    let batches = 0;
    const stub = stubProvider({
      onBatch: () => {
        batches += 1;
        // Mid-drain, exactly as `POST /api/db/rebuild` does it: close, replace
        // the file, reopen — under the same `ProjectionDb` object.
        if (batches === 2) {
          workspace.db.reopenAround(() => rebuild(workspace.config, { logger: silentLogger }));
        }
      },
    });
    const worker = makeWorker({
      db: workspace.db,
      batchSize: 3,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });

    await worker.tick();

    expect(batches).toBeGreaterThan(2);
    expect(indexCounts(workspace.db)).toEqual({ total, indexed: total, pending: 0, failed: 0 });
  });
});

describe("startEmbedWorker — debounce behind the write path (TEST-864)", () => {
  it("embeds the final content once after a burst of saves", async () => {
    const workspace = seedWorkspace("debounce", 1, 1);
    const bus = createInvalidationBus();
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      bus,
      intervalMs: 20,
      debounceMs: 60,
      maxDeferMs: 5_000,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    await worker.tick();
    stub.calls.length = 0;

    for (let revision = 1; revision <= 10; revision += 1) {
      workspace.doc({
        id: "doc_000",
        body: `## Section 0\n\nRevision ${String(revision)} of ${"the prose ".repeat(12)}.\n`,
      });
      projectDocument(
        workspace.db,
        join(workspace.config.workspaceRoot, "data", "docs", "doc_000.md"),
      );
      bus.invalidate([["docs"]]);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await vi.waitFor(() => expect(countPendingChunks(workspace.db)).toBe(0));
    const sent = stub.calls.flat();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Revision 10");
  });

  it("still makes progress under continuous churn — the livelock guard", async () => {
    const workspace = seedWorkspace("livelock", 1, 1);
    const bus = createInvalidationBus();
    const stub = stubProvider();
    const worker = makeWorker({
      db: workspace.db,
      bus,
      intervalMs: 20,
      debounceMs: 1_000,
      maxDeferMs: 80,
      resolve: () => Promise.resolve(providerResolution(stub)),
    });
    await worker.tick();
    stub.calls.length = 0;

    workspace.doc({ id: "doc_000", body: "## Section 0\n\nChurning prose that never settles.\n" });
    projectDocument(
      workspace.db,
      join(workspace.config.workspaceRoot, "data", "docs", "doc_000.md"),
    );
    const churn = setInterval(() => bus.invalidate([["docs"]]), 20);
    try {
      // The debounce alone would defer for a second; the guard drains anyway.
      await vi.waitFor(() => expect(stub.calls.length).toBeGreaterThan(0), { timeout: 900 });
    } finally {
      clearInterval(churn);
    }
  });
});
