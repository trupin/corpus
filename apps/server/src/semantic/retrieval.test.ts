import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { silentLogger } from "../logger.js";
import type { EmbeddedEngine, EmbeddedEngineAvailability } from "./embedded-engine.js";
import { createSemanticRetrieval, RESOLVE_COOLDOWN_MS } from "./retrieval.js";
import type { ProviderResolution } from "./resolve.js";
import { UNFILTERED_SCOPE } from "./vectors.js";
import { embedDocuments, stubResolution } from "./vector-fixture.js";

const IDENTITY = "stub/fixture@2";
const OTHER_IDENTITY = "stub/other@2";

/** `[1, 0]` for anything mentioning "north", `[0, 1]` otherwise. */
const directionOf = (text: string): readonly number[] =>
  text.toLowerCase().includes("north") ? [1, 0] : [0, 1];

let ws: Workspace;
let clock = 1_000;

const build = (
  resolve: () => Promise<ProviderResolution>,
): ReturnType<typeof createSemanticRetrieval> =>
  createSemanticRetrieval({
    db: ws.db,
    settings: { kind: "absent" },
    logger: silentLogger,
    resolve,
    now: () => clock,
  });

beforeEach(() => {
  clock = 1_000;
  ws = createWorkspace("retrieval");
  ws.doc({ id: "doc_north", title: "North", body: "Northerly body." });
  ws.doc({ id: "doc_south", title: "South", body: "Southerly body." });
  ws.reproject();
});

afterEach(() => {
  ws.close();
});

describe("forQuery", () => {
  it("ranks nearest first and reports `current` when the index is caught up", async () => {
    // `doc_south` is near enough to clear the relevance floor and further than
    // `doc_north`, so the order is a fact about the distances rather than the ids.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0.9, 0.436] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const outcome = await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(outcome.state).toBe("current");
    expect(outcome.docs.map((match) => match.id)).toEqual(["doc_north", "doc_south"]);
  });

  it("still contributes what it has while a backlog drains", async () => {
    // TEST-885: degraded is not disabled. `doc_north` is indexed, `doc_south` is
    // not, and the indexed neighbour still surfaces.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const outcome = await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(outcome.state).toBe("stale");
    expect(outcome.docs.map((match) => match.id)).toEqual(["doc_north"]);
  });

  it("says `indexing` rather than `stale` while a rebuild is in flight", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );
    expect((await retrieval.forQuery("north", UNFILTERED_SCOPE, 10)).state).toBe("stale");

    retrieval.rebuild.begin();
    expect((await retrieval.forQuery("north", UNFILTERED_SCOPE, 10)).state).toBe("indexing");
    retrieval.rebuild.end();
    expect((await retrieval.forQuery("north", UNFILTERED_SCOPE, 10)).state).toBe("stale");
  });

  it("is `disabled` with no provider, with no vectors, and with a foreign index", async () => {
    // TEST-884's three sub-cases, each asserted on its own.
    const noProvider = build(() =>
      Promise.resolve({ kind: "disabled", reason: "engine-not-installed", detail: "none" }),
    );
    const noVectors = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );
    expect(await noProvider.forQuery("north", UNFILTERED_SCOPE, 10)).toEqual({
      state: "disabled",
      docs: [],
    });
    expect(await noVectors.forQuery("north", UNFILTERED_SCOPE, 10)).toEqual({
      state: "disabled",
      docs: [],
    });

    embedDocuments(ws.db, OTHER_IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    const mismatched = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );
    const outcome = await mismatched.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(outcome.state).toBe("disabled");
    // TEST-889: not one foreign-identity vector influenced the ranking.
    expect(outcome.docs).toEqual([]);
  });

  it("degrades this request to lexical when the query embedding fails", async () => {
    // TEST-888: a healthy index, a provider that fails on *this* embedding.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0.9, 0.436] });
    let failing = true;
    const retrieval = build(() =>
      Promise.resolve(
        stubResolution(IDENTITY, {
          embed: (text) => {
            if (failing) throw new Error("embedding service is down");
            return directionOf(text);
          },
        }),
      ),
    );

    const degraded = await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(degraded.state).toBe("disabled");
    expect(degraded.docs).toEqual([]);

    // The provider was dropped; after the cooldown a healthy one is picked up.
    failing = false;
    clock += RESOLVE_COOLDOWN_MS + 1;
    const healthy = await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(healthy.state).toBe("current");
    expect(healthy.docs.map((match) => match.id)).toEqual(["doc_north", "doc_south"]);
  });

  it("degrades rather than throwing when a provider returns an unusable vector", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    const retrieval = build(() => Promise.resolve(stubResolution(IDENTITY, { embed: () => [] })));
    const outcome = await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(outcome.state).toBe("disabled");
    expect(outcome.docs).toEqual([]);
  });

  it("scopes the scan with the filter clause it is handed", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0.9, 0.436] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const scoped = await retrieval.forQuery(
      "north",
      { where: "d.id = @only", params: { only: "doc_south" } },
      10,
    );
    expect(scoped.docs.map((match) => match.id)).toEqual(["doc_south"]);
  });
});

