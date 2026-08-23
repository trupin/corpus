// The write path's board surface: §5's `stage`, §10's view and board keys, and
// every frontmatter key the core does not define, through `POST /api/docs` and
// `PUT /api/docs/{id}` (CONTRACT-011, CONTRACT-074).
//
// The extra-frontmatter cases deliberately carry `type: todo` — a type this
// build has never heard of. §5 leaves `type` an open string and §12's M6 makes
// that a promise, so these are also the guarantee that a workspace's own
// leftover types still create, save, project and list (SHARED-067).
//
// Every case goes through the real app, writes a real file into a real git
// repository, and is asserted on the three real surfaces — the file's bytes,
// the response, and the row the collection query answers with. The byte
// assertions are the point of the issue: `extra` is a **shallow merge patch**,
// so a writer touching its own key must leave every other key's line exactly as
// it found it (SPEC.md §4's honest diff).

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

const SEED_DOCS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "assets/workspace/data/docs",
);

const SEED_VIEWS_DIR = join(SEED_DOCS_DIR, "views");
const SEED_BOARDS_DIR = join(SEED_DOCS_DIR, "boards");

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

describe("POST /api/docs with view and board keys", () => {
  it("writes them as top-level YAML keys and reads them back on both routes", async () => {
    ws = createWriteWorkspace("view-create", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "view",
      title: "Finance",
      folder: "views",
      stage: "triage",
      order: 20,
      query: { folder: "finance", type: ["note", "thread"] },
      columns: ["doc_seedinbox"],
      defaultOpen: true,
      // The `column` key a pre-SHARED-066 board carried, and the `pinned` key a
      // pre-rider-2 view did. Neither is a core field any more, so both travel
      // as extra frontmatter and land as plain YAML keys beside the others —
      // which is what makes an old view round-trip.
      extra: { column: "board/kanban", pinned: true },
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
      // §9.2's provenance, in canonical key order right after the §5 block
      // (SERVER-110). `null` on a document no job created, which is most of them.
      "origin: null",
      "stage: triage",
      "order: 20",
      "query:",
      "  folder: finance",
      "  type:",
      "    - note",
      "    - thread",
      "columns:",
      "  - doc_seedinbox",
      "default-open: true",
      "column: board/kanban",
      "pinned: true",
    ]);

    const frontmatter = (created.body["frontmatter"] ?? {}) as Record<string, unknown>;
    expect(frontmatter["stage"]).toBe("triage");
    expect(frontmatter["order"]).toBe(20);
    expect(frontmatter["query"]).toEqual({ folder: "finance", type: ["note", "thread"] });
    expect(frontmatter["columns"]).toEqual(["doc_seedinbox"]);
    // The wire spells it `defaultOpen`; the file spells it `default-open`, and
    // neither spelling ever reaches `extra` (both are reserved).
    expect(frontmatter["defaultOpen"]).toBe(true);
    expect(frontmatter["default-open"]).toBeUndefined();
    expect(frontmatter["column"]).toBeUndefined();
    expect(frontmatter["extra"]).toEqual({ column: "board/kanban", pinned: true });

    const row = rowOf(await list("type=view&sort=order"), created.id);
    expect(row).toMatchObject({
      stage: "triage",
      order: 20,
      query: { folder: "finance", type: ["note", "thread"] },
      columns: ["doc_seedinbox"],
      defaultOpen: true,
      extra: { column: "board/kanban", pinned: true },
    });
  });

  /**
   * A stage carrying a comma could never be filtered for: `stage=` is a
   * comma-separated OR list, so the value would be unreachable and a kanban
   * column drawn from it would silently show the wrong documents
   * (CONTRACT-074's `StageValueSchema`). The refusal names the filter, because
   * "no commas" is a rule nobody would guess the reason for.
   */
  it("refuses a stage carrying a comma, naming the filter that makes it unusable", async () => {
    ws = createWriteWorkspace("stage-comma", { sprint: "s026" });
    const response = await ws.request("/api/docs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${"tkn_0123456789abcdef0123456789abcdef"}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "note", title: "Comma", stage: "in review, blocked" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues?: { path: string; message: string }[] };
    const issue = body.issues?.find((entry) => entry.path.includes("stage"));
    expect(issue?.message).toContain("GET /api/docs?stage=");
  });

  it("writes no key for a value the request omits or nulls", async () => {
    ws = createWriteWorkspace("view-create-null", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "note",
      title: "Plain",
      // `false` and absent are one state for `defaultOpen`; `null` is "no key"
      // for the rest (CONTRACT-011, CONTRACT-074).
      defaultOpen: false,
      stage: null,
      order: null,
      query: null,
      columns: null,
      kanban: null,
    });
    const text = ws.read(created.path);
    for (const key of ["default-open", "stage", "order", "query", "columns", "kanban"]) {
      expect(text).not.toContain(`${key}:`);
    }
    const row = rowOf(await list("type=note"), created.id);
    expect(row).toMatchObject({
      defaultOpen: false,
      stage: null,
      order: null,
      query: null,
      columns: null,
      kanban: null,
    });
  });

  it("keeps the shipped seed views round-tripping through the create route", async () => {
    ws = createWriteWorkspace("view-seed", { sprint: "s026" });
    for (const name of readdirSync(SEED_VIEWS_DIR).sort()) {
      ws.write(`data/docs/views/${name}`, readFileSync(join(SEED_VIEWS_DIR, name), "utf8"));
    }
    ws.reproject();
    const board = await list("type=view&sort=order");
    // AGENT-042: a seed view is a saved query and nothing more — no `pinned`,
    // no `order`, and so nothing in `extra` either (rider 2). The three come
    // back in title order, which is where the `order` sort's documented
    // tiebreak lands them once every `order` is null.
    expect(board.items.map((item) => [item.title, item.order, item.query])).toEqual([
      ["Attention", null, { needs: "me" }],
      ["Inbox", null, { folder: "inbox" }],
      ["Open threads", null, { type: "thread", status: "open" }],
    ]);
    expect(board.items.every((item) => Object.keys(item.extra).length === 0)).toBe(true);
  });

  /**
   * The other half of the same claim, and the one the board bar reads: rider 2's
   * three seed boards, from the shipped bytes rather than from a fixture. A
   * board is an ordinary document, so this is the projection answering about
   * files `corpus init` copies verbatim.
   */
  it("keeps the shipped seed boards round-tripping through the create route", async () => {
    ws = createWriteWorkspace("board-seed", { sprint: "s026" });
    for (const name of readdirSync(SEED_VIEWS_DIR).sort()) {
      ws.write(`data/docs/views/${name}`, readFileSync(join(SEED_VIEWS_DIR, name), "utf8"));
    }
    for (const name of readdirSync(SEED_BOARDS_DIR).sort()) {
      ws.write(`data/docs/boards/${name}`, readFileSync(join(SEED_BOARDS_DIR, name), "utf8"));
    }
    ws.reproject();
    const boards = await list("type=board&sort=order");
    expect(
      boards.items.map((item) => [item.title, item.order, item.columns, item.defaultOpen]),
    ).toEqual([
      ["Attention", 1, ["doc_seedattention", "doc_seedinbox", "doc_seedopenthreads"], false],
      // A kanban's columns are derived one per stage and are not view
      // documents, so its `columns` is null rather than empty — the Files
      // board below is what an empty one looks like.
      ["By status", 2, null, false],
      ["Files", 3, [], true],
    ]);
    expect(rowOf(boards, "doc_seedboardbystatus")?.kanban).toEqual({
      field: "status",
      stages: ["open", "resolved", "archived"],
    });
    expect(rowOf(boards, "doc_seedboardbystatus")?.query).toEqual({ type: "note" });
    // Exactly one default-open board ships, which is what rider 2 requires of
    // any workspace and what `corpus init` therefore has to deliver.
    expect(boards.items.filter((item) => item.defaultOpen).map((item) => item.id)).toEqual([
      "doc_seedboardfiles",
    ]);
    // Every column names a view that ships beside it: a board pointing at an id
    // no seed carries would render a column that cannot be drawn.
    const viewIds = new Set((await list("type=view")).items.map((item) => item.id));
    for (const item of boards.items) {
      for (const column of item.columns ?? []) expect(viewIds, item.id).toContain(column);
    }
  });
});

