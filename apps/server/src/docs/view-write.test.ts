// The write path's CONTRACT-011 surface: §11's view keys and §12's plugin keys
// through `POST /api/docs` and `PUT /api/docs/{id}`.
//
// Every case goes through the real app, writes a real file into a real git
// repository, and is asserted on the three real surfaces — the file's bytes,
// the response, and the row the collection query answers with. The byte
// assertions are the point of the issue: `extra` is a **shallow merge patch**,
// so a plugin writing its key must leave every other key's line exactly as it
// found it (SPEC.md §4's honest diff).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DocListSchema, type DocList, type DocRow } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const SEED_VIEWS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "assets/workspace/data/docs/views",
);

/** Frontmatter block of a file, as lines — what a byte-preservation claim is about. */
const frontmatterLines = (text: string): string[] => {
  const parts = text.split("\n---");
  return (parts[0] ?? "").replace(/^---\n/, "").split("\n");
};

async function list(query: string): Promise<DocList> {
  const response = await ws.request(`/api/docs?${query}`, {
    headers: { Authorization: `Bearer ${"tkn_0123456789abcdef0123456789abcdef"}` },
  });
  expect(response.status).toBe(200);
  return DocListSchema.parse(await response.json());
}

const rowOf = (docs: DocList, id: string): DocRow | undefined =>
  docs.items.find((item) => item.id === id);

describe("POST /api/docs with view keys", () => {
  it("writes them as top-level YAML keys and reads them back on both routes", async () => {
    ws = createWriteWorkspace("view-create", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "view",
      title: "Finance",
      folder: "views",
      pinned: true,
      order: 20,
      query: { folder: "finance", type: ["note", "thread"] },
      column: "todos/board",
    });

    const text = ws.read(created.path);
    expect(frontmatterLines(text)).toEqual([
      "id: doc_finance".replace("doc_finance", created.id),
      "type: view",
      "title: Finance",
      "created: 2026-07-27T09:00:00Z",
      "updated: 2026-07-27T09:00:00Z",
      "tags: []",
      "status: open",
      "anchors: {}",
      "due: null",
      "reviewed: null",
      "evergreen: false",
      "pinned: true",
      "order: 20",
      "query:",
      "  folder: finance",
      "  type:",
      "    - note",
      "    - thread",
      "column: todos/board",
    ]);

    const frontmatter = (created.body["frontmatter"] ?? {}) as Record<string, unknown>;
    expect(frontmatter["pinned"]).toBe(true);
    expect(frontmatter["order"]).toBe(20);
    expect(frontmatter["query"]).toEqual({ folder: "finance", type: ["note", "thread"] });
    expect(frontmatter["column"]).toBe("todos/board");
    expect(frontmatter["extra"]).toEqual({});

    const row = rowOf(await list("pinned=true&type=view&sort=order"), created.id);
    expect(row).toMatchObject({
      pinned: true,
      order: 20,
      query: { folder: "finance", type: ["note", "thread"] },
      column: "todos/board",
      extra: {},
    });
  });

  it("writes no key for a value the request omits or nulls", async () => {
    ws = createWriteWorkspace("view-create-null", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "note",
      title: "Plain",
      // `false` and absent are one state for `pinned`; `null` is "no key" for
      // the other three (CONTRACT-011).
      pinned: false,
      order: null,
      query: null,
      column: null,
    });
    const text = ws.read(created.path);
    for (const key of ["pinned", "order", "query", "column"]) {
      expect(text).not.toContain(`${key}:`);
    }
    const row = rowOf(await list("type=note"), created.id);
    expect(row).toMatchObject({ pinned: false, order: null, query: null, column: null });
  });

  it("keeps the shipped seed views round-tripping through the create route", async () => {
    ws = createWriteWorkspace("view-seed", { sprint: "s026" });
    for (const name of readdirSync(SEED_VIEWS_DIR).sort()) {
      ws.write(`data/docs/views/${name}`, readFileSync(join(SEED_VIEWS_DIR, name), "utf8"));
    }
    ws.reproject();
    const board = await list("pinned=true&type=view&sort=order");
    expect(board.items.map((item) => [item.title, item.order, item.query])).toEqual([
      ["Attention", 1, { needs: "me" }],
      ["Inbox", 2, { folder: "inbox" }],
      ["Open threads", 3, { type: "thread", status: "open" }],
    ]);
    expect(board.items.every((item) => item.pinned && item.column === null)).toBe(true);
  });
});