describe("provider resolution", () => {
  it("resolves once and reuses the answer across requests", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    let resolutions = 0;
    const retrieval = build(() => {
      resolutions += 1;
      return Promise.resolve(stubResolution(IDENTITY, { embed: directionOf }));
    });

    await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    await retrieval.forDocument("doc_north", UNFILTERED_SCOPE, 10);
    expect(resolutions).toBe(1);
  });

  it("shares one resolution between requests that arrive together", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    let resolutions = 0;
    const retrieval = build(async () => {
      resolutions += 1;
      await Promise.resolve();
      return stubResolution(IDENTITY, { embed: directionOf });
    });

    await Promise.all([
      retrieval.forQuery("north", UNFILTERED_SCOPE, 10),
      retrieval.forQuery("north", UNFILTERED_SCOPE, 10),
      retrieval.forQuery("north", UNFILTERED_SCOPE, 10),
    ]);
    expect(resolutions).toBe(1);
  });

  it("does not retry a failed resolution until the cooldown expires", async () => {
    let resolutions = 0;
    const retrieval = build(() => {
      resolutions += 1;
      return Promise.resolve({
        kind: "error",
        reason: "provider-unreachable",
        detail: "connect ECONNREFUSED",
      });
    });

    await retrieval.state();
    await retrieval.state();
    clock += RESOLVE_COOLDOWN_MS - 1;
    await retrieval.state();
    expect(resolutions).toBe(1);

    clock += 2;
    await retrieval.state();
    expect(resolutions).toBe(2);
  });

  it("re-resolves after the index moves to another model", async () => {
    // An `index rebuild` re-picks the provider and rewrites every vector under a
    // new identity. The cached answer is then about a model this workspace no
    // longer uses, so it is dropped rather than kept answering `disabled`.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    let identity = IDENTITY;
    let resolutions = 0;
    const retrieval = build(() => {
      resolutions += 1;
      return Promise.resolve(stubResolution(identity, { embed: directionOf }));
    });

    expect((await retrieval.state()).valueOf()).toBe("stale");
    ws.db.prepare("DELETE FROM chunk_embeddings").run();
    embedDocuments(ws.db, OTHER_IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });

    expect(await retrieval.state()).toBe("disabled");
    identity = OTHER_IDENTITY;
    clock += RESOLVE_COOLDOWN_MS + 1;
    expect(await retrieval.state()).toBe("current");
    expect(resolutions).toBe(2);
  });
});

