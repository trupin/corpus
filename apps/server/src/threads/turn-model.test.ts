// SERVER-074 — which model wrote an agent turn, written, projected, and kept
// honest (SPEC.md §6, §11; CONTRACT-043).
//
// Driven through the real app against a real workspace, because every claim
// here is about bytes: what lands in the thread file's frontmatter, what a
// reader gets back, what the projection holds, and — the sharp one — what is
// *not* there after a turn is deleted and its timestamp reused.

import { TURN_MODELS_FRONTMATTER_KEY } from "@corpus/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTurn,
  createThread,
  createThreadWorkspace,
  threadFrontmatterOf,
  threadPath,
  type WriteWorkspace,
} from "./thread-fixture.js";

const OPUS = "claude-opus-4-1";
const HAIKU = "claude-haiku-4-5";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("turn-model");
});

afterEach(() => {
  ws.close();
});

/** The recorded map as it stands on disk, `{}` when the file carries no key. */
const recordOf = (id: string): Record<string, unknown> =>
  (threadFrontmatterOf(ws, id)[TURN_MODELS_FRONTMATTER_KEY] as Record<string, unknown>) ?? {};

/** Every turn of a thread as `GET /api/threads/{id}` reports it. */
async function readTurns(id: string): Promise<{ author: string; ts: string; model: unknown }[]> {
  const response = await ws.request(`/api/threads/${id}`, {
    headers: { Authorization: `Bearer ${ws.server.config.token}` },
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as {
    turns: { author: string; ts: string; model: unknown }[];
  };
  return payload.turns;
}

/** The projected `turns` rows for a thread, in document order. */
const projectedTurns = (id: string): { ts: string; model: string | null }[] =>
  ws.db.prepare("SELECT ts, model FROM turns WHERE thread_id = ? ORDER BY idx").all(id) as {
    ts: string;
    model: string | null;
  }[];

describe("an agent turn carries the model that produced it", () => {
  it("records it in the thread's own frontmatter, keyed by the turn's timestamp", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const appended = await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");

    expect(appended.status).toBe(201);
    expect(recordOf(created.id)).toEqual({ [appended.ts]: OPUS });
    // And nowhere else: the turn's own text is untouched by the record.
    expect(ws.read(threadPath(created.id))).not.toContain(`${OPUS}\n6.4%`);
  });

  it("hands it back on the turn, on the response and on a later read", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const appended = await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");

    expect((appended.body["turn"] as { model: unknown }).model).toBe(OPUS);
    expect((await readTurns(created.id)).at(-1)?.model).toBe(OPUS);
  });

  it("reaches the projection, so a board never reparses the file to draw it", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const appended = await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");

    expect(projectedTurns(created.id)).toEqual([
      { ts: created.thread["created"], model: null },
      { ts: appended.ts, model: OPUS },
    ]);
  });

  it("records it on the first turn when a thread is created by the agent", async () => {
    const created = await createThread(ws, { body: "Filed for the record.", model: OPUS }, "agent");
    const turns = await readTurns(created.id);

    expect(recordOf(created.id)).toEqual({ [turns[0]?.ts ?? ""]: OPUS });
    expect(turns.map((turn) => turn.model)).toEqual([OPUS]);
  });

  it("records the value verbatim and interprets nothing about it", async () => {
    const created = await createThread(ws, { body: "@agent look" });
    const name = "some-vendor/Model X (2026-08) — preview";
    const appended = await appendTurn(ws, created.id, { body: "done", model: name }, "agent");

    expect(recordOf(created.id)).toEqual({ [appended.ts]: name });
  });
});

describe("the server records and never invents", () => {
  it("writes no key at all when the writer did not say which model it was", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    await appendTurn(ws, created.id, { body: "6.4%." }, "agent");

    const frontmatter = threadFrontmatterOf(ws, created.id);
    expect(Object.hasOwn(frontmatter, TURN_MODELS_FRONTMATTER_KEY)).toBe(false);
    expect(ws.read(threadPath(created.id))).not.toContain(TURN_MODELS_FRONTMATTER_KEY);
  });

  it("reports null rather than a default, a current model or the weight", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    await appendTurn(ws, created.id, { body: "6.4%." }, "agent");

    expect((await readTurns(created.id)).map((turn) => turn.model)).toEqual([null, null]);
    expect(projectedTurns(created.id).map((row) => row.model)).toEqual([null, null]);
  });

  it("leaves a thread written before the record existed exactly as it was", async () => {
    // No backfill and no guessing: a thread whose turns predate this simply has
    // no entries, and a reply that states nothing adds none.
    const created = await createThread(ws, { body: "@agent what changed?" });
    await appendTurn(ws, created.id, { body: "6.4%." }, "agent");
    const before = ws.read(threadPath(created.id));

    await appendTurn(ws, created.id, { body: "thanks" });
    expect(ws.read(threadPath(created.id))).not.toContain(TURN_MODELS_FRONTMATTER_KEY);
    expect(before).not.toContain(TURN_MODELS_FRONTMATTER_KEY);
  });
});

