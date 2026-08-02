// Retrieval Phase B's ranking, end to end through `searchCorpus` (SERVER-045).
//
// Distances are hand-set (`semantic/vector-fixture.ts`): a ranking test that
// asked a real model which document is nearer would be re-asserting the model
// every run. The real provider is exercised in the issue's E2E log, against the
// real engine, on real paraphrases.

import {
  RETRIEVAL_DEFAULT_LIMIT,
  SearchQuerySchema,
  SearchResultsSchema,
  type SearchHit,
  type SearchQuery,
} from "@corpus/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { silentLogger } from "../logger.js";
import { createSemanticRetrieval, type SemanticRetrieval } from "../semantic/index.js";
import { embedChunks, embedDocuments, stubResolution } from "../semantic/vector-fixture.js";
import { searchCorpus } from "./search.js";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const IDENTITY = "stub/fixture@2";

// ---------------------------------------------------------------------------
// TEST-879 — the paraphrase pair. Two documents about the same thing that share
// no content word, so the lexical half structurally cannot connect them.
// ---------------------------------------------------------------------------

const REVENUE_TITLE = "Quarterly revenue growth slowed";
const REVENUE_BODY = "Quarterly revenue growth slowed against the prior period.";
const SALES_TITLE = "Sales fell off";
const SALES_BODY = "Sales fell off over the last three months across every region.";

/** Words carrying no topic, excluded from the disjointness proof. */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "over",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

const contentWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/u)
      .filter((word) => word !== "" && !STOPWORDS.has(word)),
  );

/** `[1, 0]` for anything about revenue; `[0, 1]` for anything else. */
const revenueDirection = (text: string): readonly number[] =>
  /revenue|growth|sales|quarter/iu.test(text) ? [1, 0] : [0, 1];

let ws: Workspace;

const retrievalOver = (
  workspace: Workspace,
  embed: (text: string) => readonly number[] = revenueDirection,
): SemanticRetrieval =>
  createSemanticRetrieval({
    db: workspace.db,
    settings: { kind: "absent" },
    logger: silentLogger,
    resolve: () => Promise.resolve(stubResolution(IDENTITY, { embed })),
  });

const run = async (
  workspace: Workspace,
  params: Readonly<Record<string, string>>,
  semantic?: SemanticRetrieval,
): Promise<{ hits: SearchHit[]; semanticIndex: string | undefined }> => {
  const query: SearchQuery = SearchQuerySchema.parse(params);
  const results = await searchCorpus(workspace.db, query, NOW, { semantic });
  expect(SearchResultsSchema.parse(results)).toEqual(results);
  return { hits: [...results.hits], semanticIndex: results.semanticIndex };
};

const ids = (hits: readonly SearchHit[]): string[] => hits.map((hit) => hit.id);

function seedParaphrasePair(workspace: Workspace): void {
  workspace.doc({ id: "doc_revenue", title: REVENUE_TITLE, body: REVENUE_BODY });
  workspace.doc({ id: "doc_sales", title: SALES_TITLE, body: SALES_BODY });
  workspace.doc({
    id: "doc_kitchen",
    title: "Kitchen renovation timeline",
    body: "Cabinets arrive before the plumbing rough-in.",
  });
  workspace.reproject();
  embedDocuments(workspace.db, IDENTITY, {
    doc_revenue: [1, 0],
    doc_sales: [0.98, 0.199],
    doc_kitchen: [0, 1],
  });
}

beforeEach(() => {
  ws = createWorkspace("hybrid");
});

afterEach(() => {
  ws.close();
});

