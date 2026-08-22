// The collection query's CONTRACT-011 surface: the `pinned` filter, the `order`
// sort and its tiebreak, the view keys and `extra` on every row, and the
// `parentTitle` live join (SPEC.md §10, §12).
//
// Seeded from real files through the real projector, like every other query
// suite — and the board's own case is seeded from the **shipped** seed views in
// `assets/workspace/`, so a change to what `corpus init` writes fails here
// rather than in a user's first board.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DocListSchema, DocsQuerySchema, type DocList, type DocsQuery } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { queryDocs } from "./query.js";

const NOW = Date.parse("2026-07-27T12:00:00Z");

/** Where `corpus init` copies the board's seed columns from. */
const SEED_VIEWS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "assets/workspace/data/docs/views",
);

let ws: Workspace;

function run(params: Record<string, string> = {}): DocList {
  const query: DocsQuery = DocsQuerySchema.parse(params);
  const list = queryDocs(ws.db, query, NOW);
  // Every case here also asserts the response still satisfies the contract.
  expect(DocListSchema.parse(list)).toEqual(list);
  return list;
}

const titles = (list: DocList): string[] => list.items.map((item) => item.title);

beforeAll(() => {
  ws = createWorkspace("view-query");

  // The board's real column set: the three seed views, byte-for-byte.
  for (const name of readdirSync(SEED_VIEWS_DIR).sort()) {
    ws.write(`data/docs/views/${name}`, readFileSync(join(SEED_VIEWS_DIR, name), "utf8"));
  }

  // A fourth pinned view sharing `order: 2` with the Inbox seed, and a fifth
  // with no `order` key at all — the tiebreak's two cases.
  ws.doc({
    id: "doc_tiedview",
    path: "data/docs/views/aaa-tied.md",
    type: "view",
    title: "Aaa tied",
    frontmatter: { pinned: true, order: 2, query: { folder: "finance" } },
  });
  ws.doc({
    id: "doc_unordered",
    path: "data/docs/views/unordered.md",
    type: "view",
    title: "Unordered",
    frontmatter: { pinned: true, query: { tag: "finance" } },
  });
  // A pinned view naming a custom `column`, and an unpinned view that must stay
  // out of the set.
  ws.doc({
    id: "doc_columnview",
    path: "data/docs/views/board.md",
    type: "view",
    title: "Errands board",
    frontmatter: { pinned: true, order: 9, column: "board/kanban", query: { type: "todo" } },
  });
  ws.doc({
    id: "doc_draftview",
    path: "data/docs/views/draft.md",
    type: "view",
    title: "Draft",
    frontmatter: { query: { folder: "inbox" } },
  });

  // A document whose `type` this build has never heard of (§5's open string,
  // §12's M6), carrying `items` as a top-level YAML key beside the core ones.
  ws.doc({
    id: "doc_errandlist",
    path: "data/docs/inbox/errands.md",
    type: "todo",
    title: "Groceries",
    frontmatter: { items: [{ text: "Milk", done: false, ts: "2026-07-27T09:00:00Z" }] },
  });

  // `parentTitle`: a parented thread, a standalone one, and one whose parent id
  // no document claims.
  ws.doc({ id: "doc_parent", path: "data/docs/finance/mortgage.md", title: "Escrow basics" });
  ws.thread({ id: "th_parented", title: "Re: escrow", parent: "doc_parent" });
  ws.thread({ id: "th_standalone", title: "A question", parent: null });
  ws.thread({ id: "th_orphaned", title: "Re: gone", parent: "doc_deleted" });

  ws.reproject();
});

afterAll(() => {
  ws.close();
});

describe("the `pinned` filter", () => {
  it("selects exactly the pinned documents, and `false` selects the rest", () => {
    const pinned = run({ pinned: "true" });
    expect(pinned.items.every((item) => item.pinned)).toBe(true);
    expect(pinned.items.map((item) => item.id).sort()).toEqual([
      "doc_columnview",
      "doc_seedattention",
      "doc_seedinbox",
      "doc_seedopenthreads",
      "doc_tiedview",
      "doc_unordered",
    ]);

    const rest = run({ pinned: "false" });
    expect(rest.items.every((item) => !item.pinned)).toBe(true);
    expect(rest.items.map((item) => item.id)).toContain("doc_draftview");
    expect(rest.items.map((item) => item.id)).toContain("doc_errandlist");
  });

  it("is not thread-only: a thread with no `pinned` key is simply unpinned", () => {
    expect(run({ pinned: "true" }).items.map((item) => item.id)).not.toContain("th_parented");
    expect(run({ pinned: "false" }).items.map((item) => item.id)).toContain("th_parented");
  });

  it("counts the same rows it returns", () => {
    const list = run({ pinned: "true" });
    expect(list.page.total).toBe(list.items.length);
  });
});