describe("POST /api/docs with extra frontmatter", () => {
  it("writes plugin keys beside the core ones, flat, and projects them onto the row", async () => {
    ws = createWriteWorkspace("extra-create", { sprint: "s026" });
    const items = [
      { text: "Call the broker", done: false, ts: "2026-07-27T09:00:00Z" },
      { text: "File the statement", done: true, ts: "2026-07-27T09:05:00Z" },
    ];
    const created = await createDoc(ws, {
      type: "todo",
      title: "Mortgage errands",
      extra: { items, board: { lane: "doing" } },
    });

    const text = ws.read(created.path);
    // Flat, mirroring the file: no `extra:` mapping is ever written.
    expect(text).not.toContain("extra:");
    expect(frontmatterLines(text).slice(-9)).toEqual([
      "items:",
      "  - text: Call the broker",
      "    done: false",
      "    ts: 2026-07-27T09:00:00Z",
      "  - text: File the statement",
      "    done: true",
      "    ts: 2026-07-27T09:05:00Z",
      "board:",
      "  lane: doing",
    ]);

    const frontmatter = (created.body["frontmatter"] ?? {}) as Record<string, unknown>;
    expect(frontmatter["extra"]).toEqual({ items, board: { lane: "doing" } });
    expect(rowOf(await list("type=todo"), created.id)?.extra).toEqual({
      items,
      board: { lane: "doing" },
    });
  });

  it("treats a null extra value as a no-op, since there is nothing yet to remove", async () => {
    ws = createWriteWorkspace("extra-create-null", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "todo",
      title: "Empty",
      extra: { items: null, lane: "doing" },
    });
    expect(ws.read(created.path)).not.toContain("items:");
    expect(rowOf(await list("type=todo"), created.id)?.extra).toEqual({ lane: "doing" });
  });

  it("refuses a core key, a bottomless value and an oversized object with 400", async () => {
    ws = createWriteWorkspace("extra-reject", { sprint: "s026" });
    const attempt = async (extra: unknown): Promise<Response> =>
      ws.post("/api/docs", { type: "todo", title: "T", extra });

    // The schema at the boundary is what refuses these — the server surfaces
    // the 400 rather than re-checking (CONTRACT-011).
    const shadowed = await attempt({ title: "Hijacked" });
    expect(shadowed.status).toBe(400);
    expect(JSON.stringify(await shadowed.json())).toContain("core frontmatter key");

    let deep: unknown = "leaf";
    for (let level = 0; level < 12; level += 1) deep = { k: deep };
    expect((await attempt({ deep })).status).toBe(400);

    expect((await attempt({ big: "x".repeat(70 * 1024) })).status).toBe(400);
    // A frontmatter key has to have a name.
    expect((await attempt({ "": 1 })).status).toBe(400);

    // Nothing was written for any of them.
    expect(readdirSync(join(ws.root, "data", "docs", "inbox"))).toEqual([]);
  });

  it("refuses a malformed column reference and an unusable query with 400", async () => {
    ws = createWriteWorkspace("view-reject", { sprint: "s026" });
    expect((await ws.post("/api/docs", { type: "view", title: "T", column: "todos" })).status).toBe(
      400,
    );
    expect(
      (await ws.post("/api/docs", { type: "view", title: "T", query: { needs: { deep: 1 } } }))
        .status,
    ).toBe(400);
  });
});

