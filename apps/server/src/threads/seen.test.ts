import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueryKey } from "@corpus/contract";
import { movesForward, readSeenMarks } from "./seen.js";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  turnsOf,
  type WriteWorkspace,
} from "./thread-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("seen");
});

afterEach(() => {
  ws.close();
});

const seenPath = (): string => join(ws.root, ".corpus", "seen.json");

const seenFile = (): Record<string, string> =>
  JSON.parse(ws.read(".corpus/seen.json")) as Record<string, string>;

const seenRows = (): { thread_id: string; last_seen_ts: string }[] =>
  ws.db.prepare("SELECT thread_id, last_seen_ts FROM seen ORDER BY thread_id").all() as {
    thread_id: string;
    last_seen_ts: string;
  }[];

/** A thread with three turns at distinct stamps. */
async function threeTurns(): Promise<{ id: string; stamps: string[] }> {
  const created = await createThread(ws, { body: "t0" });
  await appendTurn(ws, created.id, { body: "t1" });
  await appendTurn(ws, created.id, { body: "t2" });
  return { id: created.id, stamps: turnsOf(ws, created.id).map((turn) => turn.ts) };
}

describe("POST /api/threads/{id}/seen", () => {
  it("marks a bare POST at the last turn and projects it before responding", async () => {
    const { id, stamps } = await threeTurns();

    const response = await ws.post(`/api/threads/${id}/seen`, {});
    const payload = (await response.json()) as { lastSeenTs: string; unread: boolean };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ threadId: id, lastSeenTs: stamps.at(-1), unread: false });
    expect(seenFile()).toEqual({ [id]: stamps.at(-1) });
    // No sleep, no watcher: read-your-write (§9.1).
    expect(seenRows()).toEqual([{ thread_id: id, last_seen_ts: stamps.at(-1) }]);
  });

  it("accepts a request with no body at all", async () => {
    const { id, stamps } = await threeTurns();
    const response = await ws.server.app.request(`/api/threads/${id}/seen`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.server.config.token}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as { lastSeenTs: string }).toMatchObject({
      lastSeenTs: stamps.at(-1),
    });
  });

  it("records a partial read, and never moves a mark backwards (§7)", async () => {
    const { id, stamps } = await threeTurns();
    await ws.post(`/api/threads/${id}/seen`, {});

    const older = await ws.post(`/api/threads/${id}/seen`, { lastSeenTs: stamps[1] });
    expect((await older.json()) as { lastSeenTs: string }).toMatchObject({
      lastSeenTs: stamps.at(-1),
    });
    expect(seenFile()[id]).toBe(stamps.at(-1));

    const equal = await ws.post(`/api/threads/${id}/seen`, { lastSeenTs: stamps.at(-1) });
    expect(equal.status).toBe(200);
    expect(seenFile()[id]).toBe(stamps.at(-1));
  });

  it("honours a partial mark on a thread with no mark yet", async () => {
    const { id, stamps } = await threeTurns();
    await ws.post(`/api/threads/${id}/seen`, { lastSeenTs: stamps[1] });
    expect(seenFile()[id]).toBe(stamps[1]);
  });

  it("makes no commit — read state is runtime state, not corpus (§7)", async () => {
    const { id } = await threeTurns();
    const before = ws.log("%H").length;

    await ws.post(`/api/threads/${id}/seen`, {});
    const second = await createThread(ws, { body: "another" });
    await ws.post(`/api/threads/${second.id}/seen`, {});

    expect(ws.log("%H")).toHaveLength(before + 1); // the second thread's creation, only
    expect(ws.git("status", "--porcelain")).toBe("");
    expect(ws.git("log", "--all", "--name-only", "--format=")).not.toContain("seen.json");
  });

  it("keeps other threads' marks when one is written", async () => {
    const first = await threeTurns();
    const second = await createThread(ws, { body: "second thread" });
    await ws.post(`/api/threads/${first.id}/seen`, {});
    await ws.post(`/api/threads/${second.id}/seen`, {});

    expect(Object.keys(seenFile()).sort()).toEqual([first.id, second.id].sort());
    expect(seenRows()).toHaveLength(2);
  });

  it("announces the thread, the collection and the parent", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const created = await createThread(ws, { parent, body: "first" });

    const frames: QueryKey[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => frames.push(keys.map((key) => [...key])));
    await ws.post(`/api/threads/${created.id}/seen`, {});
    unsubscribe();

    expect(frames).toEqual([[["docs"], ["threads", created.id], ["docs", parent]]]);
  });

  it("answers 404 for an unknown thread and writes nothing", async () => {
    const response = await ws.post("/api/threads/th_zzzzzzzz/seen", {});
    expect(response.status).toBe(404);
    expect(ws.exists(".corpus/seen.json")).toBe(false);
  });

  it("recovers from a corrupt file rather than refusing to record a read", async () => {
    const { id, stamps } = await threeTurns();
    writeFileSync(seenPath(), "{ not json", "utf8");

    expect((await ws.post(`/api/threads/${id}/seen`, {})).status).toBe(200);
    expect(seenFile()).toEqual({ [id]: stamps.at(-1) });
  });
});

describe("readSeenMarks", () => {
  it("is empty when the file does not exist", () => {
    expect(readSeenMarks(join(ws.root, ".corpus"))).toEqual({});
  });

  it.each([
    ["unparseable", "{ nope"],
    ["a list", "[]"],
    ["null", "null"],
  ])("reads %s as no marks", (_label, content) => {
    writeFileSync(seenPath(), content, "utf8");
    expect(readSeenMarks(join(ws.root, ".corpus"))).toEqual({});
  });

  it("drops entries that are not a thread id mapped to an instant", () => {
    writeFileSync(
      seenPath(),
      JSON.stringify({
        th_a1b2c3d4: "2026-07-19T10:05:00Z",
        doc_a1b2c3: "2026-07-19T10:05:00Z",
        th_bad: 7,
        th_e5f6g7h8: "not an instant",
      }),
      "utf8",
    );
    expect(readSeenMarks(join(ws.root, ".corpus"))).toEqual({
      th_a1b2c3d4: "2026-07-19T10:05:00Z",
    });
  });

  it("normalises what a hand-written file spells differently", () => {
    writeFileSync(seenPath(), JSON.stringify({ th_a1b2c3d4: "2026-07-19T12:05:00+02:00" }), "utf8");
    expect(readSeenMarks(join(ws.root, ".corpus"))).toEqual({
      th_a1b2c3d4: "2026-07-19T10:05:00Z",
    });
  });
});

describe("movesForward", () => {
  it.each([
    [undefined, "2026-07-19T10:05:00Z", true],
    ["2026-07-19T10:05:00Z", "2026-07-19T10:06:00Z", true],
    ["2026-07-19T10:05:00Z", "2026-07-19T10:05:00Z", false],
    ["2026-07-19T10:05:00Z", "2026-07-19T10:04:00Z", false],
    // An unreadable mark on record cannot be compared, so the new one wins.
    ["nonsense", "2026-07-19T10:05:00Z", true],
  ])("%s → %s is %s", (current, candidate, expected) => {
    expect(movesForward(current, candidate)).toBe(expected);
  });
});