describe("the paraphrase pair", () => {
  it("is genuinely keyword-disjoint — the fixture proves its own premise", () => {
    const left = contentWords(`${REVENUE_TITLE} ${REVENUE_BODY}`);
    const right = contentWords(`${SALES_TITLE} ${SALES_BODY}`);
    const shared = [...left].filter((word) => right.has(word));
    expect(shared).toEqual([]);
    expect(left.size).toBeGreaterThan(3);
    expect(right.size).toBeGreaterThan(3);
  });

  it("is invisible to the lexical half — both directions", async () => {
    seedParaphrasePair(ws);
    expect(ids((await run(ws, { q: "revenue growth" })).hits)).toEqual(["doc_revenue"]);
    expect(ids((await run(ws, { q: "sales months" })).hits)).toEqual(["doc_sales"]);
  });

  it("surfaces through hybrid ranking — both directions", async () => {
    // The demo that vectors work: a query matching one document lexically also
    // returns the one that shares none of its words.
    seedParaphrasePair(ws);
    const semantic = retrievalOver(ws);

    const forward = await run(ws, { q: "revenue growth" }, semantic);
    expect(forward.semanticIndex).toBe("current");
    expect(ids(forward.hits)).toEqual(["doc_revenue", "doc_sales"]);
    // And the document about neither subject stays out: the semantic half adds
    // a paraphrase, not everything it has a vector for.
    expect(ids(forward.hits)).not.toContain("doc_kitchen");

    const backward = await run(ws, { q: "sales months" }, semantic);
    expect(ids(backward.hits)).toContain("doc_revenue");
  });

  it("gives the semantic-only hit a real address and a real line of context", async () => {
    seedParaphrasePair(ws);
    const hits = (await run(ws, { q: "revenue growth" }, retrievalOver(ws))).hits;
    const sales = hits.find((hit) => hit.id === "doc_sales");

    expect(sales).toBeDefined();
    expect(sales?.title).toBe(SALES_TITLE);
    // No FTS row matched it, so its address is its matching chunk's heading path
    // — here the document title, the §9.2 floor for a chunk with no heading.
    expect(sales?.headingPath).toBe(SALES_TITLE);
    expect(sales?.snippet).toBe(SALES_BODY);
    expect(Object.keys(sales ?? {}).sort()).toEqual(["headingPath", "id", "snippet", "title"]);
  });

  it("addresses a chunk that occurs twice by its first position, not its last", async () => {
    // PR #17 NIT: `chunkId` hashes (document, heading path, text) and *not* the
    // position, so a document with two byte-identical sections under one heading
    // is one chunk addressed at two `ord`s. `new Map(rows.map(…))` kept the last
    // — the occurrence furthest from the top — where the earliest is the one a
    // reader sent to that hit expects to land on.
    const section = "## Notes\n\nAccess is revoked the same afternoon.\n";
    ws.doc({
      id: "doc_repeat",
      title: "Operations manual",
      body: `${section}\n## Other\n\nBadges are issued on the first day.\n\n${section}`,
    });
    ws.doc({ id: "doc_lex", title: "Revocation policy", body: "Revocation policy text." });
    ws.reproject();
    embedChunks(ws.db, IDENTITY, (chunk) =>
      chunk.docId === "doc_repeat" && chunk.headingPath === "Notes" ? [1, 0] : [0, 1],
    );

    // The fixture's premise, asserted rather than assumed: one id, two positions.
    const rows = ws.db
      .prepare(`SELECT ord FROM chunk_search WHERE doc_id = 'doc_repeat' ORDER BY ord`)
      .all() as { ord: number }[];
    const duplicated = ws.db
      .prepare(
        `SELECT ord FROM chunk_search WHERE doc_id = 'doc_repeat' AND heading_path = 'Notes'
          ORDER BY ord`,
      )
      .all() as { ord: number }[];
    expect(rows).toHaveLength(3);
    expect(duplicated.map((row) => row.ord)).toEqual([0, 2]);

    // The projector emits identical columns for both, so the *choice* is only
    // observable once they differ — which is what this marks. The later row is
    // stamped so a last-wins map would report it.
    ws.db
      .prepare(
        `UPDATE chunk_search SET body = 'the later copy', heading_path = 'Notes (later)'
          WHERE doc_id = 'doc_repeat' AND ord = 2`,
      )
      .run();

    const hits = (
      await run(
        ws,
        { q: "revocation" },
        retrievalOver(ws, () => [1, 0]),
      )
    ).hits;
    const repeat = hits.find((hit) => hit.id === "doc_repeat");
    expect(repeat?.headingPath).toBe("Notes");
    expect(repeat?.snippet).toContain("Access is revoked");
  });

  it("addresses a semantic-only hit by the section that matched", async () => {
    ws.doc({
      id: "doc_manual",
      title: "Operations manual",
      body: "## Onboarding\n\nBadges are issued on the first day.\n\n## Offboarding\n\nAccess is revoked the same afternoon.\n",
    });
    ws.doc({ id: "doc_lex", title: "Revocation policy", body: "Revocation policy text." });
    ws.reproject();
    // Only the *Offboarding* section is near the query.
    embedChunks(ws.db, IDENTITY, (chunk) =>
      chunk.docId === "doc_manual"
        ? chunk.headingPath === "Offboarding"
          ? [1, 0]
          : [0, 1]
        : [0, 1],
    );

    const hits = (
      await run(
        ws,
        { q: "revocation" },
        retrievalOver(ws, () => [1, 0]),
      )
    ).hits;
    const manual = hits.find((hit) => hit.id === "doc_manual");
    expect(manual?.headingPath).toBe("Offboarding");
    expect(manual?.snippet).toContain("Access is revoked");
  });
});