describe("forDocument", () => {
  it("ranks a document's neighbours and never itself", async () => {
    // TEST-894: the Phase A guarantee holds for the semantic half.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0.9, 0.44] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const outcome = await retrieval.forDocument("doc_north", UNFILTERED_SCOPE, 10);
    expect(outcome.docs.map((match) => match.id)).toEqual(["doc_south"]);
    expect(outcome.state).toBe("current");
  });

  it("needs no query embedding at all", async () => {
    const embedded: string[] = [];
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    const retrieval = build(() =>
      Promise.resolve(
        stubResolution(IDENTITY, { embed: directionOf, onEmbed: (text) => embedded.push(text) }),
      ),
    );

    await retrieval.forDocument("doc_north", UNFILTERED_SCOPE, 10);
    expect(embedded).toEqual([]);
  });

  it("answers nothing for a document with no vector, without claiming a degrade", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const outcome = await retrieval.forDocument("doc_south", UNFILTERED_SCOPE, 10);
    expect(outcome.docs).toEqual([]);
    // The index is fine; this document is merely still pending.
    expect(outcome.state).toBe("stale");
  });

  it("is `disabled` with no provider, exactly as search is", async () => {
    // The two endpoints degrade together: one word covers both envelopes.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    const retrieval = build(() =>
      Promise.resolve({ kind: "disabled", reason: "off-by-config", detail: "off" }),
    );
    expect(await retrieval.forDocument("doc_north", UNFILTERED_SCOPE, 10)).toEqual({
      state: "disabled",
      docs: [],
    });
  });
});

/**
 * The 2026-08-01 rider: `GET /api/index/status` carries a sentence beside the
 * word, and the flagship first run is what it exists for.
 *
 * The SERVER-048 evaluation sampled `index status` three times across a live
 * 22.6 MiB model download and got six byte-identical fields saying `disabled`
 * (FAIL-1), then another ~30 s of `disabled` after the download and the drain
 * had both finished (LEDGER-1) — a first run that reads as "permanently off"
 * from end to end. Both halves are properties of this file: the sentence comes
 * from here, and the cooldown that outlived the wait is here too.
 */
