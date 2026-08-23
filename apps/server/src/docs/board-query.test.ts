// The collection query's board surface: §5's `stage` filter, the `order` sort
// and its tiebreak, the view and board keys and `extra` on every row, and the
// `parentTitle` live join (SPEC.md §9.2, §10; CONTRACT-011, CONTRACT-074).
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
  ws = createWorkspace("board-query");

  // The board's real column set: the three seed views, byte-for-byte.
  for (const name of readdirSync(SEED_VIEWS_DIR).sort()) {
    ws.write(`data/docs/views/${name}`, readFileSync(join(SEED_VIEWS_DIR, name), "utf8"));
  }

  // Four boards: two sharing `order: 2`, one with no `order` key at all — the
  // tiebreak's two cases — and one carrying a kanban.
  ws.doc({
    id: "doc_boardone",
    path: "data/docs/boards/one.md",
    type: "board",
    title: "Attention",
    frontmatter: { order: 1, columns: ["doc_seedattention"], "default-open": true },
  });
  ws.doc({
    id: "doc_tiedboard",
    path: "data/docs/boards/aaa-tied.md",
    type: "board",
    title: "Aaa tied",
    frontmatter: { order: 2, columns: ["doc_seedinbox"] },
  });
  ws.doc({
    id: "doc_boardtwo",
    path: "data/docs/boards/two.md",
    type: "board",
    title: "Files",
    frontmatter: { order: 2, columns: [] },
  });
  ws.doc({
    id: "doc_unordered",
    path: "data/docs/boards/unordered.md",
    type: "board",
    title: "Unordered",
    frontmatter: {
      kanban: { field: "stage", stages: ["triage", "doing"], status: { doing: "open" } },
      query: { folder: "inbox" },
    },
  });
  // A view carrying the `column:` key a pre-SHARED-066 workspace wrote and the
  // `pinned:` key a pre-rider-2 one did. Neither is a core key any more, so both
  // ride in `extra` (SPEC.md §2.4's migration, CLI-061).
  ws.doc({
    id: "doc_columnview",
    path: "data/docs/views/board.md",
    type: "view",
    title: "Errands view",
    frontmatter: { pinned: true, column: "board/kanban", query: { type: "todo" } },
  });
  ws.doc({
    id: "doc_draftview",
    path: "data/docs/views/draft.md",
    type: "view",
    title: "Draft",
    frontmatter: { query: { folder: "inbox" } },
  });

  // §5's `stage`: two documents in one stage, one in another, and the rest with
  // no `stage` key at all — the null sentinel's population.
  ws.doc({
    id: "doc_staged1",
    path: "data/docs/inbox/staged-1.md",
    title: "Staged one",
    frontmatter: { stage: "triage" },
  });
  ws.doc({
    id: "doc_staged2",
    path: "data/docs/inbox/staged-2.md",
    title: "Staged two",
    frontmatter: { stage: "triage" },
  });
  ws.doc({
    id: "doc_staged3",
    path: "data/docs/inbox/staged-3.md",
    title: "Staged three",
    frontmatter: { stage: "doing" },
  });
  ws.doc({
    id: "doc_archivedstage",
    path: "data/docs/inbox/staged-4.md",
    title: "Staged and archived",
    frontmatter: { stage: "doing", status: "archived" },
  });

  // A document whose `type` this build has never heard of (§5's open string,
  // §12's M6 — the open type), carrying `items` as a top-level YAML key beside
  // the core ones.
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

