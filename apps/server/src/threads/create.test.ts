import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANCHOR_TITLE_QUOTE_LENGTH, STANDALONE_TITLE_LENGTH, UNTITLED_THREAD } from "./title.js";
import {
  createDoc,
  createThread,
  createThreadWorkspace,
  frontmatterOf,
  pendingEvents,
  threadFrontmatterOf,
  threadPath,
  turnsOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

const QUOTE = "assume a 30-year fixed at 6.1%";
const PARENT_BODY = `The model we ${QUOTE} which may be stale.\n`;
const SELECTOR = { exact: QUOTE, prefix: "The model we ", suffix: " which may be stale" };

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("create");
});

afterEach(() => {
  ws.close();
});

const seedParent = async (): Promise<{ id: string; path: string }> =>
  createDoc(ws, { type: "note", title: "Mortgage model", body: PARENT_BODY });

/** Files a commit touched, newest commit first. */
const filesInHead = (): string[] =>
  ws
    .git("show", "--name-only", "--format=", "HEAD")
    .split("\n")
    .filter((line) => line !== "")
    .sort();

const anchorsOf = (path: string): Record<string, Record<string, string>> =>
  (frontmatterOf(ws, path)["anchors"] ?? {}) as Record<string, Record<string, string>>;

describe("POST /api/threads — anchored creation", () => {
  it("writes both files in one commit and answers with the anchor", async () => {
    const parent = await seedParent();
    const before = ws.log("%H").length;

    const created = await createThread(ws, {
      parent: parent.id,
      selector: SELECTOR,
      body: "is this still right?",
    });

    expect(created.anchorId).toMatch(/^anc_[0-9a-f]{8}$/);
    expect(created.eventId).toBeNull();
    expect(ws.exists(threadPath(created.id))).toBe(true);

    const anchors = anchorsOf(parent.path);
    expect(Object.keys(anchors)).toEqual([created.anchorId]);
    // Byte-identical to what was sent: the selection was captured from the real
    // body and the resolver matches on those exact characters.
    expect(anchors[created.anchorId ?? ""]).toEqual(SELECTOR);

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([parent.path, threadPath(created.id)].sort());
  });

  it("writes the §6 frontmatter and exactly one turn", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, {
      parent: parent.id,
      selector: SELECTOR,
      body: "is this still right?",
    });

    const frontmatter = threadFrontmatterOf(ws, created.id);
    expect(frontmatter).toMatchObject({
      id: created.id,
      type: "thread",
      status: "open",
      parent: parent.id,
      anchor: created.anchorId,
      agent: "none",
      tags: [],
    });
    expect(frontmatter["title"]).toBe(`Re: "${QUOTE}"`);
    expect(frontmatter["created"]).toBe(frontmatter["updated"]);

    const turns = turnsOf(ws, created.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ author: "user", body: "is this still right?" });
    expect(ws.read(threadPath(created.id))).toContain(`## user · ${turns[0]?.ts ?? ""}`);
  });

  it("stores a selector verbatim, quotes and non-ASCII included", async () => {
    const parent = await seedParent();
    const selector = { exact: 'the “naïve” 6.1% — "as-is"', prefix: "model we  ", suffix: "" };
    const created = await createThread(ws, { parent: parent.id, selector, body: "?" });
    expect(anchorsOf(parent.path)[created.anchorId ?? ""]).toEqual(selector);
  });

  it("stores absent context as the empty string the contract documents", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: QUOTE },
      body: "?",
    });
    expect(anchorsOf(parent.path)[created.anchorId ?? ""]).toEqual({
      exact: QUOTE,
      prefix: "",
      suffix: "",
    });
  });

  // §6 resolves anchors at projection/render time; an unresolvable one is
  // *orphaned*, which is a normal state of a living corpus, not a bad request.
  it("creates the thread even when the quote is absent from the parent", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "text that is not there" },
      body: "?",
    });

    const response = await ws.request(`/api/docs/${parent.id}`, {
      headers: { Authorization: `Bearer ${ws.server.config.token}` },
    });
    const doc = (await response.json()) as { anchors: { anchorId: string; orphaned: boolean }[] };
    expect(doc.anchors).toContainEqual(
      expect.objectContaining({ anchorId: created.anchorId, orphaned: true, range: null }),
    );
    // …and the save said so, rather than letting it pass silently (§14).
    expect(created.warnings.map((warning) => warning.code)).toContain("orphaned_anchor");
  });

  it("mints distinct anchor ids for concurrent comments on one document", async () => {
    const parent = await seedParent();
    const created = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        createThread(ws, {
          parent: parent.id,
          selector: { exact: QUOTE, prefix: `${index}` },
          body: `comment ${index}`,
        }),
      ),
    );

    const ids = created.map((thread) => thread.anchorId);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(id).toMatch(/^anc_[0-9a-f]{8}$/);
    // Every entry survived: ten read-modify-writes of one `anchors` map queued
    // in the parent's lane rather than overwriting each other.
    expect(Object.keys(anchorsOf(parent.path)).sort()).toEqual([...ids].sort());
    expect(new Set(created.map((thread) => thread.id)).size).toBe(10);
  });
});