describe("POST /api/docs with extra frontmatter", () => {
  it("writes extra keys beside the core ones, flat, and projects them onto the row", async () => {
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

  it("refuses a top-level `column` and an unusable query with 400", async () => {
    ws = createWriteWorkspace("view-reject", { sprint: "s026" });
    // `column` is not a core field any more (SHARED-066), and the create
    // request is strict — so a caller written against the old contract gets a
    // `400` naming the key rather than a silent no-op. `extra: { column }` is
    // the way to write it, and that is exercised above.
    expect(
      (await ws.post("/api/docs", { type: "view", title: "T", column: "todos/todos" })).status,
    ).toBe(400);
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
  // request*; `extra` is a merge patch, so a writer landing 20 KiB under a fresh
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
      stage: "triage",
      query: { type: "thread", status: "open" },
      extra: { lane: "doing" },
    });
    const before = ws.read(created.path);
    const head = ws.head();

    ws.advance(60_000);
    // Same values, and the query's keys in the other order — one value, not two.
    const response = await putDoc(ws, created.id, {
      stage: "triage",
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
      stage: "triage",
      order: 30,
      extra: { column: "board/kanban" },
    });
    ws.advance(60_000);
    // `order` and `stage` are core keys and clear with `null`; a stale `column`
    // is an extra key, so it clears through the merge patch that owns it.
    expect(
      (
        await putDoc(ws, created.id, {
          order: null,
          stage: null,
          due: null,
          extra: { column: null },
        })
      ).status,
    ).toBe(200);

    const text = ws.read(created.path);
    expect(text).not.toContain("order:");
    expect(text).not.toContain("stage:");
    expect(text).not.toContain("column:");
    // §5's canonical block keeps its `due: null`; only the §10 keys are cleared.
    expect(text).toContain("due: null");

    const row = rowOf(await list("type=view"), created.id);
    expect(row).toMatchObject({ stage: null, order: null, extra: {} });
  });

  /**
   * `defaultOpen` is the one core key whose wire spelling and file spelling
   * differ, and `false` removes the key rather than writing the negative: the
   * two states are one, so the file says `default-open` exactly on the board
   * that is the default.
   */
  it("writes `default-open` for `defaultOpen: true` and removes it for `false`", async () => {
    ws = createWriteWorkspace("view-unpin", { sprint: "s026" });
    const created = await createDoc(ws, {
      type: "board",
      title: "Finance",
      folder: "views",
      defaultOpen: true,
      order: 30,
    });
    expect(ws.read(created.path)).toContain("default-open: true");
    ws.advance(60_000);
    expect((await putDoc(ws, created.id, { defaultOpen: false })).status).toBe(200);
    expect(ws.read(created.path)).not.toContain("default-open");
    expect(rowOf(await list("type=board"), created.id)?.defaultOpen).toBe(false);
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

/**
 * SPEC.md §9.1's `last_actor` — §4's attribution, as a row column, and what §7's
 * reflection reads to decide what is unreflected.
 *
 * Three writers, three sources: the mutation's own acting party, the watcher's
 * `user` for a change from outside the server, and — after a rebuild, when every
 * row is re-derived from files — the git author §4 wrote the commit as. The last
 * one is the claim worth a real repository: the projection is derived, so the
 * fact has to survive being thrown away.
 */
describe("documents.last_actor", () => {
  it("follows the acting party of each write, and survives a rebuild through git", async () => {
    ws = createWriteWorkspace("last-actor", { identity: true });
    const byAgent = await createDoc(ws, { type: "note", title: "Filed" }, "agent");
    const byUser = await createDoc(ws, { type: "note", title: "Written" }, "user");

    const actors = async (): Promise<Record<string, string>> =>
      Object.fromEntries((await list("type=note")).items.map((item) => [item.id, item.lastActor]));

    expect(await actors()).toMatchObject({ [byAgent.id]: "agent", [byUser.id]: "user" });

    // A person edits the document the agent filed: the column follows the write.
    ws.advance(60_000);
    expect((await putDoc(ws, byAgent.id, { tags: ["mine"] })).status).toBe(200);
    expect((await actors())[byAgent.id]).toBe("user");

    // And the agent edits the one the person wrote.
    ws.advance(60_000);
    expect(
      (await putDoc(ws, byUser.id, { tags: ["theirs"] }, { "x-corpus-author": "agent" })).status,
    ).toBe(200);
    expect((await actors())[byUser.id]).toBe("agent");

    // Throw the whole projection away. Every row comes back from the files, and
    // `last_actor` comes back from the commit author §4 recorded.
    ws.reproject();
    expect(await actors()).toMatchObject({ [byAgent.id]: "user", [byUser.id]: "agent" });
  });
});