describe("fusion", () => {
  it("promotes a document ranked past the page lexically but first semantically", async () => {
    // TEST-882. Twelve documents match `ledger`; the semantic half puts the one
    // ranked last lexically first. Without the over-fetch, fusion would never
    // see it and this promotion would be silently impossible.
    for (let index = 0; index < 12; index += 1) {
      const suffix = String(index).padStart(2, "0");
      ws.doc({
        id: `doc_bulk${suffix}`,
        title: `Ledger note ${suffix}`,
        // Later documents dilute the term, so bm25 ranks them lower.
        body: `The ledger entry ${suffix}. ${"Filler narrative sentence. ".repeat(index * 4)}`,
      });
    }
    ws.reproject();
    embedChunks(ws.db, IDENTITY, (chunk) => (chunk.docId === "doc_bulk11" ? [1, 0] : [0, 1]));

    const lexicalOnly = await run(ws, { q: "ledger" });
    expect(lexicalOnly.hits).toHaveLength(RETRIEVAL_DEFAULT_LIMIT);
    // The premise: at `limit=10` the target is not even on the lexical page.
    const deepRank = ids((await run(ws, { q: "ledger", limit: "50" })).hits).indexOf("doc_bulk11");
    expect(deepRank).toBeGreaterThanOrEqual(RETRIEVAL_DEFAULT_LIMIT);
    expect(ids(lexicalOnly.hits)).not.toContain("doc_bulk11");

    const fused = await run(
      ws,
      { q: "ledger" },
      retrievalOver(ws, () => [1, 0]),
    );
    expect(fused.hits).toHaveLength(RETRIEVAL_DEFAULT_LIMIT);
    expect(ids(fused.hits)[0]).toBe("doc_bulk11");
  });

  it("is deterministic in one process and across a fresh one", async () => {
    // TEST-881. Same fixture, same query: byte-identical order twice here, and
    // byte-identical again over a freshly built workspace and a fresh service.
    seedParaphrasePair(ws);
    const semantic = retrievalOver(ws);
    const first = await run(ws, { q: "revenue growth" }, semantic);
    const second = await run(ws, { q: "revenue growth" }, semantic);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const fresh = createWorkspace("hybrid-fresh");
    try {
      seedParaphrasePair(fresh);
      const again = await run(fresh, { q: "revenue growth" }, retrievalOver(fresh));
      expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    } finally {
      fresh.close();
    }
  });

  it("keeps the lexical hit's own snippet for a document both halves found", async () => {
    seedParaphrasePair(ws);
    const lexicalOnly = await run(ws, { q: "revenue growth" });
    const fused = await run(ws, { q: "revenue growth" }, retrievalOver(ws));

    const before = lexicalOnly.hits.find((hit) => hit.id === "doc_revenue");
    const after = fused.hits.find((hit) => hit.id === "doc_revenue");
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("caps the answer at the caller's limit however deep it over-fetched", async () => {
    seedParaphrasePair(ws);
    const capped = await run(ws, { q: "revenue growth", limit: "2" }, retrievalOver(ws));
    expect(capped.hits).toHaveLength(2);
    expect(new Set(ids(capped.hits)).size).toBe(2);
  });
});

describe("filters apply to the semantic half", () => {
  // TEST-893: a semantically perfect match that fails a filter must not appear.
  // A semantic path that bypassed the archived default would leak archived
  // documents into every search.
  beforeEach(() => {
    ws.doc({
      id: "doc_arch",
      title: "Archived ledger",
      status: "archived",
      body: "Archived ledger body.",
    });
    ws.doc({
      id: "doc_view",
      type: "view",
      title: "Ledger view",
      path: "data/docs/views/ledger.md",
      body: "Ledger saved view.",
    });
    ws.doc({
      id: "doc_filed",
      title: "Filed ledger",
      path: "data/docs/finance/filed.md",
      body: "Filed ledger body.",
    });
    ws.doc({ id: "doc_seed", title: "Seed", body: "Unrelated seed text." });
    ws.reproject();
    // Every document is a perfect semantic match, so only a filter can exclude one.
    embedChunks(ws.db, IDENTITY, () => [1, 0]);
  });

  it("excludes an archived document by default and includes it with the flag", async () => {
    const semantic = retrievalOver(ws, () => [1, 0]);
    expect(ids((await run(ws, { q: "seed" }, semantic)).hits)).not.toContain("doc_arch");
    expect(ids((await run(ws, { q: "seed", includeArchived: "true" }, semantic)).hits)).toContain(
      "doc_arch",
    );
  });

  it("honours `type`", async () => {
    const hits = ids(
      (
        await run(
          ws,
          { q: "seed", type: "view" },
          retrievalOver(ws, () => [1, 0]),
        )
      ).hits,
    );
    expect(hits).toEqual(["doc_view"]);
  });

  it("honours `folder`", async () => {
    const hits = ids(
      (
        await run(
          ws,
          { q: "seed", folder: "finance" },
          retrievalOver(ws, () => [1, 0]),
        )
      ).hits,
    );
    expect(hits).toEqual(["doc_filed"]);
  });
});

describe("the state word", () => {
  it("says `current`, `stale`, `indexing` and `disabled` from the same facts", async () => {
    seedParaphrasePair(ws);
    const semantic = retrievalOver(ws);
    expect((await run(ws, { q: "revenue growth" }, semantic)).semanticIndex).toBe("current");

    // A new document, not yet embedded: an incremental backlog.
    ws.doc({ id: "doc_new", title: "New note", body: "Freshly written body." });
    ws.reproject();
    expect((await run(ws, { q: "revenue growth" }, semantic)).semanticIndex).toBe("stale");

    semantic.rebuild.begin();
    expect((await run(ws, { q: "revenue growth" }, semantic)).semanticIndex).toBe("indexing");
    semantic.rebuild.end();

    // And with no service at all — a server with no semantic index wired.
    expect((await run(ws, { q: "revenue growth" })).semanticIndex).toBe("disabled");
  });

  it("degrades this request to lexical when the query embedding fails", async () => {
    // TEST-888: 200, full lexical results, and a state that says the ranking is
    // degraded — never a 500, never an empty list, never a silent `current`.
    seedParaphrasePair(ws);
    const failing = retrievalOver(ws, () => {
      throw new Error("embedding service is down");
    });

    const results = await run(ws, { q: "revenue growth" }, failing);
    expect(results.semanticIndex).toBe("disabled");
    expect(ids(results.hits)).toEqual(["doc_revenue"]);
  });

  it("keeps foreign-identity vectors out of the ranking entirely", async () => {
    // TEST-889: vectors recorded at identity X, provider resolved at identity Y.
    seedParaphrasePair(ws);
    ws.db.prepare("UPDATE chunk_embeddings SET identity = 'stub/elsewhere@2'").run();

    const results = await run(ws, { q: "revenue growth" }, retrievalOver(ws));
    expect(results.semanticIndex).toBe("disabled");
    expect(ids(results.hits)).toEqual(["doc_revenue"]);
  });
});

describe("queries with nothing to rank", () => {
  it("answers an empty ranking for an unsearchable query, index or not", async () => {
    // A string with no indexable token is not a question the index can answer,
    // so neither half runs — but the state word is still owed.
    seedParaphrasePair(ws);
    const results = await run(ws, { q: "***" }, retrievalOver(ws));
    expect(results.hits).toEqual([]);
    expect(results.semanticIndex).toBe("current");
  });

  it("answers only what is genuinely near for a term the corpus does not contain", async () => {
    // Cosine is defined for every pair, so without `SEMANTIC_MIN_SIMILARITY` a
    // query for a term nobody wrote would return the whole index. The gate is
    // what keeps a ranked list from padding itself: the query embeds to
    // `doc_kitchen`'s direction (cosine 1), `doc_sales` sits 0.199 off it and
    // survives, and `doc_revenue` at cosine 0 is absent rather than last.
    seedParaphrasePair(ws);
    const lexical = await run(ws, { q: "zzzznothingmatchesthis" });
    expect(lexical.hits).toEqual([]);

    const hybrid = await run(ws, { q: "zzzznothingmatchesthis" }, retrievalOver(ws));
    expect(ids(hybrid.hits)).toEqual(["doc_kitchen", "doc_sales"]);
    expect(ids(hybrid.hits)).not.toContain("doc_revenue");
  });
});
