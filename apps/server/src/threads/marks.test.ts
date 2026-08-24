import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { movesForward, readSeenMarks } from "./marks.js";
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
  ws = createThreadWorkspace("marks");
});

afterEach(() => {
  ws.close();
});

const seenPath = (): string => join(ws.root, ".corpus", "seen.json");

const corpusDir = (): string => join(ws.root, ".corpus");

/** `GET /api/threads/{id}` — the resource `unread` now rides on (CONTRACT-036). */
async function readThread(id: string): Promise<{ unread: boolean; parent: string | null }> {
  const response = await ws.request(`/api/threads/${id}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { unread: boolean; parent: string | null };
}

/** What `GET /api/docs` says about the same thread, for the agreement checks. */
async function unreadInCollection(id: string): Promise<boolean | null> {
  const response = await ws.request("/api/docs?type=thread");
  const payload = (await response.json()) as { items: { id: string; unread: boolean | null }[] };
  return payload.items.find((row) => row.id === id)?.unread ?? null;
}

describe("readSeenMarks", () => {
  it("is empty when the file does not exist", () => {
    expect(readSeenMarks(corpusDir())).toEqual({});
  });

  it.each([
    ["unparseable", "{ nope"],
    ["a list", "[]"],
    ["null", "null"],
  ])("reads %s as no marks", (_label, content) => {
    writeFileSync(seenPath(), content, "utf8");
    expect(readSeenMarks(corpusDir())).toEqual({});
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
    expect(readSeenMarks(corpusDir())).toEqual({
      th_a1b2c3d4: "2026-07-19T10:05:00Z",
    });
  });

  it("normalises what a hand-written file spells differently", () => {
    writeFileSync(seenPath(), JSON.stringify({ th_a1b2c3d4: "2026-07-19T12:05:00+02:00" }), "utf8");
    expect(readSeenMarks(corpusDir())).toEqual({
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

/**
 * The falsification CONTRACT-036 asks for: the caller lists **nothing**, so an
 * implementation that took the answer from a `?parent=` row, from a browser
 * record of the marks this tab sent, or from the `turns` array in hand cannot
 * produce it.
 */
describe("GET /api/threads/{id} reports unread from the server-side mark", () => {
  it("goes back to true when another author speaks after the mark", async () => {
    const parent = await createDoc(ws, { type: "note", title: "Parent", body: "body" });
    const { id } = await createThread(ws, { parent: parent.id, body: "first" }, "user");

    expect((await readThread(id)).unread).toBe(true);

    expect((await ws.post(`/api/threads/${id}/seen`, {})).status).toBe(200);
    expect((await readThread(id)).unread).toBe(false);

    // Nothing is listed between the mark and the read: the route answers alone.
    await appendTurn(ws, id, { body: "and another thing" }, "agent");
    expect((await readThread(id)).unread).toBe(true);
  });

  it("answers for a standalone thread, which no listing can ever return", async () => {
    const { id } = await createThread(ws, { body: "ask" }, "user");
    expect((await readThread(id)).parent).toBeNull();
    expect((await readThread(id)).unread).toBe(true);

    expect((await ws.post(`/api/threads/${id}/seen`, {})).status).toBe(200);
    expect((await readThread(id)).unread).toBe(false);

    await appendTurn(ws, id, { body: "an answer" }, "agent");
    expect((await readThread(id)).unread).toBe(true);
  });

  it("reads true on a partial mark, exactly as the row and the mark itself do", async () => {
    const { id } = await createThread(ws, { body: "t0" }, "user");
    await appendTurn(ws, id, { body: "t1" }, "agent");
    await appendTurn(ws, id, { body: "t2" }, "agent");
    const stamps = turnsOf(ws, id).map((turn) => turn.ts);

    const marked = await ws.post(`/api/threads/${id}/seen`, { lastSeenTs: stamps[0] });
    expect(((await marked.json()) as { unread: boolean }).unread).toBe(true);

    expect((await readThread(id)).unread).toBe(true);
    expect(await unreadInCollection(id)).toBe(true);

    expect((await ws.post(`/api/threads/${id}/seen`, { lastSeenTs: stamps.at(-1) })).status).toBe(
      200,
    );
    expect((await readThread(id)).unread).toBe(false);
    expect(await unreadInCollection(id)).toBe(false);
  });

  /**
   * The mark file is runtime state a person can edit or delete. An absent mark
   * is *nothing seen*, not *nothing to see*, and a corrupt file is the same —
   * `readSeenMarks` drops it and the badge lights rather than the read failing.
   */
  it("treats an unreadable mark file as no mark at all", async () => {
    const { id } = await createThread(ws, { body: "t0" }, "user");
    expect((await ws.post(`/api/threads/${id}/seen`, {})).status).toBe(200);
    expect((await readThread(id)).unread).toBe(false);

    writeFileSync(seenPath(), "{ not json", "utf8");
    expect((await readThread(id)).unread).toBe(true);
  });

  /**
   * `POST /api/threads` returns the thread it just made, through the same
   * shaper. A brand-new thread has never been marked, so the field is `true`
   * there too rather than a constructor's `false`.
   */
  it("is true on the thread the create route hands back", async () => {
    const created = await createThread(ws, { body: "brand new" }, "user");
    expect(created.thread["unread"]).toBe(true);
  });
});
