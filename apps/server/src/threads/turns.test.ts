import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { turnRequestBody, whileUnreferenced } from "./turns.js";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  pendingEvents,
  postForm,
  referencedAttachments,
  threadFrontmatterOf,
  threadPath,
  turnsOf,
  withBrokenQueue,
  type WriteWorkspace,
} from "./thread-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createThreadWorkspace("turns");
});

afterEach(() => {
  ws.close();
});

const seedParent = async (): Promise<string> =>
  (await createDoc(ws, { type: "note", title: "Mortgage model", body: "A body.\n" })).id;

/** A thread the agent has replied in, so `agent: engaged` and §8's re-trigger applies. */
async function engagedThread(): Promise<string> {
  const parent = await seedParent();
  const created = await createThread(ws, {
    parent,
    body: "please look at this",
    requestsAgent: true,
  });
  await appendTurn(ws, created.id, { body: "looked at it" }, "agent");
  expect(threadFrontmatterOf(ws, created.id)["agent"]).toBe("engaged");
  return created.id;
}

const eventPayload = (name: string): Record<string, unknown> => {
  const raw = readFileSync(join(ws.root, ".corpus", "queue", "pending", name), "utf8");
  return (JSON.parse(raw) as { payload: Record<string, unknown> }).payload;
};

describe("POST /api/threads/{id}/turns", () => {
  it("appends in §6's format and answers 201 with the summary", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, { parent, body: "first" });
    const before = ws.read(threadPath(created.id));

    const appended = await appendTurn(ws, created.id, { body: "second" }, "agent");

    expect(appended.status).toBe(201);
    expect(appended.body["turn"]).toMatchObject({ author: "agent", body: "second" });
    expect(appended.body["thread"]).toMatchObject({
      id: created.id,
      turnCount: 2,
      lastAuthor: "agent",
      lastTs: appended.ts,
    });

    const text = ws.read(threadPath(created.id));
    expect(text).toContain(`## agent · ${appended.ts}\nsecond`);
    // The turn that was already there is untouched, byte for byte.
    expect(text).toContain(before.slice(before.indexOf("## user ·")).trimEnd());
  });

  it("keeps timestamps unique and increasing inside one wall-clock second", async () => {
    const created = await createThread(ws, { body: "first" });
    for (let index = 0; index < 5; index += 1) {
      await appendTurn(ws, created.id, { body: `turn ${index}` });
    }

    const stamps = turnsOf(ws, created.id).map((turn) => turn.ts);
    expect(stamps).toHaveLength(6);
    expect(new Set(stamps).size).toBe(6);
    expect([...stamps].sort()).toEqual(stamps);
    for (const ts of stamps) expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("moves `updated` to the turn's stamp, and the projection agrees before the response", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, { parent, body: "first" });
    const appended = await appendTurn(ws, created.id, { body: "second" }, "agent");

    expect(threadFrontmatterOf(ws, created.id)["updated"]).toBe(appended.ts);
    // No sleep, no watcher: §9.1's read-your-write.
    expect(
      ws.db
        .prepare("SELECT turn_count, last_author, last_ts FROM threads WHERE id = ?")
        .get(created.id),
    ).toEqual({ turn_count: 2, last_author: "agent", last_ts: appended.ts });
  });

  it("answers 404 for an unknown thread", async () => {
    const response = await ws.post("/api/threads/th_zzzzzzzz/turns", { body: "hello" });
    expect(response.status).toBe(404);
  });

  it("refuses a document id in the thread position before reaching the handler", async () => {
    const parent = await seedParent();
    const response = await ws.post(`/api/threads/${parent}/turns`, { body: "hello" });
    expect(response.status).toBe(400);
  });

  // Only a hand-written file can produce this: a `th_*` id on a document that is
  // not a thread. It is a 404 on this surface rather than a 400 — the request was
  // fine, and "there is no thread with that id" is exactly true of a note.
  it("answers 404 for a th_* id whose document is not a thread", async () => {
    ws.write(
      "data/docs/inbox/impostor.md",
      "---\nid: th_impostor\ntype: note\ntitle: Not a thread\n" +
        "created: 2026-07-01T00:00:00Z\nupdated: 2026-07-01T00:00:00Z\n---\nBody.\n",
    );
    ws.reproject();
    expect((await ws.post("/api/threads/th_impostor/turns", { body: "hi" })).status).toBe(404);
    expect(
      (
        await ws.request("/api/threads/th_impostor", {
          headers: { Authorization: `Bearer ${ws.server.config.token}` },
        })
      ).status,
    ).toBe(404);
  });
});

