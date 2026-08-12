import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_TURN_DELETE_MESSAGE } from "./cascade.js";
import {
  appendTurn,
  createDoc,
  putDoc,
  createThread,
  createThreadWorkspace,
  frontmatterOf,
  threadPath,
  turnsOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

const QUOTE = "assume a 30-year fixed at 6.1%";
const PARENT_BODY = `The model we ${QUOTE} which may be stale.\n`;

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("cascade");
});

afterEach(() => {
  ws.close();
});

const seedParent = async (): Promise<{ id: string; path: string }> =>
  createDoc(ws, { type: "note", title: "Mortgage model", body: PARENT_BODY });

const anchorsOf = (path: string): Record<string, unknown> =>
  (frontmatterOf(ws, path)["anchors"] ?? {}) as Record<string, unknown>;

const filesInHead = (): string[] =>
  ws
    .git("show", "--name-only", "--format=", "HEAD")
    .split("\n")
    .filter((line) => line !== "")
    .sort();

const del = (path: string, actor?: "user" | "agent"): Promise<Response> =>
  ws.del(path, actor === undefined ? {} : { "x-corpus-author": actor });

const encoded = (ts: string): string => encodeURIComponent(ts);

/** An anchored thread on a fresh parent, with `turns` turns. */
async function anchoredThread(turns: number): Promise<{
  parent: { id: string; path: string };
  id: string;
  anchorId: string;
  stamps: string[];
}> {
  const parent = await seedParent();
  const created = await createThread(ws, {
    parent: parent.id,
    selector: { exact: QUOTE },
    body: "turn 0",
  });
  for (let index = 1; index < turns; index += 1) {
    await appendTurn(ws, created.id, { body: `turn ${index}` });
  }
  return {
    parent,
    id: created.id,
    anchorId: created.anchorId ?? "",
    stamps: turnsOf(ws, created.id).map((turn) => turn.ts),
  };
}

