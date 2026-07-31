import {
  DocsQuerySchema,
  HEADING_PATH_SEPARATOR,
  RETRIEVAL_DEFAULT_LIMIT,
  RETRIEVAL_MAX_LIMIT,
  SearchQuerySchema,
  SearchResultsSchema,
  type SearchHit,
} from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ONE_LINE_MAX_CHARS } from "../core/one-line.js";
import { createWorkspace, type Workspace } from "../docs/corpus-fixture.js";
import { SNIPPET_CLOSE, SNIPPET_OPEN, queryDocs } from "../docs/index.js";
import { loadChunkAddresses, type ChunkAddressLoader } from "../semantic/index.js";
import { searchCorpus } from "./search.js";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string =>
  new Date(NOW - days * MS_PER_DAY).toISOString().replace(/\.\d{3}Z$/, "Z");
const daysAhead = (days: number): string =>
  new Date(NOW + days * MS_PER_DAY).toISOString().slice(0, 10);

/** Both endpoints parse the *same* query string, which is the point of the parity table. */
const search = (
  ws: Workspace,
  params: Readonly<Record<string, string>>,
  loader?: ChunkAddressLoader,
): SearchHit[] =>
  searchCorpus(
    ws.db,
    SearchQuerySchema.parse({ limit: String(RETRIEVAL_MAX_LIMIT), ...params }),
    NOW,
    loader,
  ).hits;

const listIds = (ws: Workspace, params: Readonly<Record<string, string>>): string[] =>
  queryDocs(ws.db, DocsQuerySchema.parse({ limit: "200", ...params }), NOW).items.map(
    (row) => row.id,
  );

const ids = (hits: readonly SearchHit[]): string[] => hits.map((hit) => hit.id);

// ---------------------------------------------------------------------------
// A corpus every filter can be exercised against: `escrow` appears in every
// document, so `q=escrow` is the constant and the filter is the variable.
// ---------------------------------------------------------------------------

const SECTIONED_BODY = `Escrow overview paragraph.

# Mortgage

Escrow intro under the top-level heading.

## Rates

Escrow rates discussion.

### Fixed

The escrow reserve is recalculated annually under fixed terms.

## Fees

Escrow fees are billed quarterly.
`;

const FENCED_BODY = `\`\`\`md
# Fake heading
## Also fake
\`\`\`

## Rates

The escrow ladder is documented here.
`;

let ws: Workspace;

beforeAll(() => {
  ws = createWorkspace("search");
  ws.doc({
    id: "doc_sectioned",
    path: "data/docs/finance/sectioned.md",
    title: "Sectioned escrow guide",
    tags: ["finance"],
    body: SECTIONED_BODY,
    updated: daysAgo(1),
    due: daysAhead(1),
  });
  ws.doc({
    id: "doc_flat",
    path: "data/docs/finance/flat.md",
    title: "Flat note",
    tags: ["finance"],
    body: "Escrow with no heading above it at all.",
    updated: daysAgo(2),
  });
  ws.doc({
    id: "doc_fenced",
    path: "data/docs/finance/fenced.md",
    title: "Fenced note",
    body: FENCED_BODY,
    updated: daysAgo(3),
  });
  ws.doc({
    id: "doc_view",
    path: "data/docs/views/escrow-view.md",
    type: "view",
    title: "Escrow view",
    body: "Escrow saved view.",
    updated: daysAgo(4),
    frontmatter: { pinned: true, order: 1 },
  });
  ws.doc({
    id: "doc_archived",
    path: "data/docs/finance/archived.md",
    title: "Archived escrow note",
    status: "archived",
    body: "Escrow, archived.",
    updated: daysAgo(5),
  });
  ws.doc({
    id: "doc_stale",
    path: "data/docs/finance/stale.md",
    title: "Stale escrow note",
    body: "Escrow, long untouched.",
    updated: daysAgo(400),
  });
  ws.doc({
    id: "doc_ref",
    path: "data/docs/inbox/ref.md",
    title: "Referencing note",
    body: "Escrow, see [[doc_sectioned]].",
    updated: daysAgo(6),
  });
  ws.thread({
    id: "th_anchored",
    title: "Escrow thread",
    parent: "doc_sectioned",
    agent: "engaged",
    body: "Escrow preamble before the first turn.",
    turns: [
      { author: "user", ts: daysAgo(9), body: "What does escrow cover in year one?" },
      { author: "agent", ts: daysAgo(8), body: "Escrow covers taxes and insurance." },
      { author: "agent", ts: daysAgo(7), body: "Escrow is recomputed each year." },
    ],
    updated: daysAgo(7),
  });
  ws.thread({
    id: "th_standalone",
    title: "Standalone escrow thread",
    agent: "requested",
    turns: [{ author: "user", ts: daysAgo(10), body: "Escrow question with no parent." }],
    updated: daysAgo(10),
  });
  ws.seen({ th_anchored: daysAgo(7) });
  ws.reproject();
});

