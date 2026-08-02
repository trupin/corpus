// The index's operational verbs against a real projection and a real worker.
//
// Nothing here stubs the state mapping, the counts or the resolution order: the
// workspace is real markdown projected by the real projector, the counts are
// `indexCounts`'s derived left-join, and resolution goes through
// `resolveEmbeddingProvider` over a static embedded engine — which is what makes
// "a rebuild re-picks the identity" a statement about stickiness rather than
// about a stub returning a different string.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { createInvalidationBus, type InvalidationBus } from "../events/bus.js";
import { INDEX_KEY } from "../events/keys.js";
import { silentLogger } from "../logger.js";
import { rebuild as rebuildProjection } from "../projection/rebuild.js";
import { createStaticEmbeddedEngine, type EmbeddedEngine } from "./embedded-engine.js";
import { recordedIdentities, writeEmbedding } from "./embeddings.js";
import { createIndexMaintenance, type IndexMaintenance } from "./maintenance.js";
import { PROBE_TEXT, resolveEmbeddingProvider } from "./resolve.js";
import { createSemanticRetrieval, type SemanticRetrieval } from "./retrieval.js";
import { indexCounts, startEmbedWorker, type EmbedWorkerHandle } from "./worker.js";

const DIM = 4;
/** What the static engine below produces: `local/<model>@4`. */
const identityOf = (model: string): string => `local/${model}@${String(DIM)}`;

let ws: Workspace;
let bus: InvalidationBus;
let frames: { rebuilding: boolean }[] = [];
let semantic: SemanticRetrieval;
let maintenance: IndexMaintenance;
let worker: EmbedWorkerHandle;
let clock = 1_000;

/** Deterministic and non-zero, so `writeEmbedding` never refuses an empty vector. */
const vectorFor = (text: string): number[] => {
  let acc = 7;
  for (const code of text) acc = (acc * 31 + (code.codePointAt(0) ?? 0)) % 9973;
  return Array.from({ length: DIM }, (_, index) => ((acc + index) % 97) / 100 + 0.01);
};

interface EngineOptions {
  readonly model?: string;
  /**
   * Awaited before every *content* batch, so a test can hold a drain open.
   * Resolution's own one-word probe is exempt: resolving is how any caller —
   * including `GET /api/index/status` — learns there is a provider at all, and
   * gating it would deadlock the observer against the thing it is observing.
   */
  readonly gate?: Promise<void> | undefined;
  readonly onBatch?: ((texts: readonly string[]) => void) | undefined;
}

function engineFor(options: EngineOptions = {}): EmbeddedEngine {
  return createStaticEmbeddedEngine({
    model: options.model ?? "fixture",
    async embedBatch(texts) {
      options.onBatch?.(texts);
      if (options.gate !== undefined && !texts.includes(PROBE_TEXT)) await options.gate;
      return texts.map((text) => vectorFor(text));
    },
  });
}

/**
 * Wires the three collaborators exactly as `app.ts` and `worker-attach.ts` do:
 * one retrieval service (which owns the rebuild flag), one worker, and the
 * maintenance service bound to both.
 */
function build(engine: EmbeddedEngine): void {
  bus = createInvalidationBus();
  frames = [];
  // The seat the SSE hub occupies. `rebuilding` is captured *with* each frame,
  // because the rebuild's two announcements are claims about a flag no count
  // records — reading it afterwards would prove nothing about the ordering.
  bus.subscribe((keys) => {
    if (!keys.every((key) => key.length === 1 && key[0] === INDEX_KEY[0])) return;
    frames.push({ rebuilding: semantic.rebuild.active });
  });

  const resolve = () =>
    resolveEmbeddingProvider({
      settings: { kind: "absent" },
      // Read fresh on every resolution, as both production callers do — this is
      // what makes stickiness follow a discard instead of a boot-time snapshot.
      recordedIdentities: recordedIdentities(ws.db),
      embeddedEngine: engine,
    });

  semantic = createSemanticRetrieval({
    db: ws.db,
    settings: { kind: "absent" },
    logger: silentLogger,
    resolve,
    now: () => clock,
  });
  worker = startEmbedWorker({
    db: ws.db,
    logger: silentLogger,
    resolve,
    bus,
    intervalMs: 0,
    now: () => clock,
  });
  maintenance = createIndexMaintenance({ db: ws.db, semantic, logger: silentLogger, bus });
  maintenance.useWorker(worker);
}