describe("DELETE /api/threads/{id}/turns/{ts}", () => {
  it("keeps the thread and every other timestamp when a middle turn goes", async () => {
    const { parent, id, stamps } = await anchoredThread(3);
    // Past the auto-commit's squash window, so this is a commit of its own
    // rather than an amend of the turns that made the thread.
    ws.advance(31_000);
    const before = ws.log("%H").length;

    const response = await del(`/api/threads/${id}/turns/${encoded(stamps[1] ?? "")}`);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      deletedTurn: true,
      deletedThread: false,
      removedAnchor: null,
      parentId: parent.id,
    });
    // No renumbering: the stamp is the turn's identity.
    expect(turnsOf(ws, id).map((turn) => turn.ts)).toEqual([stamps[0], stamps[2]]);
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.db.prepare("SELECT ts FROM turns WHERE thread_id = ? ORDER BY idx").all(id)).toEqual([
      { ts: stamps[0] },
      { ts: stamps[2] },
    ]);
  });

  it("takes the thread and its anchor entry when the last turn goes", async () => {
    const { parent, id, anchorId, stamps } = await anchoredThread(1);
    // A second anchored thread, to prove only the right entry is removed.
    const sibling = await createThread(ws, {
      parent: parent.id,
      selector: { exact: "may be stale" },
      body: "sibling",
    });
    // Past the auto-commit's window, so this deletion is a commit of its own
    // rather than an amend of the setup above.
    ws.advance(31_000);
    const before = ws.log("%H").length;

    const response = await del(`/api/threads/${id}/turns/${encoded(stamps[0] ?? "")}`);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload).toMatchObject({
      deletedTurn: true,
      deletedThread: true,
      removedAnchor: anchorId,
      parentId: parent.id,
    });
    expect(ws.exists(threadPath(id))).toBe(false);
    expect(Object.keys(anchorsOf(parent.path))).toEqual([sibling.anchorId]);
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([parent.path, threadPath(id)].sort());
    expect(ws.db.prepare("SELECT count(*) AS n FROM threads WHERE id = ?").get(id)).toEqual({
      n: 0,
    });
    expect(
      ws.db.prepare("SELECT count(*) AS n FROM anchors WHERE anchor_id = ?").get(anchorId),
    ).toEqual({ n: 0 });
  });

  it("does no anchor work for a standalone thread's last turn", async () => {
    const created = await createThread(ws, { body: "only" });
    const stamps = turnsOf(ws, created.id).map((turn) => turn.ts);
    const before = ws.log("%H").length;

    const response = await del(`/api/threads/${created.id}/turns/${encoded(stamps[0] ?? "")}`);

    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      deletedThread: true,
      removedAnchor: null,
      parentId: null,
    });
    expect(ws.exists(threadPath(created.id))).toBe(false);
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([threadPath(created.id)]);
  });

  it("leaves a whole-document thread's parent byte-identical", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, { parent: parent.id, body: "only" });
    const parentText = ws.read(parent.path);
    const stamps = turnsOf(ws, created.id).map((turn) => turn.ts);

    const response = await del(`/api/threads/${created.id}/turns/${encoded(stamps[0] ?? "")}`);

    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      deletedThread: true,
      removedAnchor: null,
      parentId: parent.id,
    });
    expect(ws.read(parent.path)).toBe(parentText);
  });

  it("is user-only: an agent actor is refused and changes nothing", async () => {
    const { id, stamps } = await anchoredThread(2);
    const before = ws.read(threadPath(id));
    const commits = ws.log("%H").length;

    const response = await del(`/api/threads/${id}/turns/${encoded(stamps[0] ?? "")}`, "agent");
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe("forbidden");
    expect(payload.message).toBe(AGENT_TURN_DELETE_MESSAGE);
    expect(ws.read(threadPath(id))).toBe(before);
    expect(ws.log("%H")).toHaveLength(commits);

    expect((await del(`/api/threads/${id}/turns/${encoded(stamps[0] ?? "")}`, "user")).status).toBe(
      200,
    );
  });

  it("keeps what it deleted in git history (§6)", async () => {
    const { id, stamps } = await anchoredThread(1);
    const text = ws.read(threadPath(id));
    // Past the auto-commit's window, so the thread's creation has landed as a
    // commit before the deletion is asked for. A thread created and deleted
    // *inside* one window is the same guarantee reached the other way — §4's
    // "three acts commit alone", where the deletion closes the window first —
    // and it is asserted directly in `docs/acts.test.ts` (SERVER-092).
    ws.advance(31_000);
    await del(`/api/threads/${id}/turns/${encoded(stamps[0] ?? "")}`);
    expect(ws.git("show", `HEAD~1:${threadPath(id)}`)).toBe(text);
  });

  it("answers 404 for a timestamp no turn carries", async () => {
    const { id } = await anchoredThread(2);
    const response = await del(`/api/threads/${id}/turns/${encoded("2001-01-01T00:00:00Z")}`);
    expect(response.status).toBe(404);
  });

  it("answers 404 for an unknown thread", async () => {
    const response = await del(`/api/threads/th_zzzzzzzz/turns/${encoded("2026-07-27T09:00:00Z")}`);
    expect(response.status).toBe(404);
  });

  it("cascades while the other party is writing the parent: nothing refuses it", async () => {
    // The lock used to refuse this (sprint-006 Adjudication 1); SPEC.md §7
    // removed it, and a cascade names its own delta — the anchor entry it
    // removes — so it needs no key either (SERVER-099).
    const { parent, id, anchorId, stamps } = await anchoredThread(1);
    expect(
      (await putDoc(ws, parent.id, { body: "the agent writes on" }, { "x-corpus-author": "agent" }))
        .status,
    ).toBe(200);

    const response = await del(`/api/threads/${id}/turns/${encoded(stamps[0] ?? "")}`);

    expect(response.status).toBe(200);
    expect(ws.exists(threadPath(id))).toBe(false);
    expect(Object.keys(anchorsOf(parent.path))).not.toContain(anchorId);
  });
});

describe("DELETE /api/docs/{id} on a thread — the same cascade (Open Conflict 6)", () => {
  it("removes the thread file and its anchor entry in one commit", async () => {
    const { parent, id } = await anchoredThread(3);
    // Past the auto-commit's window, so this deletion is a commit of its own.
    ws.advance(31_000);
    const before = ws.log("%H").length;

    const response = await del(`/api/docs/${id}`);
    const payload = (await response.json()) as { deletedId: string; orphanedThreadIds: string[] };

    expect(response.status).toBe(200);
    expect(payload.deletedId).toBe(id);
    expect(ws.exists(threadPath(id))).toBe(false);
    expect(Object.keys(anchorsOf(parent.path))).toEqual([]);
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(filesInHead()).toEqual([parent.path, threadPath(id)].sort());
  });

  it("is user-only", async () => {
    const { id } = await anchoredThread(1);
    expect((await del(`/api/docs/${id}`, "agent")).status).toBe(403);
    expect(ws.exists(threadPath(id))).toBe(true);
  });

  // SERVER-005's branch, which this must not have overwritten: deleting a
  // *document* leaves its threads as orphaned records rather than deleting them.
  it("still orphans a plain document's threads instead of cascading to them", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, {
      parent: parent.id,
      selector: { exact: QUOTE },
      body: "hello",
    });

    const response = await del(`/api/docs/${parent.id}`);
    const payload = (await response.json()) as { orphanedThreadIds: string[] };

    expect(payload.orphanedThreadIds).toEqual([created.id]);
    expect(ws.exists(threadPath(created.id))).toBe(true);
  });
});