afterAll(() => {
  ws.close();
});

describe("ranking", () => {
  it("ranks through the shipped bm25 path — same order as sort=relevance", () => {
    // Not "an equivalent ordering": the two statements share `FTS_HITS_CTE`,
    // `MIN(rank)` and `RELEVANCE_ORDER_BY`, so the ranked id sequences are
    // identical for the same query. A second bm25 implementation would show up
    // here as a permutation.
    const hits = search(ws, { q: "escrow rates" });
    const rows = listIds(ws, { q: "escrow rates", sort: "relevance" });
    expect(ids(hits)).toEqual(rows);
    expect(hits.length).toBeGreaterThan(1);
  });

  it("returns one hit per document however many of its rows matched", () => {
    // `th_anchored` matches in its title, its preamble and all three turns.
    const hits = search(ws, { q: "escrow" });
    expect(ids(hits).filter((id) => id === "th_anchored")).toHaveLength(1);
    expect(new Set(ids(hits)).size).toBe(hits.length);
  });

  it("orders deterministically, ending in id — the same query twice agrees", () => {
    expect(ids(search(ws, { q: "escrow" }))).toEqual(ids(search(ws, { q: "escrow" })));
  });

  it("caps at the requested limit", () => {
    expect(search(ws, { q: "escrow", limit: "2" })).toHaveLength(2);
  });

  it("defaults the cap to the contract's frugal ten", () => {
    expect(SearchQuerySchema.parse({ q: "escrow" }).limit).toBe(RETRIEVAL_DEFAULT_LIMIT);
  });
});

describe("filter parity with GET /api/docs", () => {
  // TEST-674: "a filter added later cannot diverge" is only true if there is one
  // predicate builder, and only *provable* if every filter is compared. Each row
  // is one query string, run through both endpoints' schemas, compared as id
  // sets. `q=escrow` is constant so the filter is the only variable.
  const cases: readonly (readonly [string, Record<string, string>])[] = [
    ["type", { type: "note" }],
    ["type (multi)", { type: "note,view" }],
    ["status", { status: "archived" }],
    ["includeArchived", { includeArchived: "true" }],
    ["includeArchived beside status", { status: "open", includeArchived: "true" }],
    ["tag", { tag: "finance" }],
    ["folder", { folder: "finance" }],
    ["parent", { parent: "doc_sectioned" }],
    ["references", { references: "doc_sectioned" }],
    ["agent", { agent: "engaged" }],
    ["author", { author: "user" }],
    ["since", { since: daysAgo(3) }],
    ["due", { due: "week" }],
    ["stale", { stale: "very-stale" }],
    ["unread", { unread: "true" }],
    ["needs", { needs: "me" }],
    ["needs (one reason)", { needs: "stale" }],
    ["two filters", { type: "note", tag: "finance" }],
  ];

  it.each(cases)("%s selects the same documents on both endpoints", (_name, filter) => {
    const params = { q: "escrow", ...filter };
    const hits = [...ids(search(ws, params))].sort();
    const rows = [...listIds(ws, params)].sort();
    expect(hits).toEqual(rows);
  });

  it("excludes archived by default, exactly as the list does", () => {
    const hits = ids(search(ws, { q: "escrow" }));
    expect(hits).not.toContain("doc_archived");
    expect(hits).toEqual(expect.arrayContaining(["doc_sectioned"]));
    expect(ids(search(ws, { q: "escrow", includeArchived: "true" }))).toContain("doc_archived");
    expect(ids(search(ws, { q: "escrow", status: "archived" }))).toEqual(["doc_archived"]);
  });
});