describe("PUT /api/docs/{id} — the extra merge patch", () => {
  it("replaces the named key and leaves every other line byte-identical", async () => {
    ws = createWriteWorkspace("extra-update", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "todo",
      title: "Errands",
      extra: {
        items: [{ text: "Call the broker", done: false }],
        board: { lane: "doing", swimlane: "home" },
        note: "untouched",
      },
    });
    const before = ws.read(created.path);
    const beforeLines = frontmatterLines(before);

    ws.advance(60_000);
    const response = await ws.put(`/api/docs/${created.id}`, {
      extra: { items: [{ text: "Call the broker", done: true }] },
    });
    expect(response.status).toBe(200);

    const after = ws.read(created.path);
    const afterLines = frontmatterLines(after);
    // The `board:` and `note:` lines — and every core line but `updated` — are
    // the original bytes, not a re-emission of them.
    const untouched = (lines: string[]): string[] =>
      lines.filter((line) => !line.startsWith("updated:") && !/^( |items:)/.test(line));
    expect(untouched(afterLines)).toEqual(untouched(beforeLines));
    expect(after).toContain("  swimlane: home");
    expect(after).toContain("note: untouched");
    expect(after).toContain("    done: true");
    expect(after).not.toContain("    done: false");

    const row = rowOf(await list("type=todo"), created.id);
    expect(row?.extra).toEqual({
      items: [{ text: "Call the broker", done: true }],
      board: { lane: "doing", swimlane: "home" },
      note: "untouched",
    });
    // One commit for the edit, on top of the create.
    expect(ws.log("%s")[0]).toContain(`doc edit: Errands (${created.id})`);
  });

  it("removes exactly the keys the patch nulls", async () => {
    ws = createWriteWorkspace("extra-remove", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "todo",
      title: "Errands",
      extra: { items: [{ text: "A" }], lane: "doing" },
    });
    ws.advance(60_000);
    expect((await ws.put(`/api/docs/${created.id}`, { extra: { items: null } })).status).toBe(200);
    const text = ws.read(created.path);
    expect(text).not.toContain("items:");
    expect(text).toContain("lane: doing");
    expect(rowOf(await list("type=todo"), created.id)?.extra).toEqual({ lane: "doing" });
  });

  it("does not write, commit or stamp `updated` for a patch that changes nothing", async () => {
    ws = createWriteWorkspace("extra-noop", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "view",
      title: "Threads",
      folder: "views",
      pinned: true,
      query: { type: "thread", status: "open" },
      extra: { lane: "doing" },
    });
    const before = ws.read(created.path);
    const head = ws.head();

    ws.advance(60_000);
    // Same values, and the query's keys in the other order — one value, not two.
    const response = await ws.put(`/api/docs/${created.id}`, {
      pinned: true,
      query: { status: "open", type: "thread" },
      extra: { lane: "doing", gone: null },
    });
    expect(response.status).toBe(200);
    expect(ws.read(created.path)).toBe(before);
    expect(ws.head()).toBe(head);
  });

  it("clears a view key the patch nulls, and keeps `due: null` written", async () => {
    ws = createWriteWorkspace("view-clear", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "view",
      title: "Finance",
      folder: "views",
      pinned: true,
      order: 30,
      column: "todos/board",
    });
    ws.advance(60_000);
    expect(
      (await ws.put(`/api/docs/${created.id}`, { order: null, column: null, due: null })).status,
    ).toBe(200);

    const text = ws.read(created.path);
    expect(text).not.toContain("order:");
    expect(text).not.toContain("column:");
    // §5's canonical block keeps its `due: null`; only the §11 keys are cleared.
    expect(text).toContain("due: null");
    expect(text).toContain("pinned: true");

    const row = rowOf(await list("pinned=true"), created.id);
    expect(row).toMatchObject({ pinned: true, order: null, column: null });
  });

  it("writes `pinned: false` as itself, since the key has no null state", async () => {
    ws = createWriteWorkspace("view-unpin", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "view",
      title: "Finance",
      folder: "views",
      pinned: true,
      order: 30,
    });
    ws.advance(60_000);
    expect((await ws.put(`/api/docs/${created.id}`, { pinned: false })).status).toBe(200);
    expect(ws.read(created.path)).toContain("pinned: false");
    expect(rowOf(await list("pinned=false"), created.id)?.pinned).toBe(false);
    expect(rowOf(await list("pinned=true"), created.id)).toBeUndefined();
  });

  it("refuses to shadow a core key through `extra`, leaving the file untouched", async () => {
    ws = createWriteWorkspace("extra-shadow", { sprint: "s026" });
    const created = await createDoc(ws, { type: "todo", title: "Errands" });
    const before = ws.read(created.path);
    const response = await ws.put(`/api/docs/${created.id}`, { extra: { status: "archived" } });
    expect(response.status).toBe(400);
    expect(ws.read(created.path)).toBe(before);
  });
});