describe("status — the sentence beside the word", () => {
  const DOWNLOADING_AT = (percent: number): string =>
    `downloading the fixture embedding model (${String(percent)}%) — ` +
    "semantic ranking starts once it is cached";

  /** An engine whose availability answer moves, which is what a download is. */
  function downloadingEngine(): {
    readonly engine: EmbeddedEngine;
    set(next: EmbeddedEngineAvailability): void;
    asked(): number;
  } {
    let availability: EmbeddedEngineAvailability = {
      available: false,
      reason: "model-not-downloaded",
      detail: DOWNLOADING_AT(3),
    };
    let asked = 0;
    return {
      engine: {
        ref: { provider: "local", model: "fixture" },
        availability: () => {
          asked += 1;
          return Promise.resolve(availability);
        },
        open: () => Promise.reject(new Error("the test never loads a model")),
      },
      set: (next) => {
        availability = next;
      },
      asked: () => asked,
    };
  }

  it("reports the download's *current* percentage, not the one it cached", async () => {
    // The evaluator's exact observation: three samples across a live download,
    // all identical. Resolution is cooled down after the first, so the sentence
    // can only move if something re-reads the engine.
    const model = downloadingEngine();
    let resolutions = 0;
    const retrieval = build(() => {
      resolutions += 1;
      return Promise.resolve({
        kind: "disabled",
        reason: "model-not-downloaded",
        detail: DOWNLOADING_AT(3),
      });
    });
    retrieval.useEngine(model.engine);

    const first = await retrieval.status();
    expect(first.state).toBe("disabled");
    expect(first.detail).toBe(DOWNLOADING_AT(3));

    model.set({ available: false, reason: "model-not-downloaded", detail: DOWNLOADING_AT(46) });
    const second = await retrieval.status();
    model.set({ available: false, reason: "model-not-downloaded", detail: DOWNLOADING_AT(91) });
    const third = await retrieval.status();

    expect([second.detail, third.detail]).toEqual([DOWNLOADING_AT(46), DOWNLOADING_AT(91)]);
    // And none of that cost a re-resolution, which is what the cooldown buys.
    expect(resolutions).toBe(1);
  });

  it("adopts the model the instant the download lands, without waiting out the cooldown", async () => {
    // LEDGER-1: the cooldown is 30 s and the clock below never moves.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    const model = downloadingEngine();
    let cached = false;
    const retrieval = build(() =>
      Promise.resolve(
        cached
          ? stubResolution(IDENTITY, { embed: directionOf })
          : { kind: "disabled", reason: "model-not-downloaded", detail: DOWNLOADING_AT(3) },
      ),
    );
    retrieval.useEngine(model.engine);

    expect((await retrieval.status()).state).toBe("disabled");

    const before = clock;
    model.set({ available: true });
    cached = true;

    const after = await retrieval.status();
    expect(after.state).toBe("current");
    expect(after.detail).toBeUndefined();
    expect(clock).toBe(before);
  });

  it("lets the engine end the cooldown for the search path too", async () => {
    // The push half: `lifecycle.ts` wires `engine.onModelReady` to this, so a
    // download completing while nobody is polling still heals the next search.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    let cached = false;
    let resolutions = 0;
    const retrieval = build(() => {
      resolutions += 1;
      return Promise.resolve(
        cached
          ? stubResolution(IDENTITY, { embed: directionOf })
          : { kind: "disabled", reason: "model-not-downloaded", detail: DOWNLOADING_AT(3) },
      );
    });

    expect((await retrieval.forQuery("north", UNFILTERED_SCOPE, 10)).docs).toEqual([]);
    expect((await retrieval.forQuery("north", UNFILTERED_SCOPE, 10)).docs).toEqual([]);
    expect(resolutions).toBe(1);

    cached = true;
    retrieval.invalidateResolution();

    const outcome = await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(outcome.docs.map((match) => match.id)).toEqual(["doc_north"]);
    expect(resolutions).toBe(2);
  });

  it("asks the engine nothing when the reason is not a download that can finish", async () => {
    // A cooldown exists for endpoints that stay down, and `off-by-config` never
    // stops being true by itself. Re-reading an engine over either would be a
    // syscall per status render for an answer that cannot have changed.
    const model = downloadingEngine();
    const retrieval = build(() =>
      Promise.resolve({
        kind: "disabled",
        reason: "off-by-config",
        detail: 'semantic indexing is turned off by `"provider": "none"`; search is lexical only',
      }),
    );
    retrieval.useEngine(model.engine);

    const first = await retrieval.status();
    const second = await retrieval.status();
    expect(first.detail).toContain('"provider": "none"');
    // The sentence survives the cooldown: a second render must not degrade to
    // "no embedding provider has resolved yet".
    expect(second.detail).toBe(first.detail);
    expect(model.asked()).toBe(0);
  });

  it("falls back to the cached sentence when the engine cannot answer at all", async () => {
    // An engine that throws is resolution's problem to report, not a status
    // read's to crash on: the endpoint still answers, with what it last knew.
    const retrieval = build(() =>
      Promise.resolve({
        kind: "disabled",
        reason: "model-not-downloaded",
        detail: DOWNLOADING_AT(3),
      }),
    );
    retrieval.useEngine({
      ref: { provider: "local", model: "fixture" },
      availability: () => Promise.reject(new Error("the cache directory vanished")),
      open: () => Promise.reject(new Error("the test never loads a model")),
    });

    expect((await retrieval.status()).detail).toBe(DOWNLOADING_AT(3));
    const second = await retrieval.status();
    expect(second.state).toBe("disabled");
    expect(second.detail).toBe(DOWNLOADING_AT(3));
  });

  it("says nothing at all when the index is caught up", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const status = await retrieval.status();
    expect(status.state).toBe("current");
    expect("detail" in status).toBe(false);
  });

  it("explains an index built by another model, and keeps explaining it", async () => {
    embedDocuments(ws.db, OTHER_IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const first = await retrieval.status();
    expect(first.state).toBe("disabled");
    expect(first.detail).toContain(OTHER_IDENTITY);
    expect(first.detail).toContain("index rebuild");
    // The dropped provider starts a cooldown, and the next render answers from
    // it — with the same sentence, not with the never-resolved placeholder.
    expect((await retrieval.status()).detail).toBe(first.detail);
  });

  it("explains an empty index behind a provider that is perfectly fine", async () => {
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    const status = await retrieval.status();
    expect(status.state).toBe("disabled");
    expect(status.detail).toContain(IDENTITY);
    expect(status.detail).toContain("no vectors yet");
  });

  it("publishes the same word `state()` does, from one reading", async () => {
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0] });
    const retrieval = build(() =>
      Promise.resolve(stubResolution(IDENTITY, { embed: directionOf })),
    );

    expect((await retrieval.status()).state).toBe(await retrieval.state());
    expect(await retrieval.state()).toBe("stale");
  });
});

