// `GET /api/docs/{id}/diff` against a real workspace and a real git repository
// (SPEC.md §4's rider, CONTRACT-028). Nothing here fakes git: the range
// resolution, the path scoping and the truncation are all statements about what
// the workspace's own history contains.

import { afterEach, describe, expect, it } from "vitest";
import { DOC_DIFF_MAX_CHARS, EMPTY_TREE_OBJECT_ID, type DocDiff } from "@corpus/contract";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";

const workspaces: WriteWorkspace[] = [];

function workspace(prefix: string, options: { git?: boolean } = {}): WriteWorkspace {
  const ws = createWriteWorkspace(prefix, { sprint: "s011", ...options });
  workspaces.push(ws);
  return ws;
}

afterEach(async () => {
  for (const ws of workspaces.splice(0)) {
    await ws.server.close();
    ws.close();
  }
});

async function diff(
  ws: WriteWorkspace,
  id: string,
  query = "",
): Promise<{ status: number; body: DocDiff & { code?: string; issues?: { path: string }[] } }> {
  const response = await ws.request(`/api/docs/${id}/diff${query}`);
  return { status: response.status, body: (await response.json()) as never };
}

describe("GET /api/docs/{id}/diff", () => {
  it("defaults to the newest commit that touched the document, and its parent", async () => {
    const ws = workspace("diff-default");
    const doc = await createDoc(ws, { type: "note", title: "Rates", body: "one\n" });
    ws.advance(60_000);
    await ws.put(`/api/docs/${doc.id}`, { body: "one\ntwo\n" }, { "x-corpus-author": "user" });

    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    expect(body.id).toBe(doc.id);
    expect(body.path).toBe(doc.path);
    expect(body.to).toBe(ws.head());
    expect(body.from).toBe(ws.git("rev-parse", `${ws.head()}^`).trim());
    expect(body.truncated).toBe(false);
    expect(body.totalChars).toBe(body.diff.length);
    expect(body.diff).toContain("+two");
    expect(body.stats.commits).toBe(1);
    expect(body.stats.insertions).toBeGreaterThan(0);
  });

  it("reads the range it is given, and reports it back resolved", async () => {
    const ws = workspace("diff-range");
    const doc = await createDoc(ws, { type: "note", title: "Ledger", body: "a\n" });
    const created = ws.head();
    ws.advance(60_000);
    await ws.put(`/api/docs/${doc.id}`, { body: "a\nb\n" }, { "x-corpus-author": "user" });
    ws.advance(60_000);
    await ws.put(`/api/docs/${doc.id}`, { body: "a\nb\nc\n" }, { "x-corpus-author": "user" });

    const { body } = await diff(ws, doc.id, `?from=${created.slice(0, 10)}&to=${ws.head()}`);
    // Abbreviated in, full sha out: a caller that omitted or shortened a half
    // must be able to say exactly what it read.
    expect(body.from).toBe(created);
    expect(body.to).toBe(ws.head());
    expect(body.stats.commits).toBe(2);
    expect(body.diff).toContain("+b");
    expect(body.diff).toContain("+c");
  });

  it("accepts git's empty tree as the base, which is what a doc.edited carries for a new document", async () => {
    const ws = workspace("diff-empty-tree");
    const doc = await createDoc(ws, { type: "note", title: "Fresh", body: "hello\n" });

    const { status, body } = await diff(
      ws,
      doc.id,
      `?from=${EMPTY_TREE_OBJECT_ID}&to=${ws.head()}`,
    );
    expect(status).toBe(200);
    expect(body.from).toBe(EMPTY_TREE_OBJECT_ID);
    expect(body.diff).toContain("new file mode");
    expect(body.stats.deletions).toBe(0);
  });

  it("scopes the diff and the stats to this document's file alone", async () => {
    const ws = workspace("diff-scope");
    const one = await createDoc(ws, { type: "note", title: "One", body: "one\n" });
    const base = ws.head();
    await createDoc(ws, { type: "note", title: "Two", body: "two\n" });

    const { body } = await diff(ws, one.id, `?from=${base}&to=${ws.head()}`);
    expect(body.diff).toBe("");
    expect(body.stats).toEqual({ commits: 0, insertions: 0, deletions: 0 });
  });

  it("answers a null range for a document with no committed history", async () => {
    const ws = workspace("diff-no-git", { git: false });
    const doc = await createDoc(ws, { type: "note", title: "Uncommitted", body: "x\n" });

    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      from: null,
      to: null,
      diff: "",
      truncated: false,
      totalChars: 0,
      stats: { commits: 0, insertions: 0, deletions: 0 },
    });
  });

  it("refuses a named revision before a git process exists", async () => {
    const ws = workspace("diff-dsl");
    const doc = await createDoc(ws, { type: "note", title: "Guarded", body: "x\n" });

    for (const [parameter, value] of [
      ["from", "HEAD~1"],
      ["to", "v1.0.0"],
      ["from", "--output=/tmp/x"],
      ["to", "-C/etc"],
    ] as const) {
      const { status, body } = await diff(ws, doc.id, `?${parameter}=${encodeURIComponent(value)}`);
      expect(status).toBe(400);
      expect(body.code).toBe("bad_request");
      expect(body.issues?.[0]?.path).toBe(`query.${parameter}`);
    }
  });

  it("refuses a well-formed sha this workspace does not contain, naming the parameter", async () => {
    const ws = workspace("diff-unknown-sha");
    const doc = await createDoc(ws, { type: "note", title: "Unknown", body: "x\n" });
    const absent = "0123456789abcdef0123456789abcdef01234567";

    const from = await diff(ws, doc.id, `?from=${absent}`);
    expect(from.status).toBe(400);
    expect(from.body.issues?.[0]?.path).toBe("query.from");

    const to = await diff(ws, doc.id, `?to=${absent}`);
    expect(to.status).toBe(400);
    expect(to.body.issues?.[0]?.path).toBe("query.to");
  });

  it("refuses the empty tree as the head of the range — `to` is a commit", async () => {
    const ws = workspace("diff-empty-tree-head");
    const doc = await createDoc(ws, { type: "note", title: "Head", body: "x\n" });

    const { status, body } = await diff(ws, doc.id, `?to=${EMPTY_TREE_OBJECT_ID}`);
    expect(status).toBe(400);
    expect(body.issues?.[0]?.path).toBe("query.to");
  });

  it("404s for an unknown document — never for an unknown revision", async () => {
    const ws = workspace("diff-unknown-doc");
    const { status, body } = await diff(ws, "doc_zzzzzzzz");
    expect(status).toBe(404);
    expect(body.code).toBe("not_found");
  });

  it("truncates a large change at a hunk boundary and says by how much", async () => {
    const ws = workspace("diff-truncate");
    const doc = await createDoc(ws, { type: "note", title: "Long", body: "seed\n" });
    ws.advance(60_000);
    // Distinct paragraphs separated by unchanged spacers, so git emits many
    // hunks rather than one enormous one.
    const long = Array.from(
      { length: 400 },
      (_, index) => `paragraph ${String(index)} ${"filler ".repeat(12)}`,
    ).join("\n\n");
    await ws.put(`/api/docs/${doc.id}`, { body: `${long}\n` }, { "x-corpus-author": "user" });

    const { status, body } = await diff(ws, doc.id);
    expect(status).toBe(200);
    expect(body.truncated).toBe(true);
    expect(body.diff.length).toBeLessThanOrEqual(DOC_DIFF_MAX_CHARS);
    expect(body.totalChars).toBeGreaterThan(DOC_DIFF_MAX_CHARS);
    // Still a diff: it starts with the file header and ends on a line boundary.
    expect(body.diff.startsWith("diff --git ")).toBe(true);
    expect(body.diff.endsWith("\n")).toBe(true);
    // The stats describe the whole change, not the part that fitted.
    expect(body.stats.insertions).toBeGreaterThan(400);
  });

  it("requires the workspace token like every other route", async () => {
    const ws = workspace("diff-auth");
    const doc = await createDoc(ws, { type: "note", title: "Guarded", body: "x\n" });
    const response = await ws.server.app.request(`/api/docs/${doc.id}/diff`, { headers: {} });
    expect(response.status).toBe(401);
  });
});
