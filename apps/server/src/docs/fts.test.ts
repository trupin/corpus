import { DocsQuerySchema, type DocList } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import {
  MAX_QUERY_TOKENS,
  parseSnippets,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  toFtsMatchExpression,
  toIndexableText,
  toSegments,
} from "./fts.js";
import { queryDocs } from "./query.js";

const NOW = Date.parse("2026-07-26T12:00:00Z");

describe("toFtsMatchExpression", () => {
  it.each([
    ["escrow", '"escrow"*'],
    ["cherry-picked assumption", '"cherry" AND "picked" AND "assumption"*'],
    ['"unbalanced', '"unbalanced"*'],
    ["NEAR(a b)", '"NEAR" AND "a" AND "b"*'],
    ["a OR b", '"a" AND "OR" AND "b"*'],
    ["café", '"café"*'],
  ])("re-emits %j as quoted literals", (query, expected) => {
    expect(toFtsMatchExpression(query)).toBe(expected);
  });

  it.each(["*", ")))", '""', "   ", "%%"])("has nothing to search for in %j", (query) => {
    expect(toFtsMatchExpression(query)).toBeNull();
  });

  it("caps the token count so a pasted page is still one query", () => {
    const expression = toFtsMatchExpression(
      Array.from({ length: 200 }, (_, index) => `w${String(index)}`).join(" "),
    );
    expect(expression?.split(" AND ")).toHaveLength(MAX_QUERY_TOKENS);
  });
});

describe("toSegments", () => {
  it("splits an excerpt into alternating runs", () => {
    expect(toSegments(`the ${SNIPPET_OPEN}rate${SNIPPET_CLOSE} moved`)).toEqual([
      { text: "the ", match: false },
      { text: "rate", match: true },
      { text: " moved", match: false },
    ]);
  });

  it("reports no segments for a column that did not match", () => {
    expect(toSegments("nothing highlighted here")).toBeNull();
  });

  it("tolerates a truncated highlight", () => {
    expect(toSegments(`head ${SNIPPET_OPEN}tail`)).toEqual([
      { text: "head ", match: false },
      { text: "tail", match: true },
    ]);
  });
});

describe("parseSnippets", () => {
  it.each([null, "", "not json", '{"not":"an array"}', "[1, 2]"])(
    "yields nothing for %j rather than failing the row",
    (json) => {
      expect(parseSnippets(json)).toEqual([]);
    },
  );

  it("skips a turn hit whose excerpt carries no highlight", () => {
    const json = JSON.stringify([
      { kind: "turn", ref: "th_abc#2026-07-01T00:00:00Z", title: "", body: "no highlight" },
    ]);
    expect(parseSnippets(json)).toEqual([]);
  });

  it("reads a turn ref with no timestamp as the thread itself", () => {
    const json = JSON.stringify([
      { kind: "turn", ref: "th_abc", title: "", body: `${SNIPPET_OPEN}hit${SNIPPET_CLOSE}` },
    ]);
    expect(parseSnippets(json)[0]?.threadId).toBe("th_abc");
  });

  it("names the thread a turn snippet came from", () => {
    const json = JSON.stringify([
      {
        kind: "turn",
        ref: "th_abc#2026-07-01T00:00:00Z",
        title: "",
        body: `a ${SNIPPET_OPEN}hit${SNIPPET_CLOSE}`,
      },
    ]);
    expect(parseSnippets(json)).toEqual([
      {
        field: "turn",
        threadId: "th_abc",
        segments: [
          { text: "a ", match: false },
          { text: "hit", match: true },
        ],
      },
    ]);
  });
});

describe("toIndexableText", () => {
  it("removes the delimiters and nothing else", () => {
    expect(toIndexableText(`a${SNIPPET_OPEN}b${SNIPPET_CLOSE}c`)).toBe("abc");
    expect(toIndexableText(`${SNIPPET_OPEN}${SNIPPET_OPEN}x`)).toBe("x");
    // Every other control byte is a separator to the tokenizer and forges
    // nothing, so it is left where the document put it.
    expect(toIndexableText("ab\tc\nd")).toBe("ab\tc\nd");
  });

  it("returns the same string when there is nothing to strip", () => {
    const text = "ordinary markdown — with an em dash and an emoji 🙂";
    expect(toIndexableText(text)).toBe(text);
  });
});