/** Polls a condition on real timers; the drain is detached, so there is nothing to await. */
async function until(what: string, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeEach(() => {
  clock = 1_000;
  ws = createWorkspace("index-maintenance");
});

afterEach(async () => {
  await worker.close();
  ws.close();
});

function seedCorpus(count = 4): void {
  for (let index = 0; index < count; index += 1) {
    ws.doc({
      id: `doc_${String(index).padStart(3, "0")}`,
      title: `Document ${String(index)}`,
      body: `## Section ${String(index)}\n\nBody text number ${String(index)}.\n`,
    });
  }
  ws.reproject();
}

describe("GET /api/index/status", () => {
  it("reports a fresh workspace as disabled with a null identity and everything pending", async () => {
    seedCorpus();
    build(engineFor());

    const status = await maintenance.status();
    // `disabled` here is the *engine's* answer before anything is embedded: a
    // resolved provider with zero usable vectors is lexical-only until the first
    // one lands, which is the honest word for a corpus nobody has indexed yet.
    expect(status).toMatchObject({ indexed: 0, failed: 0, identity: null, rebuilding: false });
    expect(status.pending).toBeGreaterThan(0);
    expect(status.state).toBe("disabled");
  });

  it("agrees with the state the retrieval half publishes, from the same facts", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();

    // TEST-897: one workspace, one word. `semantic.state()` is what `/api/search`
    // and `/api/docs/{id}/related` put in `semanticIndex`.
    const [status, state] = [await maintenance.status(), await semantic.state()];
    expect(status.state).toBe(state);
    expect(status.state).toBe("current");
    expect(status.identity).toBe(identityOf("fixture"));
  });

  it("counts progress and always account for every chunk while a worker drains", async () => {
    seedCorpus(12);
    build(engineFor());

    const total = indexCounts(ws.db).total;
    const trajectory: number[] = [];
    for (let round = 0; round < 20; round += 1) {
      const status = await maintenance.status();
      // TEST-896: the identity `indexed + pending + failed === total` must hold
      // at every observation, not only at the end.
      expect(status.indexed + status.pending + status.failed).toBe(total);
      trajectory.push(status.pending);
      if (status.pending === 0) break;
      await worker.tick();
    }

    expect(trajectory.at(0)).toBe(total);
    expect(trajectory.at(-1)).toBe(0);
    // Monotone: a status endpoint that re-queued what it observed would not be.
    expect([...trajectory].sort((a, b) => b - a)).toEqual(trajectory);
  });

  it("starts no work and mutates nothing across a hundred polls", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();

    const before = indexCounts(ws.db);
    for (let poll = 0; poll < 100; poll += 1) await maintenance.status();
    // TEST-908: read-only in the strictest sense. Resolution is shared with
    // `/api/search` and cached, so the polls cost nothing and change nothing.
    expect(indexCounts(ws.db)).toEqual(before);
    expect(recordedIdentities(ws.db)).toEqual([identityOf("fixture")]);
  });

  it("says `indexing` rather than `stale` while a rebuild is in flight", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();

    semantic.rebuild.begin();
    try {
      const status = await maintenance.status();
      expect(status.rebuilding).toBe(true);
      expect(status.state).toBe("indexing");
    } finally {
      semantic.rebuild.end();
    }
  });

  it("reports a null identity for a mixed index rather than picking a winner", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();
    const [chunk] = ws.db.prepare("SELECT chunk_id FROM chunks LIMIT 1").all() as {
      chunk_id: string;
    }[];
    writeEmbedding(ws.db, {
      state: "ready",
      chunkId: chunk?.chunk_id ?? "",
      identity: "local/other@8",
      vector: Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]),
      updatedMs: 1,
    });

    // Two identities is drift, and `db doctor` is the surface that names both.
    // Status refuses to elect one — the contract's rule is compare for equality,
    // never parse, and there is nothing here to compare against.
    expect((await maintenance.status()).identity).toBeNull();
    expect(recordedIdentities(ws.db)).toHaveLength(2);
  });
});