describe("resolution invalidation", () => {
  const DOWNLOADING =
    "downloading the fixture embedding model — semantic ranking starts once cached";

  /**
   * A resolution held open by the test, so an invalidation can land *while* it is
   * in flight rather than between two of them.
   *
   * The answer is decided when the resolution starts, not when it settles: that
   * is what a snapshot question is, and it is the whole point of the race.
   */
  function gatedResolver(): {
    readonly resolve: () => Promise<ProviderResolution>;
    release(): void;
    calls(): number;
  } {
    let calls = 0;
    let release = (): void => undefined;
    const gate = new Promise<void>((settle) => {
      release = () => {
        settle();
      };
    });
    return {
      resolve: async () => {
        calls += 1;
        const answer: ProviderResolution =
          calls === 1
            ? { kind: "disabled", reason: "model-not-downloaded", detail: DOWNLOADING }
            : stubResolution(IDENTITY, { embed: directionOf });
        if (calls === 1) await gate;
        return answer;
      },
      release: () => {
        release();
      },
      calls: () => calls,
    };
  }

  it("ignores a cooldown written by a resolution that finished after an invalidation", async () => {
    // LEDGER-1 reached by a race rather than by the clock. The first resolution
    // starts while the model is still downloading; `onModelReady` fires *during*
    // it; its "model-not-downloaded" verdict lands afterwards and used to write a
    // fresh 30 s cooldown from a fact that had already stopped being true. The
    // clock below never moves, so a re-armed cooldown is permanent here.
    embedDocuments(ws.db, IDENTITY, { doc_north: [1, 0], doc_south: [0, 1] });
    const resolver = gatedResolver();
    const retrieval = build(resolver.resolve);

    const inFlight = retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(resolver.calls()).toBe(1);

    // The bytes land, and the engine says so, while that resolution is stuck.
    retrieval.invalidateResolution();
    resolver.release();

    // This request is honestly lexical: nothing had resolved when it asked.
    expect((await inFlight).docs).toEqual([]);
    expect(resolver.calls()).toBe(1);

    const after = await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    // `doc_south` sits at right angles to the query and is below the relevance
    // floor; the point is that the semantic half ran at all.
    expect(after.docs.map((match) => match.id)).toEqual(["doc_north"]);
    expect(after.state).toBe("current");
    expect(resolver.calls()).toBe(2);
    expect(clock).toBe(1_000);
  });

  it("still arms the cooldown for a resolution nothing invalidated", async () => {
    // The counter must not disarm the ordinary case: an endpoint that is simply
    // down still costs one timeout per cooldown, not one per request.
    let calls = 0;
    const retrieval = build(() => {
      calls += 1;
      return Promise.resolve({
        kind: "error",
        reason: "provider-unreachable",
        detail: "the endpoint refused",
      });
    });

    await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(calls).toBe(1);

    clock += RESOLVE_COOLDOWN_MS + 1;
    await retrieval.forQuery("north", UNFILTERED_SCOPE, 10);
    expect(calls).toBe(2);
  });
});