describe("heading paths", () => {
  const pathOf = (params: Record<string, string>, id: string): string => {
    const hit = search(ws, params).find((candidate) => candidate.id === id);
    expect(hit, `no hit for ${id}`).toBeDefined();
    return hit?.headingPath ?? "";
  };

  it("names every enclosing heading of a nested section", () => {
    expect(pathOf({ q: "recalculated annually" }, "doc_sectioned")).toBe(
      ["Mortgage", "Rates", "Fixed"].join(HEADING_PATH_SEPARATOR),
    );
  });

  it("names the section a shallower match sits in", () => {
    expect(pathOf({ q: "billed quarterly" }, "doc_sectioned")).toBe(
      ["Mortgage", "Fees"].join(HEADING_PATH_SEPARATOR),
    );
  });

  it("falls back to the document title when no heading is above the match", () => {
    expect(pathOf({ q: "no heading above" }, "doc_flat")).toBe("Flat note");
  });

  it("reports the title for a match in the title itself", () => {
    expect(pathOf({ q: "Referencing" }, "doc_ref")).toBe("Referencing note");
  });

  it("does not read a heading inside fenced code as a heading", () => {
    expect(pathOf({ q: "escrow ladder" }, "doc_fenced")).toBe("Rates");
  });

  it("addresses a turn hit by its own heading, without reading any text", () => {
    // The loader throws: a turn hit that needed a chunk lookup would fail here
    // rather than pass quietly.
    const forbidden: ChunkAddressLoader = (_db, refs) => {
      if (refs.length > 0) throw new Error(`turn hit read ${String(refs.length)} address(es)`);
      return new Map();
    };
    const hits = searchCorpus(
      ws.db,
      SearchQuerySchema.parse({ q: "taxes and insurance" }),
      NOW,
      forbidden,
    );
    const hit = hits.hits.find((candidate) => candidate.id === "th_anchored");
    expect(hit?.headingPath).toBe(`agent · ${daysAgo(8)}`);
  });

  it("falls back to the document title when the projection has drifted", () => {
    // Defensive, not decorative: the projection is derived state, and a turn row
    // that lost its `turns` entry must still answer with an address rather than
    // a blank one. Exercised on a private workspace so the shared fixture keeps
    // its rows.
    const drifted = createWorkspace("search-drift");
    try {
      drifted.thread({
        id: "th_drift",
        title: "Drifted thread",
        turns: [{ author: "user", ts: "2026-07-01T00:00:00Z", body: "Escrow drifted turn." }],
      });
      drifted.reproject();
      drifted.db.prepare("DELETE FROM turns WHERE thread_id = 'th_drift'").run();
      // …and a turn row whose `ref` carries no timestamp at all.
      drifted.db
        .prepare("INSERT INTO search (ref, kind, doc_id, title, body) VALUES (?,?,?,?,?)")
        .run("th_drift", "turn", "th_drift", "", "Escrow refless turn.");

      const hits = searchCorpus(drifted.db, SearchQuerySchema.parse({ q: "drifted" }), NOW).hits;
      expect(hits.map((hit) => hit.headingPath)).toEqual(["Drifted thread"]);
      const refless = searchCorpus(drifted.db, SearchQuerySchema.parse({ q: "refless" }), NOW).hits;
      expect(refless.map((hit) => hit.headingPath)).toEqual(["Drifted thread"]);
    } finally {
      drifted.close();
    }
  });

  it("addresses a thread preamble hit by the thread's title", () => {
    // The third case: a thread's own `search` row indexes only its preamble, so
    // this hit is neither a turn nor a sectioned document body. The scan is
    // bounded to the preamble and finds no heading, so the address is the
    // thread's title — and it can never quote a turn's text.
    expect(pathOf({ q: "preamble before" }, "th_anchored")).toBe("Escrow thread");
  });

  // The PR #15 finding, closed. Phase A derived the address by locating
  // `snippet()`'s window in the indexed text with `indexOf` and scanning the
  // headings above it — so a document that repeats itself was always addressed
  // by the *first* copy, whichever passage the ranking was about. Addressing
  // the chunk that matched makes the class impossible. Run on a private
  // workspace so the shared corpus, and therefore every byte-stability
  // assertion above it, is untouched.
  it("addresses a repeated passage by the section that actually matched", () => {
    const repeated = createWorkspace("search-repeat");
    try {
      const boilerplate = "The thermocline reading is recorded once per shift.";
      // Alpha carries the boilerplate buried in a long section; Omega carries
      // it alone. The text is byte-identical, but Omega is genuinely the better
      // passage — it is what that section is about, and bm25 says so.
      const body =
        `## Alpha\n\n${"Unrelated survey narrative filler. ".repeat(40)}\n\n${boilerplate}\n\n` +
        `${"More unrelated survey narrative. ".repeat(40)}\n\n## Omega\n\n${boilerplate}\n`;
      repeated.doc({ id: "doc_repeat", path: "data/docs/repeat.md", title: "Survey log", body });
      repeated.reproject();

      // The naive answer really is `Alpha`: the first occurrence of the
      // boilerplate in the indexed text falls inside Alpha's chunk, which is
      // all `indexOf` could ever have found.
      const indexed = (
        repeated.db.prepare("SELECT body FROM search WHERE ref = 'doc_repeat'").get() as {
          body: string;
        }
      ).body;
      const first = indexed.indexOf(boilerplate);
      const alpha = repeated.db
        .prepare("SELECT start_offset, end_offset FROM chunks WHERE heading_path = 'Alpha'")
        .get() as { start_offset: number; end_offset: number };
      expect(first).toBeGreaterThanOrEqual(alpha.start_offset);
      expect(first).toBeLessThan(alpha.end_offset);
      expect(indexed.lastIndexOf(boilerplate)).toBeGreaterThan(first);

      const hits = searchCorpus(
        repeated.db,
        SearchQuerySchema.parse({ q: "thermocline reading" }),
        NOW,
      ).hits;
      expect(hits.map((hit) => hit.id)).toEqual(["doc_repeat"]);
      expect(hits[0]?.headingPath).toBe("Omega");
    } finally {
      repeated.close();
    }
  });
});