describe("full-text search over the projection", () => {
  let ws: Workspace;
  const search = (params: Record<string, string>): DocList =>
    queryDocs(ws.db, DocsQuerySchema.parse(params), NOW);

  beforeAll(() => {
    ws = createWorkspace("fts");
    ws.doc({ id: "doc_escrow", title: "Escrow basics", body: "Payments and taxes." });
    ws.doc({
      id: "doc_amort",
      title: "Q1 numbers",
      body: "The amortization schedule is attached and runs for thirty years in total.",
    });
    ws.doc({ id: "doc_quiet", title: "Unrelated", body: "Nothing to find here." });
    // A body carrying the snippet delimiters verbatim (SERVER-022 finding 11).
    // Its searchable terms are unique to it, so the rest of this suite's
    // assertions about which rows a query returns are untouched.
    ws.doc({
      id: "doc_forger",
      title: `A ${SNIPPET_OPEN}forged title${SNIPPET_CLOSE}`,
      body: `The ${SNIPPET_OPEN}forgery${SNIPPET_CLOSE} sits beside a mention of ledgerbalance.`,
    });
    ws.thread({
      id: "th_forger",
      title: "Pasted",
      body: "Preamble.",
      turns: [
        {
          author: "user",
          ts: "2026-07-03T00:00:00Z",
          body: `I pasted ${SNIPPET_OPEN}quotedspan${SNIPPET_CLOSE} beside reconciliationnote.`,
        },
      ],
    });
    ws.thread({
      id: "th_talk",
      title: "Discussion",
      parent: "doc_escrow",
      body: "Preamble about escrow.",
      turns: [
        { author: "user", ts: "2026-07-01T00:00:00Z", body: "That is a cherry-picked assumption." },
        { author: "agent", ts: "2026-07-02T00:00:00Z", body: "Agreed, it is arbitrary." },
      ],
    });
    ws.reproject();
  });

  afterAll(() => {
    ws.close();
  });

  it("matches a title", () => {
    const found = search({ q: "escrow" });
    expect(found.items.map((item) => item.id).sort()).toEqual(["doc_escrow", "th_talk"]);
    const escrow = found.items.find((item) => item.id === "doc_escrow");
    expect(escrow?.snippets.map((snippet) => snippet.field)).toEqual(["title"]);
  });

  it("matches a body, and the snippet carries the term inside a matched segment", () => {
    const [row, ...rest] = search({ q: "amortization" }).items;
    expect(rest).toEqual([]);
    expect(row?.id).toBe("doc_amort");
    const snippet = row?.snippets.find((entry) => entry.field === "body");
    expect(snippet).toBeDefined();
    expect(
      snippet?.segments.some((segment) => segment.match && segment.text.includes("amortization")),
    ).toBe(true);
    expect(snippet?.segments.map((segment) => segment.text).join("")).toContain("schedule");
    // Structured segments, never markup (contract `Snippet`).
    expect(JSON.stringify(row)).not.toContain("<mark>");
  });

  it("attributes a turn hit to the thread, once, with its thread id", () => {
    const found = search({ q: "cherry-picked assumption" });
    expect(found.items.map((item) => item.id)).toEqual(["th_talk"]);
    expect(found.page.total).toBe(1);
    const snippet = found.items[0]?.snippets.find((entry) => entry.field === "turn");
    expect(snippet?.threadId).toBe("th_talk");
    expect(snippet?.segments.some((segment) => segment.match)).toBe(true);
  });

  it("orders by rank under `sort=relevance`", () => {
    const found = search({ q: "escrow", sort: "relevance" });
    // The thread names escrow in both its title and its preamble.
    expect(found.items[0]?.id).toBe("th_talk");
  });

  it.each(['"unbalanced', "NEAR(a b)", "a OR b", "*", '""', ")))", "x".repeat(1024)])(
    "answers %j with a well-formed envelope instead of an error",
    (q) => {
      const found = search({ q });
      expect(found.page).toMatchObject({ limit: 50, offset: 0 });
      expect(found.items.length).toBe(found.page.total === 0 ? 0 : found.items.length);
    },
  );

  it("returns nothing — and no rows — for a query with no indexable token", () => {
    expect(search({ q: "*" })).toEqual({ items: [], page: { total: 0, limit: 50, offset: 0 } });
  });

  it("cannot be made to mark a span the query never matched", () => {
    // SERVER-022 finding 11: the delimiters are the FTS layer's own markup, and
    // `toSegments` reads whatever it finds. A body that carries them was
    // returned with that span `match: true` for a query that never touched it.
    const row = search({ q: "ledgerbalance" }).items.find((item) => item.id === "doc_forger");
    expect(row).toBeDefined();

    const snippets = row?.snippets ?? [];
    const marked = snippets
      .flatMap((snippet) => snippet.segments)
      .filter((segment) => segment.match)
      .map((segment) => segment.text);
    expect(marked).toEqual(["ledgerbalance"]);
    // No delimiter survives into a snippet, marked or not: `snippet()` only ever
    // sees the ones it inserted. (The row's own `excerpt` still reproduces the
    // document's bytes faithfully — the file is the source of truth, and this
    // finding is about the *highlighting*, not about editing anyone's text.)
    expect(JSON.stringify(snippets)).not.toContain("\\u0002");
    expect(JSON.stringify(snippets)).not.toContain("\\u0003");
    // …and the enclosed word is still findable — the strip removes the two
    // characters, not the text between them.
    expect(search({ q: "forgery" }).items.map((item) => item.id)).toEqual(["doc_forger"]);
  });

  it("cannot be made to mark a span from a pasted turn either", () => {
    const row = search({ q: "reconciliationnote" }).items.find((item) => item.id === "th_forger");
    expect(row).toBeDefined();
    const marked = (row?.snippets ?? [])
      .flatMap((snippet) => snippet.segments)
      .filter((segment) => segment.match)
      .map((segment) => segment.text);
    expect(marked).toEqual(["reconciliationnote"]);
    expect(marked).not.toContain("quotedspan");
  });

  it("composes search with the structured filters", () => {
    expect(search({ q: "escrow", type: "thread" }).items.map((item) => item.id)).toEqual([
      "th_talk",
    ]);
  });
});