/**
 * The rider's wire half (2026-08-01). Six fields could not distinguish a model
 * that is 46% downloaded from a machine that will never have one — the
 * SERVER-048 evaluation sampled a live download three times and got byte-
 * identical payloads saying `disabled` (FAIL-1). The seventh field is optional,
 * it is the resolution's or the engine's own words, and nothing here composes it.
 */
describe("GET /api/index/status — the detail sentence", () => {
  it("carries the engine's download sentence onto the wire", async () => {
    seedCorpus();
    build(
      createStaticEmbeddedEngine({
        model: "fixture",
        availability: {
          available: false,
          reason: "model-not-downloaded",
          detail:
            "downloading the fixture embedding model (10.4 MiB of 22.6 MiB, 46%) — " +
            "semantic ranking starts once it is cached",
        },
        embedBatch: (texts) => Promise.resolve(texts.map((text) => vectorFor(text))),
      }),
    );

    const status = await maintenance.status();
    expect(status.state).toBe("disabled");
    expect(status.detail).toContain("46%");
    // The state word did not move to carry it, and the counts are unchanged.
    expect(status.identity).toBeNull();
    expect(status.indexed).toBe(0);
  });

  it("omits the key entirely once the index is caught up", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();

    const status = await maintenance.status();
    expect(status.state).toBe("current");
    expect("detail" in status).toBe(false);
    // Through JSON too: the endpoint's answer must not grow a `null`.
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
  });

  it("explains a fresh workspace whose provider is fine and whose index is empty", async () => {
    seedCorpus();
    build(engineFor());

    const status = await maintenance.status();
    expect(status.state).toBe("disabled");
    expect(status.detail).toContain(identityOf("fixture"));
    expect(status.pending).toBeGreaterThan(0);
  });
});

