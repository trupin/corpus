import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  turnsOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

const QUOTE = "assume a 30-year fixed at 6.1%";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("read");
});

afterEach(() => {
  ws.close();
});

const get = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await ws.request(path, {
    headers: { Authorization: `Bearer ${ws.server.config.token}` },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe("GET /api/threads/{id}", () => {
  it("returns the thread and its turns, oldest first, matching the file", async () => {
    const parent = await createDoc(ws, {
      type: "note",
      title: "Mortgage model",
      body: `The model we ${QUOTE}.\n`,
    });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: QUOTE },
      body: "is this right?",
    });
    await appendTurn(ws, created.id, { body: "checked; 6.4% is closer" }, "agent");
    await appendTurn(ws, created.id, { body: "thanks" });

    const { status, body } = await get(`/api/threads/${created.id}`);
    const stamps = turnsOf(ws, created.id).map((turn) => turn.ts);

    expect(status).toBe(200);
    expect(body).toEqual({
      id: created.id,
      title: `Re: "${QUOTE}"`,
      created: stamps[0],
      updated: stamps[2],
      status: "open",
      tags: [],
      parent: parent.id,
      anchor: created.anchorId,
      agent: "none",
      turns: [
        { author: "user", ts: stamps[0], body: "is this right?" },
        { author: "agent", ts: stamps[1], body: "checked; 6.4% is closer" },
        { author: "user", ts: stamps[2], body: "thanks" },
      ],
    });
  });

  it("reports a resolved thread as resolved", async () => {
    const created = await createThread(ws, { body: "first" });
    await ws.post(`/api/threads/${created.id}/resolve`, {});
    expect((await get(`/api/threads/${created.id}`)).body["status"]).toBe("resolved");
  });

  it("answers 404 for an unknown thread", async () => {
    expect((await get("/api/threads/th_zzzzzzzz")).status).toBe(404);
  });

  // Anchor *context* is the parent document's surface, not the thread's: the
  // thread carries the anchor's id and `GET /api/docs/{parentId}` resolves it.
  it("hands anchor context to the parent's read, resolved against the current body", async () => {
    const parent = await createDoc(ws, {
      type: "note",
      title: "Mortgage model",
      body: `The model we ${QUOTE}.\n`,
    });
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: QUOTE, prefix: "The model we " },
      body: "is this right?",
    });

    const { body } = await get(`/api/docs/${parent.id}`);
    expect(body["anchors"]).toEqual([
      {
        anchorId: created.anchorId,
        // The suffix is the file's, not the request's: creation reads context
        // off the parent's bytes (SERVER-071), so the trailing `.` and newline
        // the request omitted are there.
        selector: { exact: QUOTE, prefix: "The model we ", suffix: ".\n" },
        threadId: created.id,
        threadStatus: "open",
        range: { start: 13, end: 13 + QUOTE.length },
        orphaned: false,
      },
    ]);
  });

  it("lists threads through the document collection, not a thread list route", async () => {
    const created = await createThread(ws, { body: "standalone" });
    const { body } = await get("/api/docs?type=thread");
    expect((body["items"] as { id: string }[]).map((doc) => doc.id)).toEqual([created.id]);
  });
});

// A read must not 500 on a thread nobody's server wrote. The turns are still
// there and the conversation is still a conversation; `doc check` is what
// reports the drift (§14), and every field falls back to something true.
describe("GET /api/threads/{id} — hand-written files", () => {
  it("fills the §6 fields a minimal file omits", async () => {
    ws.write(
      "data/threads/th_minimal.md",
      "---\nid: th_minimal\ntype: thread\ntitle: Hand written\n---\n" +
        "## user · 2026-07-19T10:05:00Z\nfirst\n\n## agent · 2026-07-19T10:07:00Z\nsecond\n",
    );
    ws.reproject();

    expect((await get("/api/threads/th_minimal")).body).toEqual({
      id: "th_minimal",
      title: "Hand written",
      // Neither stamp is in the file, so the turns answer: they are when the
      // conversation demonstrably happened.
      created: "2026-07-19T10:05:00Z",
      updated: "2026-07-19T10:07:00Z",
      status: "open",
      tags: [],
      parent: null,
      anchor: null,
      agent: "none",
      turns: [
        { author: "user", ts: "2026-07-19T10:05:00Z", body: "first" },
        { author: "agent", ts: "2026-07-19T10:07:00Z", body: "second" },
      ],
    });
  });

  it("ignores values that are the wrong shape rather than failing the read", async () => {
    ws.write(
      "data/threads/th_garbled.md",
      "---\nid: th_garbled\ntype: thread\ntitle: '   '\ncreated: not-an-instant\n" +
        "tags: nope\nstatus: archived\nparent: not-an-id\nanchor: nope\nagent: bogus\n---\n" +
        "## user · 2026-07-19T10:05:00Z\nonly turn\n",
    );
    ws.reproject();

    const { body } = await get("/api/threads/th_garbled");
    expect(body).toMatchObject({
      // A blank title is no title; the projection's row is the fallback.
      title: "th_garbled",
      created: "2026-07-19T10:05:00Z",
      updated: "2026-07-19T10:05:00Z",
      tags: [],
      parent: null,
      anchor: null,
      agent: "none",
      // `archived` is a document status, not a thread state: an archived thread
      // is still an unresolved conversation.
      status: "open",
    });
  });

  it("summarises a thread with no turns at all", async () => {
    ws.write(
      "data/threads/th_noturns.md",
      "---\nid: th_noturns\ntype: thread\ntitle: Empty\ncreated: 2026-07-19T10:05:00Z\n" +
        "updated: 2026-07-19T10:05:00Z\n---\nJust a preamble, no turn headings.\n",
    );
    ws.reproject();

    const response = await ws.post("/api/threads/th_noturns/resolve", {});
    expect(response.status).toBe(200);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      thread: {
        id: "th_noturns",
        turnCount: 0,
        // With no turns to date it, the summary falls back to the thread's own
        // `updated`, which resolving has just stamped.
        lastAuthor: "user",
        lastTs: "2026-07-27T09:00:00Z",
        status: "resolved",
      },
    });
  });
});