describe("POST /api/threads — whole-document and standalone creation", () => {
  it("writes no anchor for a whole-document thread", async () => {
    const parent = await seedParent();
    const anchored = await createThread(ws, {
      parent: parent.id,
      selector: SELECTOR,
      body: "anchored",
    });
    const parentBefore = ws.read(parent.path);
    const before = ws.log("%H").length;

    const created = await createThread(ws, { parent: parent.id, body: "general note" });

    expect(created.anchorId).toBeNull();
    expect(threadFrontmatterOf(ws, created.id)).toMatchObject({
      parent: parent.id,
      anchor: null,
    });
    expect(ws.read(parent.path)).toBe(parentBefore);
    expect(Object.keys(anchorsOf(parent.path))).toEqual([anchored.anchorId]);
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([threadPath(created.id)]);
  });

  it("creates a standalone thread with neither parent nor anchor", async () => {
    const before = ws.log("%H").length;
    const created = await createThread(ws, { body: "what should I read about X?" });

    expect(created.anchorId).toBeNull();
    expect(threadFrontmatterOf(ws, created.id)).toMatchObject({ parent: null, anchor: null });
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([threadPath(created.id)]);
  });

  it("treats explicit nulls exactly as omissions", async () => {
    const created = await createThread(ws, { parent: null, selector: null, body: "asking" });
    expect(threadFrontmatterOf(ws, created.id)).toMatchObject({ parent: null, anchor: null });
  });

  it("lets a thread parent a thread — recursion is the same path (§6)", async () => {
    const parent = await seedParent();
    const first = await createThread(ws, { parent: parent.id, body: "top" });
    const child = await createThread(ws, { parent: first.id, body: "sub-question" });
    expect(threadFrontmatterOf(ws, child.id)["parent"]).toBe(first.id);
  });
});