describe("the `stage` filter (SPEC.md §5)", () => {
  it("selects exactly the documents in a named stage", () => {
    expect(
      run({ stage: "triage" })
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(["doc_staged1", "doc_staged2"]);
    expect(run({ stage: "doing" }).items.map((item) => item.id)).toEqual(["doc_staged3"]);
  });

  it("ORs comma-separated values, like `type` and `tag`", () => {
    expect(
      run({ stage: "triage,doing" })
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(["doc_staged1", "doc_staged2", "doc_staged3"]);
  });

  /**
   * The empty element is the **null sentinel** (CONTRACT-074), and it is what
   * makes a kanban's first column one request: §10 puts a document with no value
   * for the field in that column beside the documents actually in the first
   * stage.
   */
  it("selects the unstaged with an empty element, and both halves with `stage=,triage`", () => {
    const unstaged = run({ stage: "" });
    expect(unstaged.items.every((item) => item.stage === null)).toBe(true);
    expect(unstaged.items.map((item) => item.id)).not.toContain("doc_staged1");
    expect(unstaged.items.map((item) => item.id)).toContain("doc_draftview");

    const firstColumn = run({ stage: ",triage" });
    expect(firstColumn.items.map((item) => item.id)).toContain("doc_staged1");
    expect(firstColumn.items.map((item) => item.id)).toContain("doc_draftview");
    expect(firstColumn.items.map((item) => item.id)).not.toContain("doc_staged3");
    expect(firstColumn.page.total).toBe(unstaged.page.total + 2);
  });

  it("is exact, never a prefix or a case-insensitive match", () => {
    expect(run({ stage: "tri" }).items).toEqual([]);
    expect(run({ stage: "Triage" }).items).toEqual([]);
  });

  it("collapses duplicate elements rather than double-counting a row", () => {
    expect(run({ stage: "triage,triage" }).page.total).toBe(run({ stage: "triage" }).page.total);
  });

  it("is not thread-only: a thread with no `stage` key is simply unstaged", () => {
    expect(run({ stage: "" }).items.map((item) => item.id)).toContain("th_parented");
    expect(run({ stage: "triage" }).items.map((item) => item.id)).not.toContain("th_parented");
  });

  it("keeps the archived default: an archived staged document needs asking for", () => {
    expect(run({ stage: "doing" }).items.map((item) => item.id)).not.toContain("doc_archivedstage");
    expect(run({ stage: "doing", includeArchived: "true" }).items.map((item) => item.id)).toContain(
      "doc_archivedstage",
    );
  });

  it("counts the same rows it returns", () => {
    const list = run({ stage: "triage" });
    expect(list.page.total).toBe(list.items.length);
  });
});

describe("the board's one bounded query", () => {
  it("returns the boards in `order`, with their columns, kanban and default-open", () => {
    const boards = run({ type: "board", sort: "order" });
    expect(titles(boards)).toEqual(["Attention", "Aaa tied", "Files", "Unordered"]);
    expect(
      boards.items.map((item) => ({
        id: item.id,
        order: item.order,
        columns: item.columns,
        defaultOpen: item.defaultOpen,
      })),
    ).toEqual([
      {
        id: "doc_boardone",
        order: 1,
        columns: ["doc_seedattention"],
        defaultOpen: true,
      },
      { id: "doc_tiedboard", order: 2, columns: ["doc_seedinbox"], defaultOpen: false },
      { id: "doc_boardtwo", order: 2, columns: [], defaultOpen: false },
      { id: "doc_unordered", order: null, columns: null, defaultOpen: false },
    ]);
    // No follow-up read for anything the board bar renders, kanban included.
    expect(boards.items.at(-1)?.kanban).toEqual({
      field: "stage",
      stages: ["triage", "doing"],
      status: { doing: "open" },
    });
  });

  it("orders identically on every run, ties and all", () => {
    const once = run({ type: "board", sort: "order" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(titles(run({ type: "board", sort: "order" }))).toEqual(titles(once));
    }
  });

  it("places a board with no `order` last rather than dropping it", () => {
    const boards = run({ type: "board", sort: "order" });
    expect(boards.items.at(-1)?.id).toBe("doc_unordered");
    expect(boards.items).toHaveLength(boards.page.total);
  });
});

describe("the shipped seed views", () => {
  it("round-trip their query, and carry a pre-rider-2 `pinned` in `extra`", () => {
    const views = run({ type: "view", sort: "order" });
    expect(
      views.items
        .filter((item) => item.id.startsWith("doc_seed"))
        .map((item) => ({ id: item.id, order: item.order, query: item.query })),
    ).toEqual([
      { id: "doc_seedattention", order: 1, query: { needs: "me" } },
      { id: "doc_seedinbox", order: 2, query: { folder: "inbox" } },
      { id: "doc_seedopenthreads", order: 3, query: { type: "thread", status: "open" } },
    ]);
    // `pinned` stopped being a core key on 2026-08-22 (rider 2). A file that
    // still carries one is not an error: it arrives in `extra` like every other
    // key the core does not define, and `corpus upgrade` names the migration
    // that drops it (SPEC.md §2.4, CLI-061).
    for (const view of views.items.filter((item) => item.id.startsWith("doc_seed"))) {
      expect(view.extra).toEqual({ pinned: true });
    }
  });

  it("carries a stale `column:` and a stale `pinned:` together, both untouched", () => {
    const row = run({ type: "view" }).items.find((item) => item.id === "doc_columnview");
    expect(row?.extra).toEqual({ pinned: true, column: "board/kanban" });
    expect(row?.query).toEqual({ type: "todo" });
    expect(row?.columns).toBeNull();
  });
});

describe("the view and board keys and `extra` on a row", () => {
  it("carries a document's own extra frontmatter keys, flat", () => {
    const row = run({ type: "todo" }).items[0];
    expect(row?.id).toBe("doc_errandlist");
    expect(row?.extra).toEqual({
      items: [{ text: "Milk", done: false, ts: "2026-07-27T09:00:00Z" }],
    });
  });

  it("is `{}` and the documented defaults on a document with only core keys", () => {
    const row = run({ q: "escrow" }).items.find((item) => item.id === "doc_parent");
    expect(row).toMatchObject({
      stage: null,
      order: null,
      query: null,
      columns: null,
      kanban: null,
      defaultOpen: false,
      extra: {},
    });
  });

  it("reports `lastActor` on every row, `user` for a projection built from files", () => {
    expect(run().items.every((item) => item.lastActor === "user")).toBe(true);
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