describe("frugality", () => {
  it("derives addresses for the top-k only, whatever the corpus size", () => {
    const big = createWorkspace("search-topk");
    try {
      for (let index = 0; index < 60; index += 1) {
        const suffix = String(index).padStart(3, "0");
        big.doc({
          id: `doc_bulk${suffix}`,
          path: `data/docs/bulk/${suffix}.md`,
          title: `Bulk note ${suffix}`,
          body: `## Section ${suffix}\n\nThe escrow ledger entry ${suffix}.\n`,
        });
      }
      big.reproject();

      const readRefs: string[] = [];
      const counting: ChunkAddressLoader = (db, refs, match) => {
        readRefs.push(...refs);
        return loadChunkAddresses(db, refs, match);
      };
      const matched = queryDocs(big.db, DocsQuerySchema.parse({ q: "escrow", limit: "200" }), NOW)
        .page.total;
      const hits = searchCorpus(
        big.db,
        SearchQuerySchema.parse({ q: "escrow", limit: "5" }),
        NOW,
        counting,
      ).hits;

      expect(matched).toBe(60);
      expect(hits).toHaveLength(5);
      // Five addresses looked up for five hits, out of sixty that matched.
      expect(readRefs).toHaveLength(5);
      expect(new Set(readRefs).size).toBe(5);
      expect(hits[0]?.headingPath).toMatch(/^Section \d{3}$/);
    } finally {
      big.close();
    }
  });

  it("never returns a body, and stays small doing it", () => {
    const big = createWorkspace("search-large");
    try {
      const paragraph = `${"Escrow accounting detail. ".repeat(40)}\n\n`;
      big.doc({
        id: "doc_huge",
        path: "data/docs/huge.md",
        title: "Huge escrow document",
        body: `# Huge\n\n${paragraph.repeat(50)}## Tail\n\nThe escrow tail paragraph.\n`,
      });
      for (let index = 0; index < 12; index += 1) {
        big.doc({
          id: `doc_extra${String(index)}`,
          path: `data/docs/extra/${String(index)}.md`,
          body: "Escrow, briefly.",
        });
      }
      big.reproject();

      const bodyLength = (
        big.db.prepare("SELECT body FROM search WHERE ref = 'doc_huge'").get() as { body: string }
      ).body.length;
      const results = searchCorpus(big.db, SearchQuerySchema.parse({ q: "escrow" }), NOW);
      const serialized = JSON.stringify(results);

      expect(bodyLength).toBeGreaterThan(50_000);
      expect(SearchResultsSchema.parse(results)).toEqual(results);
      // No field carries a body, an excerpt-of-the-body, or a segment array.
      // The whole ten-hit response — every hit's four fields, JSON punctuation
      // included — is under two kilobytes against a single 50 KB document, and
      // its size is set by `limit`, not by what the documents contain.
      expect(serialized.length).toBeLessThan(2_000);
      expect(serialized.length).toBeLessThan(bodyLength / 25);
      for (const hit of results.hits) {
        expect(Object.keys(hit).sort()).toEqual(["headingPath", "id", "snippet", "title"]);
        expect(hit.snippet.length).toBeLessThanOrEqual(ONE_LINE_MAX_CHARS + 1);
      }
    } finally {
      big.close();
    }
  });
});