describe("POST /api/threads — refusals", () => {
  it("answers 404 for an unknown parent, writing nothing", async () => {
    const before = ws.log("%H").length;
    const response = await ws.post("/api/threads", { parent: "doc_zzzzzz", body: "hello" });
    expect(response.status).toBe(404);
    expect(ws.log("%H")).toHaveLength(before);
    expect(pendingEvents(ws)).toEqual([]);
  });

  it("refuses a whitespace-only quote", async () => {
    const parent = await seedParent();
    const before = ws.read(parent.path);
    const response = await ws.post("/api/threads", {
      parent: parent.id,
      selector: { exact: "   ", prefix: "", suffix: "" },
      body: "hello",
    });
    const payload = (await response.json()) as { issues: { path: string }[] };
    expect(response.status).toBe(400);
    expect(payload.issues[0]?.path).toBe("selector.exact");
    expect(ws.read(parent.path)).toBe(before);
  });

  it("refuses a selector with no document to anchor it to", async () => {
    const response = await ws.post("/api/threads", {
      parent: null,
      selector: SELECTOR,
      body: "hello",
    });
    const payload = (await response.json()) as { issues: { path: string }[] };
    expect(response.status).toBe(400);
    expect(payload.issues[0]?.path).toBe("selector");
  });

  it("refuses an empty first turn before anything is written", async () => {
    const parent = await seedParent();
    const before = ws.log("%H").length;
    const response = await ws.post("/api/threads", { parent: parent.id, body: "" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(ws.log("%H")).toHaveLength(before);
  });
});

describe("POST /api/threads — atomicity", () => {
  // Real fault injection, no mocks: `data/threads` becomes a *file*, so the
  // second write of the plan fails at `mkdir`. §6 forbids the state this would
  // otherwise leave — an anchor entry naming a thread that was never written.
  it("restores the parent when the thread file cannot be written", async () => {
    const parent = await seedParent();
    const parentBefore = ws.read(parent.path);
    const before = ws.log("%H").length;

    rmSync(join(ws.root, "data", "threads"), { recursive: true, force: true });
    writeFileSync(join(ws.root, "data", "threads"), "not a directory", "utf8");

    const response = await ws.post("/api/threads", {
      parent: parent.id,
      selector: SELECTOR,
      body: "is this still right?",
    });

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(ws.read(parent.path)).toBe(parentBefore);
    expect(ws.log("%H")).toHaveLength(before);
    expect(ws.db.prepare("SELECT count(*) AS n FROM threads").get()).toEqual({ n: 0 });
  });
});

describe("POST /api/threads — titles", () => {
  it("derives the anchored title from the quote, truncated", async () => {
    const parent = await seedParent();
    const exact = "z".repeat(120);
    const created = await createThread(ws, { parent: parent.id, selector: { exact }, body: "?" });
    expect(threadFrontmatterOf(ws, created.id)["title"]).toBe(
      `Re: "${"z".repeat(ANCHOR_TITLE_QUOTE_LENGTH)}"`,
    );
  });

  it("derives the whole-document title from the parent", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, { parent: parent.id, body: "general note" });
    expect(threadFrontmatterOf(ws, created.id)["title"]).toBe("Re: Mortgage model");
  });

  it("derives the standalone title from the first turn, truncated", async () => {
    const created = await createThread(ws, { body: `${"y".repeat(120)}\nsecond line` });
    expect(threadFrontmatterOf(ws, created.id)["title"]).toBe("y".repeat(STANDALONE_TITLE_LENGTH));
  });

  it("falls back when the first turn has no prose", async () => {
    const created = await createThread(ws, { body: "```\n```" });
    expect(threadFrontmatterOf(ws, created.id)["title"]).toBe(UNTITLED_THREAD);
  });

  it("lets an explicit title win", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, {
      parent: parent.id,
      selector: SELECTOR,
      title: "Chosen",
      body: "?",
    });
    expect(threadFrontmatterOf(ws, created.id)["title"]).toBe("Chosen");
  });
});

describe("POST /api/threads — the edit lock (sprint-006 Adjudication 1)", () => {
  const lock = async (docId: string): Promise<Response> =>
    ws.post(`/api/locks/${docId}`, {}, { "x-corpus-author": "agent" });

  it("refuses anchored creation while the other party holds the parent's lock", async () => {
    const parent = await seedParent();
    expect((await lock(parent.id)).status).toBe(201);

    const response = await ws.post("/api/threads", {
      parent: parent.id,
      selector: SELECTOR,
      body: "?",
    });
    expect(response.status).toBe(423);
    expect(Object.keys(anchorsOf(parent.path))).toEqual([]);
  });

  it("never refuses a comment that does not write the parent", async () => {
    const parent = await seedParent();
    expect((await lock(parent.id)).status).toBe(201);

    expect((await ws.post("/api/threads", { parent: parent.id, body: "note" })).status).toBe(201);
    expect((await ws.post("/api/threads", { body: "standalone" })).status).toBe(201);
  });
});
