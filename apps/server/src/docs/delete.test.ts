import { DeleteDocResultSchema, DocListSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const THREAD_ID = "th_orphan01";

async function withParentedThread(name: string): Promise<{ id: string; path: string }> {
  ws = createWriteWorkspace(name);
  ws.reproject();
  const created = await createDoc(ws, { type: "note", title: "Doomed", body: "content" });
  ws.write(
    `data/threads/${THREAD_ID}.md`,
    [
      "---",
      `id: ${THREAD_ID}`,
      "type: thread",
      "title: Still here",
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
      "## user · 2026-07-01T00:00:00Z",
      "",
      "A conversation nobody asked to delete.",
      "",
    ].join("\n"),
  );
  ws.reproject();
  ws.advance(60_000);
  return created;
}

describe("DELETE /api/docs/{id}", () => {
  it("refuses an agent actor and leaves everything in place", async () => {
    const created = await withParentedThread("delete-agent");
    const head = ws.head();

    const response = await ws.del(`/api/docs/${created.id}`, { "x-corpus-author": "agent" });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("forbidden");
    expect(body.message).toContain("the agent archives, never deletes");

    expect(ws.exists(created.path)).toBe(true);
    expect(ws.db.prepare("SELECT id FROM documents WHERE id = ?").get(created.id)).toBeDefined();
    expect(ws.head()).toBe(head);
  });

  it("lets a user delete, keeps history, and orphans the threads without touching them", async () => {
    const created = await withParentedThread("delete-user");
    const threadBefore = ws.read(`data/threads/${THREAD_ID}.md`);

    const response = await ws.del(`/api/docs/${created.id}`);
    expect(response.status).toBe(200);
    const result = DeleteDocResultSchema.parse(await response.json());
    expect(result).toEqual({
      deletedId: created.id,
      orphanedThreadIds: [THREAD_ID],
      warnings: [],
    });

    expect(ws.exists(created.path)).toBe(false);
    expect(ws.db.prepare("SELECT id FROM documents WHERE id = ?").get(created.id)).toBeUndefined();

    // git retains the file and every version of it.
    const deletion = ws.git("log", "--diff-filter=D", "--format=%an|%s", "--", created.path).trim();
    expect(deletion).toContain("Corpus User|doc delete: Doomed");
    const shas = ws.git("log", "--format=%H", "--", created.path).trim().split("\n");
    expect(ws.git("show", `${shas[1] ?? ""}:${created.path}`)).toContain("content");

    // Nothing cascaded: the thread's file, row and dangling parent all survive.
    expect(ws.read(`data/threads/${THREAD_ID}.md`)).toBe(threadBefore);
    const thread = ws.db.prepare("SELECT parent_id FROM threads WHERE id = ?").get(THREAD_ID) as {
      parent_id: string;
    };
    expect(thread.parent_id).toBe(created.id);

    const listed = await ws.request("/api/docs?type=thread");
    const payload = DocListSchema.parse(await listed.json());
    expect(payload.items.map((item) => item.id)).toContain(THREAD_ID);
  });

  it("defaults to the user actor when no header is sent", async () => {
    const created = await withParentedThread("delete-default-actor");

    const response = await ws.del(`/api/docs/${created.id}`);
    expect(response.status).toBe(200);
    expect(ws.log("%an")[0]).toBe("Corpus User");
  });

  it("ignores a header this API does not declare", async () => {
    const created = await withParentedThread("delete-unknown-header");

    // `X-Corpus-Actor` is not a header of this API, so a request carrying it is
    // a request with no actor header — authored by `user`, not rejected.
    const response = await ws.del(`/api/docs/${created.id}`, { "X-Corpus-Actor": "agent" });
    expect(response.status).toBe(200);
    expect(ws.log("%an")[0]).toBe("Corpus User");
  });

  it("404s an unknown id and 400s a malformed one", async () => {
    ws = createWriteWorkspace("delete-ids");
    ws.reproject();

    expect((await ws.del("/api/docs/doc_zzzzzzzz")).status).toBe(404);
    const malformed = await ws.del("/api/docs/not-an-id");
    expect(malformed.status).toBe(400);
    const body = (await malformed.json()) as { issues: unknown[] };
    expect(body.issues.length).toBeGreaterThan(0);
  });
});