describe("snippets", () => {
  it("is one plain line, carrying neither FTS delimiter nor a newline", () => {
    for (const hit of search(ws, { q: "escrow" })) {
      expect(hit.snippet).not.toContain("\n");
      expect(hit.snippet).not.toContain("\r");
      for (const character of hit.snippet) {
        const code = character.codePointAt(0) ?? 0;
        expect(code).not.toBe(SNIPPET_OPEN.codePointAt(0));
        expect(code).not.toBe(SNIPPET_CLOSE.codePointAt(0));
      }
    }
  });

  it("collapses a match that spans lines into one line", () => {
    const hit = search(ws, { q: "recalculated annually" }).find(
      (candidate) => candidate.id === "doc_sectioned",
    );
    expect(hit?.snippet).toContain("recalculated annually");
    expect(hit?.snippet).not.toContain("\n");
  });

  it("falls back to the title's window when only the title matched", () => {
    const hit = search(ws, { q: "Referencing" }).find((candidate) => candidate.id === "doc_ref");
    expect(hit?.snippet).toContain("Referencing");
  });
});

describe("query handling", () => {
  it("answers an empty ranking for a query that tokenizes to nothing", () => {
    expect(search(ws, { q: "***" })).toEqual([]);
  });

  it("refuses a missing or empty q at the schema", () => {
    expect(SearchQuerySchema.safeParse({}).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: "" }).success).toBe(false);
  });

  it("makes no claim about the semantic index in Phase A", () => {
    const results = searchCorpus(ws.db, SearchQuerySchema.parse({ q: "escrow" }), NOW);
    expect(results.semanticIndex).toBeUndefined();
    expect("semanticIndex" in results).toBe(false);
  });

  it("answers an empty ranking rather than failing when nothing matches", () => {
    expect(search(ws, { q: "zzzznothingmatchesthis" })).toEqual([]);
  });
});

describe("loadChunkAddresses", () => {
  it("reads nothing for no refs", () => {
    expect(loadChunkAddresses(ws.db, [], "escrow").size).toBe(0);
  });

  it("answers the best-matching chunk's heading path, keyed by ref", () => {
    const both = loadChunkAddresses(ws.db, ["doc_flat", "doc_sectioned"], "escrow");
    // The floor: a chunk with no heading above it records the document's title.
    expect(both.get("doc_flat")).toBe("Flat note");
    expect(both.get("doc_sectioned")).toBeDefined();
    // And the address follows the query into the section that answers it.
    expect(loadChunkAddresses(ws.db, ["doc_sectioned"], "quarterly").get("doc_sectioned")).toBe(
      ["Mortgage", "Fees"].join(HEADING_PATH_SEPARATOR),
    );
  });

  it("answers nothing for a ref whose chunks do not match", () => {
    expect(loadChunkAddresses(ws.db, ["doc_flat"], "zzzznothingmatchesthis").size).toBe(0);
  });
});