describe("POST /api/index/rebuild", () => {
  it("returns the post-queue snapshot before anything is embedded", async () => {
    seedCorpus(6);
    build(engineFor());
    await worker.tick();
    expect(indexCounts(ws.db).pending).toBe(0);
    const total = indexCounts(ws.db).total;

    const queued = maintenance.rebuild();

    // TEST-898: the verb is *synchronous* — it cannot have waited on an
    // inference, a batch or a poll, because there is no await in its path.
    expect(queued).toMatchObject({
      indexed: 0,
      failed: 0,
      pending: total,
      identity: null,
      rebuilding: true,
      state: "indexing",
    });
    await until("the drain to finish", () => !semantic.rebuild.active);
  });

  it("discards every vector, including orphaned ones", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();
    writeEmbedding(ws.db, {
      state: "ready",
      chunkId: "chunk_that_no_document_produces",
      identity: identityOf("fixture"),
      vector: Float32Array.from([1, 0, 0, 0]),
      updatedMs: 1,
    });
    const rows = () =>
      (ws.db.prepare("SELECT COUNT(*) AS n FROM chunk_embeddings").get() as { n: number }).n;
    expect(rows()).toBeGreaterThan(1);

    maintenance.rebuild();
    // Observed synchronously, before the detached drain has run a microtask.
    expect(rows()).toBe(0);
    await until("the drain to finish", () => !semantic.rebuild.active);
  });

  it("keeps `rebuilding` raised until the drain finishes, then lowers it", async () => {
    seedCorpus(4);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    build(engineFor({ gate }));

    maintenance.rebuild();
    expect(semantic.rebuild.active).toBe(true);
    expect((await maintenance.status()).state).toBe("indexing");

    release();
    await until("the drain to finish", () => !semantic.rebuild.active);
    expect(indexCounts(ws.db).pending).toBe(0);
    expect((await maintenance.status()).state).toBe("current");
  });

  it("re-picks the identity — the one place stickiness resets", async () => {
    seedCorpus();
    build(engineFor({ model: "old" }));
    await worker.tick();
    expect(recordedIdentities(ws.db)).toEqual([identityOf("old")]);

    // A different model appears. Stickiness refuses it: resolution reports
    // `sticky-model-unavailable`, the vectors stay, and nothing is queued —
    // §9.1's "never as a surprise background rebuild" (TEST-846's negatives).
    await worker.close();
    build(engineFor({ model: "new" }));
    await worker.tick();
    expect(recordedIdentities(ws.db)).toEqual([identityOf("old")]);
    expect(indexCounts(ws.db).pending).toBe(0);

    // TEST-899: the explicit act. The discard removes what the resolution was
    // sticky to, and the drain adopts the model available now.
    maintenance.rebuild();
    await until("the drain to finish", () => !semantic.rebuild.active);
    expect(recordedIdentities(ws.db)).toEqual([identityOf("new")]);
    expect(indexCounts(ws.db)).toMatchObject({ pending: 0, failed: 0 });
  });

  it("re-queues chunks that had given up, which is what `failed` never drains without", async () => {
    seedCorpus(2);
    build(engineFor());
    const [chunk] = ws.db.prepare("SELECT chunk_id FROM chunks LIMIT 1").all() as {
      chunk_id: string;
    }[];
    writeEmbedding(ws.db, {
      state: "failed",
      chunkId: chunk?.chunk_id ?? "",
      identity: identityOf("fixture"),
      failures: 99,
      updatedMs: 1,
    });
    expect(indexCounts(ws.db).failed).toBe(1);

    maintenance.rebuild();
    await until("the drain to finish", () => !semantic.rebuild.active);
    expect(indexCounts(ws.db)).toMatchObject({ failed: 0, pending: 0 });
  });

  // SERVER-051. The rebuild flag is the one part of `IndexStatus` no row
  // records, so these two frames are the only way a client learns that `state`
  // entered and left `indexing`.
  it("announces its start with the 202, and its end once the flag is down", async () => {
    seedCorpus(4);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Gated, so the drain cannot finish before the start frame is asserted —
    // and therefore not ticked first: a gated engine would hold the tick open.
    build(engineFor({ gate }));

    maintenance.rebuild();
    // Synchronous with the acknowledgement, and describing the same instant it
    // does: the discard has landed and the flag is up.
    expect(frames).toEqual([{ rebuilding: true }]);

    release();
    await until("the drain to finish", () => !semantic.rebuild.active);

    // The drain's own frames sit between, but the last word belongs to the
    // rebuild: `indexing` is over, and it is announced after the flag is down
    // so a refetch on this frame reads the settled state.
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.at(-1)).toEqual({ rebuilding: false });
    expect((await maintenance.status()).state).toBe("current");
  });

  it("announces the end even on a server with no worker to drain it", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();
    frames.length = 0;

    const detached = createIndexMaintenance({ db: ws.db, semantic, logger: silentLogger, bus });
    detached.rebuild();
    await until("the flag to drop", () => !semantic.rebuild.active);

    expect(frames).toEqual([{ rebuilding: true }, { rebuilding: false }]);
  });

  it("still discards and re-queues on a server with no worker bound", async () => {
    seedCorpus();
    build(engineFor());
    await worker.tick();
    const total = indexCounts(ws.db).total;

    const detached = createIndexMaintenance({ db: ws.db, semantic, logger: silentLogger });
    const queued = detached.rebuild();

    expect(queued).toMatchObject({ indexed: 0, pending: total, rebuilding: true });
    // The flag must still come down, or the workspace would claim a rebuild in
    // flight that has no worker behind it, forever.
    await until("the flag to drop", () => !semantic.rebuild.active);
  });
});

describe("POST /api/db/rebuild (the other rebuild)", () => {
  it("keeps the identity and queues nothing for an unchanged corpus", async () => {
    seedCorpus(6);
    build(engineFor());
    await worker.tick();
    const before = indexCounts(ws.db);
    expect(before.pending).toBe(0);

    // TEST-900 / Open Conflict 5: the projection is rebuilt from files while
    // `chunk_embeddings` is carried across by content-addressed chunk id, so the
    // observable difference between the two rulings — the queued count — is zero.
    rebuildProjection(ws.config, { logger: silentLogger });
    ws.db.reopenAround(() => undefined);

    expect(recordedIdentities(ws.db)).toEqual([identityOf("fixture")]);
    expect(indexCounts(ws.db)).toEqual(before);
    expect((await maintenance.status()).state).toBe("current");
  });
});
