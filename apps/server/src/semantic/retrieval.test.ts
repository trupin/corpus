import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { silentLogger } from "../logger.js";
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