describe("a person's turn never carries one, on any path", () => {
  it("refuses a model on a reply authored by the user", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const response = await ws.post(`/api/threads/${created.id}/turns`, {
      body: "I looked it up myself.",
      model: OPUS,
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code: string; issues?: { path: string }[] };
    expect(payload.code).toBe("bad_request");
    expect(payload.issues?.map((issue) => issue.path)).toContain("model");
  });

  it("refuses a model on a thread created by the user", async () => {
    const response = await ws.post("/api/threads", { body: "Ask.", model: OPUS });
    expect(response.status).toBe(400);
  });

  it("refuses it before anything is written", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const before = ws.read(threadPath(created.id));

    await ws.post(`/api/threads/${created.id}/turns`, { body: "mine", model: OPUS });
    expect(ws.read(threadPath(created.id))).toBe(before);
  });

  it("refuses it on the multipart door too, not only the JSON one", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const form = new FormData();
    form.append("text", "mine");
    form.append("model", OPUS);
    const response = await ws.server.app.request(`/api/threads/${created.id}/turns`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.server.config.token}` },
      body: form,
    });

    expect(response.status).toBe(400);
  });

  it("still accepts an ordinary reply from a person, which names nothing", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");
    const reply = await appendTurn(ws, created.id, { body: "thanks" });

    expect(reply.status).toBe(201);
    expect((reply.body["turn"] as { model: unknown }).model).toBeNull();
  });
});

describe("deleting a turn takes its entry with it", () => {
  /** A thread whose three turns are: person, agent (opus), agent (haiku). */
  async function threeTurns(): Promise<{ id: string; second: string; third: string }> {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const second = await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");
    const third = await appendTurn(ws, created.id, { body: "and rising", model: HAIKU }, "agent");
    return { id: created.id, second: second.ts, third: third.ts };
  }

  it("removes the deleted turn's entry and keeps every other one", async () => {
    const { id, second, third } = await threeTurns();
    expect(recordOf(id)).toEqual({ [second]: OPUS, [third]: HAIKU });

    const response = await ws.del(`/api/threads/${id}/turns/${third}`);
    expect(response.status).toBe(200);
    expect(recordOf(id)).toEqual({ [second]: OPUS });
  });

  it("removes the key entirely when the last recorded turn goes", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const second = await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");
    await appendTurn(ws, created.id, { body: "thanks" });

    expect(await ws.del(`/api/threads/${created.id}/turns/${second.ts}`)).toHaveProperty(
      "status",
      200,
    );
    expect(threadFrontmatterOf(ws, created.id)[TURN_MODELS_FRONTMATTER_KEY]).toBeUndefined();
  });

  it("un-projects the model with the turn", async () => {
    const { id, third } = await threeTurns();
    await ws.del(`/api/threads/${id}/turns/${third}`);

    expect(projectedTurns(id).map((row) => row.model)).toEqual([null, OPUS]);
    expect(projectedTurns(id).some((row) => row.ts === third)).toBe(false);
  });

  /**
   * The reason the drop is load-bearing rather than housekeeping. `nextTurnTs`
   * derives the next stamp from the stamps **currently in the body**, so
   * deleting the last turn frees its timestamp for reuse — and against a fixed
   * clock the very next append takes it back. A surviving entry would then
   * attribute `haiku` to a turn haiku never wrote: a silent misattribution, and
   * worse than recording nothing.
   */
  it("never lets a reused timestamp inherit the dead turn's model", async () => {
    const { id, third } = await threeTurns();
    await ws.del(`/api/threads/${id}/turns/${third}`);

    const reused = await appendTurn(ws, id, { body: "actually, unchanged" }, "agent");
    expect(reused.ts).toBe(third);
    expect((reused.body["turn"] as { model: unknown }).model).toBeNull();
    expect(recordOf(id)[third]).toBeUndefined();
    expect(projectedTurns(id).find((row) => row.ts === third)?.model).toBeNull();
  });

  it("lets the reused timestamp carry the model its own writer stated", async () => {
    const { id, second, third } = await threeTurns();
    await ws.del(`/api/threads/${id}/turns/${third}`);
    const reused = await appendTurn(ws, id, { body: "again", model: OPUS }, "agent");

    expect(reused.ts).toBe(third);
    expect(recordOf(id)).toEqual({ [second]: OPUS, [third]: OPUS });
  });
});

describe("an entry that names no turn of this thread", () => {
  /** Rewrite a thread file's frontmatter, the way a hand edit or another tool would. */
  function seedRecord(id: string, entries: readonly string[]): void {
    const raw = ws.read(threadPath(id));
    const close = raw.indexOf("\n---", 4);
    ws.write(
      threadPath(id),
      `${raw.slice(0, close)}\n${TURN_MODELS_FRONTMATTER_KEY}:\n${entries
        .map((entry) => `  ${entry}`)
        .join("\n")}${raw.slice(close)}`,
    );
  }

  it("is invisible to a reader — a model is reported only for a turn that exists", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    seedRecord(created.id, [`2099-01-01T00:00:00Z: ${HAIKU}`]);
    ws.reproject();

    expect((await readTurns(created.id)).map((turn) => turn.model)).toEqual([null]);
    expect(projectedTurns(created.id).map((row) => row.model)).toEqual([null]);
  });

  it("is dropped by the next write, because invisible stops being true on reuse", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    seedRecord(created.id, [`2099-01-01T00:00:00Z: ${HAIKU}`]);
    ws.reproject();

    const appended = await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");
    expect(recordOf(created.id)).toEqual({ [appended.ts]: OPUS });
  });

  /**
   * The out-of-band twin of the deletion cascade, and why the append prunes
   * against the timestamps the thread had **before** the append rather than
   * after. A file whose last turn was removed by an external editor never went
   * through `DELETE /api/threads/{id}/turns/{ts}`, so its entry is still there —
   * sitting on exactly the stamp the next append will take back.
   */
  it("does not survive onto the very turn that takes its stamp back", async () => {
    const created = await createThread(ws, { body: "@agent what changed?" });
    const first = (await readTurns(created.id))[0]?.ts ?? "";
    const nextStamp = new Date(Date.parse(first) + 1000).toISOString().replace(/\.\d+Z$/, "Z");
    seedRecord(created.id, [`${nextStamp}: ${HAIKU}`]);
    ws.reproject();

    const appended = await appendTurn(ws, created.id, { body: "6.4%." }, "agent");
    expect(appended.ts).toBe(nextStamp);
    expect((appended.body["turn"] as { model: unknown }).model).toBeNull();
    expect(threadFrontmatterOf(ws, created.id)[TURN_MODELS_FRONTMATTER_KEY]).toBeUndefined();
    expect(projectedTurns(created.id).map((row) => row.model)).toEqual([null, null]);
  });
});

describe("a thread mixing turns with and without the field stays clean", () => {
  async function mixedThread(): Promise<string> {
    const created = await createThread(ws, { body: "@agent what changed?" });
    await appendTurn(ws, created.id, { body: "6.4%.", model: OPUS }, "agent");
    await appendTurn(ws, created.id, { body: "thanks" });
    await appendTurn(ws, created.id, { body: "noted" }, "agent");
    return created.id;
  }

  it("reads back as exactly one attributed turn among four", async () => {
    const id = await mixedThread();
    expect((await readTurns(id)).map((turn) => turn.model)).toEqual([null, OPUS, null, null]);
  });

  it("passes `corpus doc check` with no findings of its own", async () => {
    const id = await mixedThread();
    const response = await ws.post("/api/check", { ids: [id] });
    const report = (await response.json()) as {
      errors: { code: string }[];
      warnings: { code: string }[];
    };

    expect(response.status).toBe(200);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("passes `db doctor` with no drift", async () => {
    await mixedThread();
    const response = await ws.request("/api/db/doctor", {
      headers: { Authorization: `Bearer ${ws.server.config.token}` },
    });
    const report = (await response.json()) as { ok: boolean; drift: unknown[] };

    expect(response.status).toBe(200);
    expect(report.drift).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("survives a rebuild with the same attributions and no others", async () => {
    const id = await mixedThread();
    const before = projectedTurns(id);

    const response = await ws.post("/api/db/rebuild", {});
    expect(response.status).toBe(200);
    expect(projectedTurns(id)).toEqual(before);
    expect(projectedTurns(id).map((row) => row.model)).toEqual([null, OPUS, null, null]);
  });
});
