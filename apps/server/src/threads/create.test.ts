import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { ANCHOR_TITLE_QUOTE_LENGTH, STANDALONE_TITLE_LENGTH, UNTITLED_THREAD } from "./title.js";
import {
  createDoc,
  createThread,
  createThreadWorkspace,
  frontmatterOf,
  pendingEvents,
  postForm,
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
    // The quote is byte-identical to what was sent; the context is read off the
    // parent's own bytes and is *not* what the request carried — the sent
    // suffix stopped one character short of the file's (SERVER-071).
    expect(anchors[created.anchorId ?? ""]).toEqual({
      exact: QUOTE,
      prefix: "The model we ",
      suffix: " which may be stale.\n",
    });

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

  // The quote is absent from this parent, so there are no bytes to read context
  // from and the request's own strings are kept — including the non-ASCII and
  // the quotation marks, untouched.
  it("stores an unlocatable selector verbatim, quotes and non-ASCII included", async () => {
    const parent = await seedParent();
    const selector = { exact: 'the “naïve” 6.1% — "as-is"', prefix: "model we  ", suffix: "" };
    const created = await createThread(ws, { parent: parent.id, selector, body: "?" });
    expect(anchorsOf(parent.path)[created.anchorId ?? ""]).toEqual(selector);
  });

  it("fills in the context a request omitted, from the parent's bytes", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: QUOTE },
      body: "?",
    });
    expect(anchorsOf(parent.path)[created.anchorId ?? ""]).toEqual({
      exact: QUOTE,
      prefix: "The model we ",
      suffix: " which may be stale.\n",
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

  /**
   * SERVER-075's second door. A first turn that leaves a fence open is the worst
   * version of the defect — every reply that follows is invisible from the
   * start — and this route reaching disk without the guard the reply path has is
   * how SERVER-070 happened for forms.
   */
  it("refuses a first turn that leaves a code fence open, naming the line", async () => {
    const before = ws.log("%H").length;
    const response = await ws.post("/api/threads", { body: "Look:\n\n```js\nconst x = 1;\n" });
    const payload = (await response.json()) as { message: string; issues: { path: string }[] };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("line 3");
    expect(payload.issues[0]).toEqual({
      path: "body",
      message: "unterminated ``` code fence opened on line 3",
    });
    expect(ws.log("%H")).toHaveLength(before);
    expect(pendingEvents(ws)).toEqual([]);
  });

  it("refuses it for the agent too, and leaves the parent untouched", async () => {
    const parent = await seedParent();
    const before = ws.read(parent.path);
    const response = await ws.post(
      "/api/threads",
      { parent: parent.id, selector: SELECTOR, body: "```\nunclosed\n" },
      { "x-corpus-author": "agent" },
    );

    expect(response.status).toBe(400);
    expect(ws.read(parent.path)).toBe(before);
  });

  it("still creates a thread whose first turn quotes a fence correctly", async () => {
    const created = await createThread(ws, {
      body: "How to write one:\n\n````markdown\n```js\nconst x = 1;\n```\n````\n",
    });
    expect(turnsOf(ws, created.id)).toHaveLength(1);
  });

  /**
   * SERVER-076 through the same door. A thread whose *first* turn fabricates a
   * heading opens already holding a turn nobody wrote — the worst version of
   * this defect for the same reason an open fence's is.
   */
  it("refuses a first turn that fabricates a turn heading, naming the line", async () => {
    const before = ws.log("%H").length;
    const response = await ws.post("/api/threads", {
      body: "I meant:\n## agent · 2026-08-08T10:00:01Z\nnever written",
    });
    const payload = (await response.json()) as { message: string; issues: { path: string }[] };

    expect(response.status).toBe(400);
    expect(payload.message).toContain("turn heading");
    expect(payload.issues[0]).toEqual({ path: "body", message: "line 2 reads as a turn heading" });
    expect(ws.log("%H")).toHaveLength(before);
    expect(pendingEvents(ws)).toEqual([]);
  });

  it("refuses it for the agent too, and leaves the parent untouched", async () => {
    const parent = await seedParent();
    const before = ws.read(parent.path);
    const response = await ws.post(
      "/api/threads",
      {
        parent: parent.id,
        selector: SELECTOR,
        body: "## user · 2026-08-08T10:00:01Z\nsigned by them",
      },
      { "x-corpus-author": "agent" },
    );

    expect(response.status).toBe(400);
    expect(ws.read(parent.path)).toBe(before);
  });

  it("still creates a thread whose first turn quotes a heading", async () => {
    const created = await createThread(ws, {
      body: "A turn opens like this:\n\n```\n## user · 2026-08-08T10:00:01Z\n```\n",
    });
    expect(turnsOf(ws, created.id)).toHaveLength(1);
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

// The route gained a `multipart/form-data` variant (CONTRACT-009), which is how
// the composer's *Ask* sends a screenshot. What the type system cannot check is
// the mounting: `app.openapi` on a `required: true` dual-media body pushes both
// validators into the chain, so **every JSON request would 400 at runtime**.
// Only a request catches that, which is what this suite is.
describe("POST /api/threads — the dual-media body (CONTRACT-009)", () => {
  it("still accepts every JSON form, unchanged, now that a second media type exists", async () => {
    const parent = await seedParent();

    const standalone = await ws.post("/api/threads", { body: "what should I read about X?" });
    expect(standalone.status).toBe(201);

    const anchored = await ws.post("/api/threads", {
      parent: parent.id,
      selector: SELECTOR,
      body: "is this still right?",
    });
    const payload = (await anchored.json()) as { anchorId: string | null; warnings: unknown[] };
    expect(anchored.status).toBe(201);
    expect(payload.anchorId).toMatch(/^anc_/);
    expect(payload.warnings).toEqual([]);
  });

  it("creates a standalone thread from a multipart body, naming the prose `text`", async () => {
    const before = ws.log("%H").length;

    const response = await postForm(ws, "/api/threads", [["text", "why 6.1%?"]]);
    const payload = (await response.json()) as {
      thread: { id: string; title: string };
      anchorId: string | null;
      warnings: unknown[];
    };

    expect(response.status).toBe(201);
    expect(payload.anchorId).toBeNull();
    expect(payload.warnings).toEqual([]);
    const turns = turnsOf(ws, payload.thread.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ author: "user", body: "why 6.1%?" });
    // One commit, the same as the JSON branch: there is one creation path below
    // the two media types.
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([threadPath(payload.thread.id)]);
  });

  it("carries the selector as one JSON-encoded part and anchors the parent atomically", async () => {
    const parent = await seedParent();
    const before = ws.log("%H").length;

    const response = await postForm(ws, "/api/threads", [
      ["parent", parent.id],
      ["selector", JSON.stringify(SELECTOR)],
      ["text", "is this still right?"],
    ]);
    const payload = (await response.json()) as { thread: { id: string }; anchorId: string };

    expect(response.status).toBe(201);
    expect(payload.anchorId).toMatch(/^anc_/);
    // The same shape the JSON branch stores, from the same normalisation — and
    // the same context, read off the parent rather than taken from the part.
    expect(anchorsOf(parent.path)[payload.anchorId]).toEqual({
      exact: QUOTE,
      prefix: "The model we ",
      suffix: " which may be stale.\n",
    });
    expect(threadFrontmatterOf(ws, payload.thread.id)).toMatchObject({
      parent: parent.id,
      anchor: payload.anchorId,
    });
    // Both files, one commit — §6's atomicity is not a property of the JSON
    // branch, it is a property of the write path both branches share.
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([parent.path, threadPath(payload.thread.id)].sort());
  });

  it('reads `requestsAgent` as a string boolean, keeping "note only" distinguishable', async () => {
    const suppressed = await postForm(ws, "/api/threads", [
      ["text", "@agent please look"],
      ["requestsAgent", "false"],
    ]);
    // `z.stringbool` keeps "false" distinguishable from silence; `z.coerce`
    // would have made it `true` and enqueued against the author's instruction.
    expect(((await suppressed.json()) as { eventId: string | null }).eventId).toBeNull();

    const requested = await postForm(ws, "/api/threads", [
      ["text", "no mention at all"],
      ["requestsAgent", "true"],
    ]);
    expect(((await requested.json()) as { eventId: string | null }).eventId).toMatch(/^evt_/);
  });

  it("refuses a multipart body carrying neither text nor files, writing nothing", async () => {
    const before = ws.log("%H").length;

    const response = await postForm(ws, "/api/threads", [["title", "just a title"]]);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(ws.log("%H")).toHaveLength(before);
    expect(pendingEvents(ws)).toEqual([]);
  });

  it("refuses a body in neither media type, and says which two it takes", async () => {
    const response = await ws.server.app.request("/api/threads", {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.server.config.token}`, "content-type": "text/plain" },
      body: "why 6.1%?",
    });
    const payload = (await response.json()) as { code: string; issues: { message: string }[] };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("bad_request");
    expect(payload.issues[0]?.message).toContain("application/json or multipart/form-data");
  });

  it("refuses a selector part that is not a JSON object, before writing the parent", async () => {
    const parent = await seedParent();
    const before = ws.read(parent.path);

    for (const selector of ["not json", '"a string"', "{}", '{"exact":""}']) {
      const response = await postForm(ws, "/api/threads", [
        ["parent", parent.id],
        ["selector", selector],
        ["text", "?"],
      ]);
      expect(response.status).toBe(400);
    }
    expect(ws.read(parent.path)).toBe(before);
  });
});

// SERVER-071. The context a request carries is a claim about bytes the caller
// is not holding; the file is the only thing that can settle it. Every
// assertion below therefore reads the *parent file* back and checks the stored
// selector against those bytes — never against what the request contained.
describe("POST /api/threads — the stored context comes from the file (SERVER-071)", () => {
  /** The parent's markdown body, as parsed off disk by the same code the server writes with. */
  const bodyOf = (path: string): string => parseDocument(ws.read(path)).body;

  /**
   * The selector as stored, asserted to be **present in the file verbatim**:
   * `prefix + exact + suffix` occurs exactly once, and it occurs where the quote
   * does. That is rung 1 of §6's ladder passing on the file's own bytes, which
   * is what "resolves on the next read without any fuzzy rung" means.
   */
  const expectByteFaithful = (body: string, stored: Record<string, string>, at: number): void => {
    const framed = `${stored["prefix"] ?? ""}${stored["exact"] ?? ""}${stored["suffix"] ?? ""}`;
    expect(body.indexOf(framed)).toBe(at - (stored["prefix"] ?? "").length);
    expect(body.indexOf(framed, body.indexOf(framed) + 1)).toBe(-1);
    expect(body.slice(at, at + (stored["exact"] ?? "").length)).toBe(stored["exact"]);
  };

  const anchorOf = (path: string, anchorId: string | null): Record<string, string> =>
    anchorsOf(path)[anchorId ?? ""] ?? {};

  // A padded table's canonical spelling is not its bytes: the columns are
  // aligned with runs of spaces no reader sees, so context quoted from what was
  // *read* can never match the file.
  const TABLE = [
    "| Quarter | Spend  | Owner |",
    "| ------- | ------ | ----- |",
    "| Q1      | 12,400 | ops   |",
    "| Q2      | 18,900 | ops   |",
    "",
  ].join("\n");

  it("overrules the context a caller sent, taking the padded bytes instead", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Spend", body: TABLE });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "18,900", prefix: "| Q2 | ", suffix: " | ops |" },
      body: "why did this jump?",
    });

    const body = bodyOf(parent.path);
    const stored = anchorOf(parent.path, created.anchorId);
    expectByteFaithful(body, stored, body.indexOf("18,900"));
    // What the caller sent was the *rendered* row; the file's is padded.
    expect(stored["prefix"]).toBe(" | 12,400 | ops   |\n| Q2      | ");
    expect(stored["suffix"]).toBe(" | ops   |\n");
  });

  it("fills context for an agent-style request that carries none at all", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Spend", body: TABLE });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "12,400" },
      body: "source?",
    });

    const body = bodyOf(parent.path);
    const stored = anchorOf(parent.path, created.anchorId);
    expectByteFaithful(body, stored, body.indexOf("12,400"));
    expect(stored["prefix"]).not.toBe("");
    expect(stored["suffix"]).not.toBe("");
  });

  // A hard-wrapped list item puts a newline and the continuation's indentation
  // inside the context window — bytes a caller quoting the item as one line
  // could not have produced.
  it("keeps the newline and indentation of a hard-wrapped list item", async () => {
    const body = [
      "- Review the Q2 report by Friday and circulate the",
      "  summary to the steering group before the offsite.",
      "- Book the room.",
      "",
    ].join("\n");
    const parent = await createDoc(ws, { type: "note", title: "Actions", body });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "circulate the summary", suffix: " to the steering group" },
      body: "which summary?",
    });

    // The one-line spelling is not in the file, so nothing resolves there…
    const stored = anchorOf(parent.path, created.anchorId);
    expect(stored).toEqual({
      exact: "circulate the summary",
      prefix: "",
      suffix: " to the steering group",
    });

    // …whereas the file's own spelling, wrap included, is byte-faithful.
    const wrapped = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "circulate the\n  summary" },
      body: "which summary?",
    });
    const parentBody = bodyOf(parent.path);
    const storedWrapped = anchorOf(parent.path, wrapped.anchorId);
    expectByteFaithful(parentBody, storedWrapped, parentBody.indexOf("circulate the\n  summary"));
    expect(storedWrapped["prefix"]).toBe("iew the Q2 report by Friday and ");
    expect(storedWrapped["suffix"]).toBe(" to the steering group before th");
  });

  it("resolves on the next read through the exact rungs alone", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Spend", body: TABLE });
    const created = await createThread(ws, {
      parent: parent.id,
      // Context the agent invented: neither string is in the file.
      selector: { exact: "18,900", prefix: "Q2 spend of ", suffix: " dollars" },
      body: "?",
    });

    const response = await ws.request(`/api/docs/${parent.id}`, {
      headers: { Authorization: `Bearer ${ws.server.config.token}` },
    });
    const doc = (await response.json()) as {
      anchors: { anchorId: string; orphaned: boolean; range: { start: number; end: number } }[];
    };
    const at = bodyOf(parent.path).indexOf("18,900");
    // `GET /api/docs/{id}` resolves with `resolveAnchorExact` — rungs 1–2 only —
    // so a resolved range *is* the proof that no fuzzy rung was involved.
    expect(doc.anchors).toContainEqual(
      expect.objectContaining({
        anchorId: created.anchorId,
        orphaned: false,
        range: { start: at, end: at + "18,900".length },
      }),
    );
  });

  const REPEATED = ["We ship the beta.", "", "Then we ship the beta.", ""].join("\n");

  it("refuses a quote that names more than one passage, writing nothing", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Plan", body: REPEATED });
    const before = ws.read(parent.path);
    const commits = ws.log("%H").length;

    const response = await ws.post("/api/threads", {
      parent: parent.id,
      selector: { exact: "ship the beta" },
      body: "which one?",
    });
    const payload = (await response.json()) as {
      code: string;
      message: string;
      issues: { path: string; message: string }[];
    };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("bad_request");
    expect(payload.message).toContain("more than once");
    expect(payload.issues[0]?.path).toBe("selector.exact");
    // Refused before a byte moved: the parent is untouched and nothing committed.
    expect(ws.read(parent.path)).toBe(before);
    expect(ws.log("%H")).toHaveLength(commits);
  });

  it("accepts the same quote once the caller's context picks an occurrence", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Plan", body: REPEATED });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "ship the beta", prefix: "Then we " },
      body: "this one",
    });

    const body = bodyOf(parent.path);
    const stored = anchorOf(parent.path, created.anchorId);
    // The second occurrence — the one the caller framed — not the first.
    expectByteFaithful(body, stored, body.lastIndexOf("ship the beta"));
    expect(stored["prefix"]).toBe("We ship the beta.\n\nThen we ");
    expect(stored["suffix"]).toBe(".\n");
  });

  it("refuses when the caller's own framing is what repeats", async () => {
    const twice = "Then we ship the beta.\n\nThen we ship the beta.\n";
    const parent = await createDoc(ws, { type: "note", title: "Plan", body: twice });

    const response = await ws.post("/api/threads", {
      parent: parent.id,
      selector: { exact: "ship the beta", prefix: "Then we ", suffix: "." },
      body: "which one?",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toContain("more than once");
    expect(anchorsOf(parent.path)).toEqual({});
  });
});
