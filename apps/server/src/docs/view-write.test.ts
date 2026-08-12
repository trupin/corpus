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
import { createDoc, createWriteWorkspace, type WriteWorkspace, putDoc } from "./write-fixture.js";

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
    const response = await putDoc(ws, created.id, {
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
    expect((await putDoc(ws, created.id, { extra: { items: null } })).status).toBe(200);
    const text = ws.read(created.path);
    expect(text).not.toContain("items:");
    expect(text).toContain("lane: doing");
    expect(rowOf(await list("type=todo"), created.id)?.extra).toEqual({ lane: "doing" });
  });

  // SERVER-029 (PR #10 finding 15). `ExtraFrontmatterSchema` bounds *one
  // request*; `extra` is a merge patch, so a plugin writing 20 KiB under a fresh
  // key each time walked a document past the 64 KiB the contract advertises,
  // one legal request at a time. The bound belongs to the document, so it is
  // checked against what the file will hold.
  describe("the 64 KiB `extra` bound holds across requests, not just within one", () => {
    const CHUNK = "x".repeat(20 * 1024);

    const extraBytesOf = (text: string): number => {
      const frontmatter = frontmatterLines(text);
      const keys = frontmatter.filter((line) => /^[abcd]: /.test(line));
      return keys.reduce((total, line) => total + line.length, 0);
    };

    it("refuses the patch that would cross the bound, and writes nothing", async () => {
      ws = createWriteWorkspace("extra-accretion", { sprint: "s014" });
      const created = await createDoc(ws, {
        type: "todo",
        title: "Accretion",
        extra: { a: CHUNK },
      });

      // Two more keys under the bound: each request is legal on its own *and*
      // the merged result still fits.
      for (const key of ["b", "c"]) {
        ws.advance(60_000);
        const response = await putDoc(ws, created.id, { extra: { [key]: CHUNK } });
        expect([key, response.status]).toEqual([key, 200]);
      }

      const before = ws.read(created.path);
      const head = ws.head();
      expect(extraBytesOf(before)).toBeGreaterThan(60 * 1024);

      // The fourth crosses it. Same request shape, same 20 KiB — what changed is
      // the file it lands in.
      ws.advance(60_000);
      const refused = await putDoc(ws, created.id, { extra: { d: CHUNK } });
      const payload = (await refused.json()) as {
        code: string;
        issues: { path: string; message: string }[];
      };

      expect(refused.status).toBe(400);
      expect(payload.code).toBe("bad_request");
      expect(payload.issues[0]?.path).toBe("body.extra");
      expect(payload.issues[0]?.message).toContain("65536");

      // Not partially applied, not committed, not stamped.
      expect(ws.read(created.path)).toBe(before);
      expect(ws.head()).toBe(head);
      expect(rowOf(await list("type=todo"), created.id)?.extra).toEqual({
        a: CHUNK,
        b: CHUNK,
        c: CHUNK,
      });
    });

    it("still lets an already-oversized document be edited down", async () => {
      // A file can only exceed the bound by being hand-edited, and refusing
      // every write to it would refuse the one patch that could fix it.
      ws = createWriteWorkspace("extra-oversized", { sprint: "s014" });
      const created = await createDoc(ws, { type: "todo", title: "Hand edited" });
      // Five 20 KiB keys — over the bound before and *after* the patch below, so
      // what is being asserted is the direction of the change, not its result.
      ws.write(
        created.path,
        ws
          .read(created.path)
          .replace(
            /^---\n/,
            `---\na: ${CHUNK}\nb: ${CHUNK}\nc: ${CHUNK}\nd: ${CHUNK}\ne: ${CHUNK}\n`,
          ),
      );
      ws.reproject();

      ws.advance(60_000);
      const shrunk = await putDoc(ws, created.id, { extra: { e: null } });
      expect(shrunk.status).toBe(200);
      expect(ws.read(created.path)).not.toContain("\ne: ");

      // Still over the bound, so growing it further is still refused.
      ws.advance(60_000);
      expect((await putDoc(ws, created.id, { extra: { f: CHUNK } })).status).toBe(400);
    });

    it("leaves a patch that names no extra key alone, whatever the file holds", async () => {
      // The autosave path carries a body and no `extra`, and must keep working
      // on a hand-edited oversized document.
      ws = createWriteWorkspace("extra-body-only", { sprint: "s014" });
      const created = await createDoc(ws, { type: "todo", title: "Hand edited", body: "One.\n" });
      ws.write(
        created.path,
        ws.read(created.path).replace(/^---\n/, `---\na: ${CHUNK}\nb: ${CHUNK}\nc: ${CHUNK}\nd: ${CHUNK}\n`), // prettier-ignore
      );
      ws.reproject();

      ws.advance(60_000);
      expect((await putDoc(ws, created.id, { body: "Two.\n" })).status).toBe(200);
      expect(ws.read(created.path)).toContain("Two.");
    });
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
    const response = await putDoc(ws, created.id, {
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
    expect((await putDoc(ws, created.id, { order: null, column: null, due: null })).status).toBe(
      200,
    );

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
    expect((await putDoc(ws, created.id, { pinned: false })).status).toBe(200);
    expect(ws.read(created.path)).toContain("pinned: false");
    expect(rowOf(await list("pinned=false"), created.id)?.pinned).toBe(false);
    expect(rowOf(await list("pinned=true"), created.id)).toBeUndefined();
  });

  it("refuses to shadow a core key through `extra`, leaving the file untouched", async () => {
    ws = createWriteWorkspace("extra-shadow", { sprint: "s026" });
    const created = await createDoc(ws, { type: "todo", title: "Errands" });
    const before = ws.read(created.path);
    const response = await putDoc(ws, created.id, { extra: { status: "archived" } });
    expect(response.status).toBe(400);
    expect(ws.read(created.path)).toBe(before);
  });
});
