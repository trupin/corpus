import { DocMutationResponseSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const start = (name: string): WriteWorkspace => {
  ws = createWriteWorkspace(name);
  ws.reproject();
  return ws;
};

describe("POST /api/docs/{id}/move", () => {
  it("changes the path, keeps the id, and needs no reference rewriting", async () => {
    start("move-basic");
    const created = await createDoc(ws, { type: "note", title: "Mortgage options" });
    ws.write(
      "data/threads/th_movetest.md",
      [
        "---",
        "id: th_movetest",
        "type: thread",
        "title: A thread",
        "created: 2026-07-01T00:00:00Z",
        "updated: 2026-07-01T00:00:00Z",
        "tags: []",
        "status: open",
        "anchors: {}",
        "due: null",
        "reviewed: null",
        "evergreen: false",
        `parent: ${created.id}`,
        "anchor: null",
        "agent: none",
        "---",
        "",
      ].join("\n"),
    );
    ws.reproject();

    const response = await ws.post(`/api/docs/${created.id}/move`, { folder: "finance" });
    expect(response.status).toBe(200);
    const doc = DocMutationResponseSchema.parse(await response.json()).doc;

    expect(doc.path).toBe("data/docs/finance/mortgage-options.md");
    expect(doc.frontmatter.id).toBe(created.id);
    expect(ws.exists("data/docs/finance/mortgage-options.md")).toBe(true);
    expect(ws.exists("data/docs/inbox/mortgage-options.md")).toBe(false);

    const read = await ws.request(`/api/docs/${created.id}`);
    expect(read.status).toBe(200);

    const rows = ws.db.prepare("SELECT path FROM documents WHERE id = ?").all(created.id) as {
      path: string;
    }[];
    expect(rows).toEqual([{ path: "data/docs/finance/mortgage-options.md" }]);
    const thread = ws.db
      .prepare("SELECT parent_id FROM threads WHERE id = 'th_movetest'")
      .get() as { parent_id: string };
    expect(thread.parent_id).toBe(created.id);
  });

  it("records both paths in the commit and touches nothing else", async () => {
    start("move-commit");
    const created = await createDoc(ws, { type: "note", title: "Ledger" });
    ws.advance(60_000);

    await ws.post(
      `/api/docs/${created.id}/move`,
      { folder: "finance" },
      {
        "x-corpus-author": "agent",
      },
    );

    const [subject] = ws.log("%an|%s");
    expect(subject).toContain("agent|doc move: ");
    expect(subject).toContain("data/docs/inbox/ledger.md");
    expect(subject).toContain("data/docs/finance/ledger.md");
    expect(subject).toContain(created.id);

    const stat = ws.git("show", "--stat", "--format=", "HEAD");
    expect(stat).toContain("ledger.md");
    expect(stat).not.toContain(".gitignore");
  });

  it("refuses an occupied destination without changing anything", async () => {
    start("move-occupied");
    const first = await createDoc(ws, {
      type: "note",
      title: "Ledger",
      folder: "finance",
      body: "the incumbent",
    });
    const second = await createDoc(ws, { type: "note", title: "Ledger" });
    ws.advance(60_000);
    const head = ws.head();

    const response = await ws.post(`/api/docs/${second.id}/move`, { folder: "finance" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; issues: { message: string }[] };
    expect(body.code).toBe("bad_request");
    expect(body.issues[0]?.message).toContain("data/docs/finance/ledger.md");

    expect(ws.read(first.path)).toContain("the incumbent");
    expect(ws.exists(second.path)).toBe(true);
    expect(ws.head()).toBe(head);
  });

  it("refuses to move a thread out of data/threads, and refuses traversal", async () => {
    start("move-refusals");
    ws.write(
      "data/threads/th_flat0001.md",
      [
        "---",
        "id: th_flat0001",
        "type: thread",
        "title: Flat",
        "created: 2026-07-01T00:00:00Z",
        "updated: 2026-07-01T00:00:00Z",
        "tags: []",
        "status: open",
        "anchors: {}",
        "due: null",
        "reviewed: null",
        "evergreen: false",
        "parent: null",
        "anchor: null",
        "agent: none",
        "---",
        "",
      ].join("\n"),
    );
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Movable" });

    const thread = await ws.post("/api/docs/th_flat0001/move", { folder: "finance" });
    expect(thread.status).toBe(400);
    expect((await thread.json()) as { issues: unknown[] }).toMatchObject({ code: "bad_request" });
    expect(ws.exists("data/threads/th_flat0001.md")).toBe(true);

    for (const folder of ["../..", "/etc"]) {
      const response = await ws.post(`/api/docs/${created.id}/move`, { folder });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { issues: unknown[] };
      expect(body.issues.length).toBeGreaterThan(0);
    }
    expect(ws.exists(created.path)).toBe(true);
  });

  it("treats a move to the current folder as a no-op", async () => {
    start("move-noop");
    const created = await createDoc(ws, { type: "note", title: "Stay" });
    ws.advance(60_000);
    const head = ws.head();

    const response = await ws.post(`/api/docs/${created.id}/move`, { folder: "inbox" });
    expect(response.status).toBe(200);
    const doc = DocMutationResponseSchema.parse(await response.json()).doc;
    expect(doc.path).toBe(created.path);
    expect(ws.head()).toBe(head);
  });

  it("preserves the file's content across the move", async () => {
    start("move-content");
    const created = await createDoc(ws, {
      type: "note",
      title: "Contentful",
      body: "unique marker body",
    });
    const before = ws.read(created.path);

    await ws.post(`/api/docs/${created.id}/move`, { folder: "archive-shelf" });
    const after = ws.read("data/docs/archive-shelf/contentful.md");
    expect(after).toBe(before);
    expect(parseDocument(after).body).toContain("unique marker body");
  });
});