describe("the board's one bounded query", () => {
  it("returns the shipped seed columns in order, with their stored queries", () => {
    const board = run({ pinned: "true", type: "view", sort: "order" });
    expect(titles(board)).toEqual([
      "Attention",
      "Aaa tied",
      "Inbox",
      "Open threads",
      "Errands board",
      "Unordered",
    ]);
    expect(
      board.items.map((item) => ({ id: item.id, order: item.order, query: item.query })),
    ).toEqual([
      { id: "doc_seedattention", order: 1, query: { needs: "me" } },
      { id: "doc_tiedview", order: 2, query: { folder: "finance" } },
      { id: "doc_seedinbox", order: 2, query: { folder: "inbox" } },
      { id: "doc_seedopenthreads", order: 3, query: { type: "thread", status: "open" } },
      { id: "doc_columnview", order: 9, query: { type: "todo" } },
      { id: "doc_unordered", order: null, query: { tag: "finance" } },
    ]);
    // No follow-up read is needed for anything the board renders.
    expect(board.items.map((item) => item.column)).toEqual([
      null,
      null,
      null,
      null,
      "board/kanban",
      null,
    ]);
  });

  it("orders identically on every run, ties and all", () => {
    const once = run({ pinned: "true", type: "view", sort: "order" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(titles(run({ pinned: "true", type: "view", sort: "order" }))).toEqual(titles(once));
    }
  });

  it("places a view with no `order` last rather than dropping it", () => {
    const board = run({ pinned: "true", type: "view", sort: "order" });
    expect(board.items.at(-1)?.id).toBe("doc_unordered");
    expect(board.items).toHaveLength(board.page.total);
  });
});

describe("the view keys and `extra` on a row", () => {
  it("carries a document's own extra frontmatter keys, flat", () => {
    const row = run({ type: "todo" }).items[0];
    expect(row?.id).toBe("doc_errandlist");
    expect(row?.extra).toEqual({
      items: [{ text: "Milk", done: false, ts: "2026-07-27T09:00:00Z" }],
    });
  });

  it("is `{}` and the documented defaults on a document with only core keys", () => {
    const row = run({ q: "escrow" }).items.find((item) => item.id === "doc_parent");
    expect(row).toMatchObject({ pinned: false, order: null, query: null, column: null, extra: {} });
  });
});

describe("parentTitle", () => {
  it("is the parent document's current title on a parented thread", () => {
    const row = run({ type: "thread" }).items.find((item) => item.id === "th_parented");
    expect(row?.parent).toBe("doc_parent");
    expect(row?.parentTitle).toBe("Escrow basics");
  });

  it("is null on a standalone thread, on a non-thread, and on a parent that no longer resolves", () => {
    const rows = new Map(run().items.map((item) => [item.id, item]));
    expect(rows.get("th_standalone")?.parentTitle).toBeNull();
    expect(rows.get("doc_parent")?.parentTitle).toBeNull();
    // A deleted parent: the thread keeps the id and renders as standalone
    // rather than showing a raw id (SPEC.md §9.2).
    expect(rows.get("th_orphaned")?.parent).toBe("doc_deleted");
    expect(rows.get("th_orphaned")?.parentTitle).toBeNull();
  });

  it("follows a rename, because it is read at query time and never stored", () => {
    ws.doc({ id: "doc_parent", path: "data/docs/finance/mortgage.md", title: "Escrow, explained" });
    ws.reproject();
    const row = run({ type: "thread" }).items.find((item) => item.id === "th_parented");
    expect(row?.parentTitle).toBe("Escrow, explained");
    ws.doc({ id: "doc_parent", path: "data/docs/finance/mortgage.md", title: "Escrow basics" });
    ws.reproject();
  });

  it("does not multiply rows or disagree with the count", () => {
    const list = run({ type: "thread" });
    expect(list.items).toHaveLength(3);
    expect(list.page.total).toBe(3);
  });
});
