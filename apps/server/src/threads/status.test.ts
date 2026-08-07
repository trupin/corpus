import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  threadFrontmatterOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("status");
});

afterEach(() => {
  ws.close();
});

/** Every invalidation frame the bus published while `run` was in flight. */
async function framesDuring(run: () => Promise<unknown>): Promise<QueryKey[][]> {
  const frames: QueryKey[][] = [];
  const unsubscribe = ws.server.bus.subscribe((keys) => frames.push([...keys]));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return frames;
}

describe("POST /api/threads/{id}/resolve and /reopen", () => {
  it("flips the status, commits once, and re-projects before responding", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "first" });
    // A different actor, so the squash window cannot fold this into the create.
    await appendTurn(ws, created.id, { body: "reply" }, "agent");
    const before = ws.log("%H").length;

    const response = await ws.post(`/api/threads/${created.id}/resolve`, {});
    const payload = (await response.json()) as {
      thread: { id: string; status: string; turnCount: number };
      warnings: unknown[];
    };

    expect(response.status).toBe(200);
    // The §14 envelope, not a bare summary: `{thread, warnings}`, mirroring
    // `DocMutationResponse` (CONTRACT-007's rider).
    expect(payload.thread).toMatchObject({ id: created.id, status: "resolved", turnCount: 2 });
    expect(payload.warnings).toEqual([]);
    expect(threadFrontmatterOf(ws, created.id)["status"]).toBe("resolved");
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.db.prepare("SELECT status FROM documents WHERE id = ?").get(created.id)).toEqual({
      status: "resolved",
    });
  });

  it("is idempotent and silent on a second call", async () => {
    const created = await createThread(ws, { body: "first" });
    await ws.post(`/api/threads/${created.id}/resolve`, {});
    const before = ws.log("%H").length;
    const text = ws.read(`data/threads/${created.id}.md`);

    const frames = await framesDuring(async () => {
      const again = await ws.post(`/api/threads/${created.id}/resolve`, {});
      expect(again.status).toBe(200);
      // A no-op wrote nothing, so it warns about nothing — and still answers the
      // envelope, because the shape does not depend on whether work happened.
      expect(await again.json()).toMatchObject({
        thread: { status: "resolved" },
        warnings: [],
      });
    });

    // Nothing written, nothing committed, nothing announced: the state the
    // caller asked for is the state that holds.
    expect(ws.read(`data/threads/${created.id}.md`)).toBe(text);
    expect(ws.log("%H")).toHaveLength(before);
    expect(frames).toEqual([]);
  });

  it("reopens a resolved thread and restores §8's re-trigger", async () => {
    const created = await createThread(ws, { body: "please look", requestsAgent: true });
    await appendTurn(ws, created.id, { body: "on it" }, "agent");
    expect(threadFrontmatterOf(ws, created.id)["agent"]).toBe("engaged");
    await ws.post(`/api/threads/${created.id}/resolve`, {});
    // The *agent's* turn is the one that leaves a resolved thread resolved and
    // silent (§8: a conversation the agent closes stays closed). A person's
    // reply would reopen it here — that is the reopen §8 grants replies, pinned
    // in `turns.test.ts`; this test is about the explicit verb.
    expect((await appendTurn(ws, created.id, { body: "quiet" }, "agent")).eventId).toBeNull();
    expect(threadFrontmatterOf(ws, created.id)["status"]).toBe("resolved");

    // Past the auto-commit's squash window, so this is a commit of its own
    // rather than an amend of the turn before it.
    ws.advance(31_000);
    const before = ws.log("%H").length;
    const response = await ws.post(`/api/threads/${created.id}/reopen`, {});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ thread: { status: "open" } });
    expect(threadFrontmatterOf(ws, created.id)["status"]).toBe("open");
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect((await appendTurn(ws, created.id, { body: "and now?" })).eventId).toMatch(/^evt_/);
  });

  it("announces the thread, its parent and the collection — and nothing else", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "first" });

    const frames = await framesDuring(() => ws.post(`/api/threads/${created.id}/resolve`, {}));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([
      ["docs"],
      ["docs", created.id],
      ["threads", created.id],
      ["docs", parent],
    ]);
  });

  it("answers 404 for an unknown thread", async () => {
    expect((await ws.post("/api/threads/th_zzzzzzzz/resolve", {})).status).toBe(404);
    expect((await ws.post("/api/threads/th_zzzzzzzz/reopen", {})).status).toBe(404);
  });

  it("is never refused by an edit lock: resolving is not editing", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "first" });
    expect((await ws.post(`/api/locks/${parent}`, {}, { "x-corpus-author": "agent" })).status).toBe(
      201,
    );
    expect((await ws.post(`/api/threads/${created.id}/resolve`, {})).status).toBe(200);
  });
});