describe("POST /api/threads/{id}/turns — multipart", () => {
  it("accepts a text-only multipart turn and honours a `false` string", async () => {
    const created = await createThread(ws, { body: "first", requestsAgent: true });
    await appendTurn(ws, created.id, { body: "engaging" }, "agent");
    const before = pendingEvents(ws).length;

    const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["text", "multipart reply"],
      ["requestsAgent", "false"],
    ]);
    const payload = (await response.json()) as { eventId: string | null; turn: { body: string } };

    expect(response.status).toBe(201);
    expect(payload.turn.body).toBe("multipart reply");
    // `z.stringbool` keeps "false" distinguishable from silence; `z.coerce` would
    // have made it `true` and destroyed the "note only" toggle.
    expect(payload.eventId).toBeNull();
    expect(pendingEvents(ws)).toHaveLength(before);
  });

  // Replaces the SERVER-010 refusal this route used to answer with: the same
  // request now succeeds, and no response body anywhere still names the issue.
  it("accepts attachments and references them from the committed turn", async () => {
    const created = await createThread(ws, { body: "first" });

    const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["text", "with a file"],
      ["files", new File(["bytes"], "shot.png", { type: "image/png" })],
    ]);
    const payload = (await response.json()) as { turn: { ts: string; body: string } };

    expect(response.status).toBe(201);
    expect(payload.turn.body).toContain("![shot.png](attachments/");
    expect(JSON.stringify(payload)).not.toContain("SERVER-010");
    expect(ws.exists(`.corpus/attachments/${created.id}/${payload.turn.ts}/shot.png`)).toBe(true);
  });

  it("accepts an attachment-only turn and refuses one with neither text nor files", async () => {
    const created = await createThread(ws, { body: "first" });

    const only = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["files", new File(["bytes"], "notes.pdf")],
    ]);
    const payload = (await only.json()) as { turn: { ts: string; body: string } };
    expect(only.status).toBe(201);
    expect(payload.turn.body).toBe(
      `[notes.pdf](attachments/${created.id}/${encodeURIComponent(payload.turn.ts)}/notes.pdf)`,
    );

    const empty = await postForm(ws, `/api/threads/${created.id}/turns`, []);
    const problem = (await empty.json()) as { issues: unknown[] };
    expect(empty.status).toBe(400);
    expect(problem.issues.length).toBeGreaterThan(0);
  });

  // SERVER-021, the same defect as `POST /api/capture`: the cleanup used to wrap
  // `runMutation` and everything after it.
  it("keeps the attachment when the failure lands after the commit (§6)", async () => {
    const created = await createThread(ws, { body: "first" });

    const response = await withBrokenQueue(ws, () =>
      postForm(ws, `/api/threads/${created.id}/turns`, [
        ["text", "with a file"],
        ["requestsAgent", "true"],
        ["files", new File(["bytes"], "shot.png", { type: "image/png" })],
      ]),
    );

    expect(response.status).toBe(500);
    // Committed, so this is a failure *after* the write (the append amends the
    // thread's own commit, so the count is not what says so — the content is).
    const committed = ws.git("show", `HEAD:${threadPath(created.id)}`);
    expect(committed).toContain("with a file");
    expect(ws.git("status", "--porcelain")).toBe("");

    const referenced = referencedAttachments(committed);
    expect(referenced).toHaveLength(1);
    for (const path of referenced) expect(ws.exists(path)).toBe(true);
  });

  it("refuses a request that declares no validatable body", async () => {
    const created = await createThread(ws, { body: "first" });
    const response = await ws.server.app.request(`/api/threads/${created.id}/turns`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ws.server.config.token}` },
    });
    expect(response.status).toBe(400);
  });
});

describe("whileUnreferenced", () => {
  const THREAD = "th_a1b2c3d4";
  const TS = "2026-07-27T09:00:00Z";
  const stored = [{ name: "shot.png" }] as const;

  const attachmentsRoot = (): string => join(ws.root, ".corpus", "attachments");
  const seed = (): string => {
    const relative = `.corpus/attachments/${THREAD}/${TS}/shot.png`;
    ws.write(relative, "bytes");
    return relative;
  };

  it("removes the bytes when the markdown that would quote them fails", () => {
    const relative = seed();
    expect(() =>
      whileUnreferenced(attachmentsRoot(), THREAD, TS, stored, () => {
        throw new Error("could not build the turn");
      }),
    ).toThrow("could not build the turn");
    expect(ws.exists(relative)).toBe(false);
  });

  it("leaves them where they are once the markdown is built", () => {
    const relative = seed();
    expect(whileUnreferenced(attachmentsRoot(), THREAD, TS, stored, () => "built")).toBe("built");
    expect(ws.exists(relative)).toBe(true);
  });

  it("does nothing for a turn that stored no files", () => {
    const relative = seed();
    expect(() =>
      whileUnreferenced(attachmentsRoot(), THREAD, TS, [], () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    // Another turn's directory is not this failure's to remove.
    expect(ws.exists(relative)).toBe(true);
  });
});

describe("turnRequestBody", () => {
  it("reads the JSON form's tri-state without collapsing it", () => {
    expect(turnRequestBody({ body: "hi", requestsAgent: false })).toEqual({
      text: "hi",
      requestsAgent: false,
      files: [],
    });
    expect(turnRequestBody({ body: "hi" })).toEqual({
      text: "hi",
      requestsAgent: undefined,
      files: [],
    });
  });

  it("carries the multipart form's files through, and its absent text", () => {
    const file = new File(["bytes"], "a.png");
    expect(turnRequestBody({ text: "x", files: [file] })).toEqual({
      text: "x",
      requestsAgent: undefined,
      files: [file],
    });
    expect(turnRequestBody({ files: [file] })).toEqual({
      text: undefined,
      requestsAgent: undefined,
      files: [file],
    });
  });
});

describe("the §8 enqueue matrix", () => {
  it("enqueues nothing for a plain comment with the flag omitted", async () => {
    const created = await createThread(ws, { body: "first" });
    const appended = await appendTurn(ws, created.id, { body: "just a note" });
    expect(appended.eventId).toBeNull();
    expect(pendingEvents(ws)).toEqual([]);
    expect(threadFrontmatterOf(ws, created.id)["agent"]).toBe("none");
  });

  it("enqueues exactly one event for an explicit true, and flips none → requested", async () => {
    const created = await createThread(ws, { body: "first" });
    const appended = await appendTurn(ws, created.id, {
      body: "no mention at all",
      requestsAgent: true,
    });

    expect(appended.eventId).toMatch(/^evt_/);
    expect(pendingEvents(ws)).toHaveLength(1);
    expect(threadFrontmatterOf(ws, created.id)["agent"]).toBe("requested");
    expect(ws.db.prepare("SELECT agent FROM threads WHERE id = ?").get(created.id)).toEqual({
      agent: "requested",
    });
  });

  it("writes the turn and the `agent` flip in one commit", async () => {
    const created = await createThread(ws, { body: "first" });
    // A different actor, so the squash window cannot fold this into the create.
    const before = ws.log("%H").length;
    await appendTurn(ws, created.id, { body: "ask", requestsAgent: true }, "agent");
    expect(ws.log("%H")).toHaveLength(before + 1);
  });

  it("re-triggers on a plain turn in an engaged, open thread", async () => {
    const id = await engagedThread();
    const before = pendingEvents(ws).length;
    const appended = await appendTurn(ws, id, { body: "and another thing" });
    expect(appended.eventId).toMatch(/^evt_/);
    expect(pendingEvents(ws)).toHaveLength(before + 1);
  });

  it('suppresses an engaged re-trigger for "note only"', async () => {
    const id = await engagedThread();
    const before = pendingEvents(ws).length;
    const appended = await appendTurn(ws, id, { body: "for the record", requestsAgent: false });
    expect(appended.eventId).toBeNull();
    expect(pendingEvents(ws)).toHaveLength(before);
  });

  it("lets an explicit false outrank an @agent in the body", async () => {
    const created = await createThread(ws, { body: "first" });
    const appended = await appendTurn(ws, created.id, {
      body: "@agent hello",
      requestsAgent: false,
    });
    expect(appended.eventId).toBeNull();
    expect(pendingEvents(ws)).toEqual([]);
  });

  it("does not re-trigger once the thread is resolved", async () => {
    const id = await engagedThread();
    expect((await ws.post(`/api/threads/${id}/resolve`, {})).status).toBe(200);
    const before = pendingEvents(ws).length;

    expect((await appendTurn(ws, id, { body: "plain" })).eventId).toBeNull();
    expect(pendingEvents(ws)).toHaveLength(before);

    // Sprint-006 Adjudication 5: an explicit request is an explicit request.
    expect((await appendTurn(ws, id, { body: "actually", requestsAgent: true })).eventId).toMatch(
      /^evt_/,
    );
    expect(pendingEvents(ws)).toHaveLength(before + 1);
  });

  it("differs from creation's omitted behaviour, which is mention-only", async () => {
    const parent = await seedParent();
    const plain = await createThread(ws, { parent, body: "a plain first turn" });
    const mentioning = await createThread(ws, { parent, body: "@agent please look" });
    expect(plain.eventId).toBeNull();
    expect(mentioning.eventId).toMatch(/^evt_/);
  });
});

describe("the enqueued event", () => {
  it("carries the contract's on-disk shape and the §8 payload", async () => {
    const parent = await seedParent();
    const created = await createThread(ws, { parent, body: "@agent is this right?" });

    const [name] = pendingEvents(ws);
    const raw = JSON.parse(
      readFileSync(join(ws.root, ".corpus", "queue", "pending", name ?? ""), "utf8"),
    ) as Record<string, unknown>;

    expect(raw).toMatchObject({
      id: created.eventId,
      type: "comment.created",
      source: "thread",
      created: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });
    expect(raw["payload"]).toEqual({
      threadId: created.id,
      parentId: parent,
      turnTs: turnsOf(ws, created.id)[0]?.ts,
      mentions: [],
      skills: [],
      unresolved: [],
    });

    // The one queue service saw it, so a parked `queue idle` would have woken.
    const status = await ws.request("/api/queue/status", {
      headers: { Authorization: `Bearer ${ws.server.config.token}` },
    });
    expect(await status.json()).toMatchObject({ pending: 1, halted: false });
    expect(ws.db.prepare("SELECT count(*) AS n FROM events").get()).toEqual({ n: 1 });
  });

  it("structures a resolved skill invocation and reports what resolved to nothing", async () => {
    ws.write(
      ".claude/skills/comment/SKILL.md",
      "---\nname: comment\ndescription: handles comment.created\n---\nBody.\n",
    );
    ws.reproject();
    await createThread(ws, { body: "/comment please, and ask @nobody too" });

    const payload = eventPayload(pendingEvents(ws)[0] ?? "");
    expect(payload["skills"]).toEqual([
      { name: "comment", docId: expect.stringMatching(/^doc_/) as unknown, status: "open" },
    ]);
    expect(payload["mentions"]).toEqual([]);
    expect(payload["unresolved"]).toEqual(["@nobody"]);
    expect(payload["parentId"]).toBeNull();
  });

  it.each([
    ["a fenced block", "```\n@agent /comment\n```"],
    ["inline code", "use `@agent` in the docs"],
    ["an email address", "email me@agent.example"],
    ["a path", "look under path/comment/x"],
    ["a word", "a@agentb"],
    ["tokens nothing answers to", "check @nobody and /nothing"],
  ])("does not wake the agent for %s", async (_label, body) => {
    const created = await createThread(ws, { body });
    expect(created.eventId).toBeNull();
    expect(pendingEvents(ws)).toEqual([]);
  });
});
