import { existsSync, readFileSync } from "node:fs";
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

/**
 * SERVER-075. The reviewer's fixture, driven through the real route: four turns
 * written, one visible, because the second left a fence open. What is asserted
 * is the *observable* loss — `turnsOf` parses the file with the same code every
 * reader uses — not that a particular function was called.
 */
describe("a turn that would swallow the turns after it (SPEC.md §6)", () => {
  const UNCLOSED = "Here is the snippet:\n\n```js\nconst x = 1;\n";

  it("refuses the reply, names the line the fence opened on, and writes nothing", async () => {
    const created = await createThread(ws, { body: "first" });
    const before = ws.read(threadPath(created.id));
    const head = ws.log("%H")[0];

    const response = await ws.post(`/api/threads/${created.id}/turns`, { body: UNCLOSED });
    const payload = (await response.json()) as { code: string; message: string; issues: unknown[] };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("bad_request");
    expect(payload.message).toContain("line 3");
    expect(payload.message).toContain("```");
    expect(payload.issues).toEqual([
      { path: "body", message: "unterminated ``` code fence opened on line 3" },
    ]);
    // Refused before the write: the file, the commit and the turn count are all
    // exactly as they were, so the author's words are still theirs to fix.
    expect(ws.read(threadPath(created.id))).toBe(before);
    expect(ws.log("%H")[0]).toBe(head);
    expect(turnsOf(ws, created.id)).toHaveLength(1);
  });

  it("refuses it for the agent too — the damage does not depend on who wrote it", async () => {
    const created = await createThread(ws, { body: "first" });
    const refused = await appendTurn(ws, created.id, { body: UNCLOSED }, "agent");

    expect(refused.status).toBe(400);
    expect(turnsOf(ws, created.id)).toHaveLength(1);
  });

  it("keeps all four turns visible once the fence is closed", async () => {
    const created = await createThread(ws, { body: "first" });
    expect((await appendTurn(ws, created.id, { body: `${UNCLOSED}\`\`\`\n` })).status).toBe(201);
    expect((await appendTurn(ws, created.id, { body: "third" }, "agent")).status).toBe(201);
    expect((await appendTurn(ws, created.id, { body: "fourth" })).status).toBe(201);

    expect(turnsOf(ws, created.id).map((turn) => turn.author)).toEqual([
      "user",
      "user",
      "agent",
      "user",
    ]);
  });

  it("accepts a turn that merely quotes a fence, however wide (SPEC.md §11's snippet)", async () => {
    const created = await createThread(ws, { body: "first" });
    const quoting = "How to write one:\n\n````markdown\n```js\nconst x = 1;\n```\n````\n";

    expect((await appendTurn(ws, created.id, { body: quoting })).status).toBe(201);
    expect(turnsOf(ws, created.id)).toHaveLength(2);
  });

  /**
   * SERVER-066's decision, unchanged: a fault already on disk blocks nothing.
   * The guard asks about *this* turn's text only, so the person replying to a
   * thread somebody else broke is still able to speak — their turn lands, and
   * `corpus doc check` is what reports the pre-existing fence.
   */
  it("still accepts a reply to a thread that already carries an open fence", async () => {
    const created = await createThread(ws, { body: "first" });
    const path = threadPath(created.id);
    ws.write(path, `${ws.read(path)}\n\`\`\`js\nconst x = 1;\n`);
    ws.reproject();

    const appended = await appendTurn(ws, created.id, { body: "a perfectly ordinary reply" });

    expect(appended.status).toBe(201);
    expect(ws.read(path)).toContain("a perfectly ordinary reply");
  });

  it("refuses a multipart turn before a single attachment byte is stored", async () => {
    const created = await createThread(ws, { body: "first" });
    const response = await postForm(ws, `/api/threads/${created.id}/turns`, [
      ["text", UNCLOSED],
      ["files", new File(["bytes"], "shot.png", { type: "image/png" })],
    ]);

    expect(response.status).toBe(400);
    expect(existsSync(join(ws.root, ".corpus", "attachments", created.id))).toBe(false);
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

  // Sprint-006 Adjudication 5: an explicit request is an explicit request, and
  // it reaches the agent on a resolved thread by short-circuiting §8's automatic
  // clause — which since SHARED-019 Amendment 1 is no longer the only way
  // through, only the way that also wins where the automatic clause says no.
  it("still lets an explicit request through on a resolved thread", async () => {
    const id = await engagedThread();
    expect((await ws.post(`/api/threads/${id}/resolve`, {})).status).toBe(200);
    const before = pendingEvents(ws).length;

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

// SPEC.md §8 (SHARED-019 Amendment 1): "Resolved is a closed door, not a locked
// one: a person's reply reopens it… A turn written by the **agent** never
// reopens a thread, so a conversation the agent closes stays closed. Reopening
// this way is an ordinary status change: it is committed, it is visible on the
// thread, and it is indistinguishable afterwards from reopening by hand."
//
// The defect this pins is UI-078: before SERVER-062 no reply path wrote
// `status` at all, so a person's reply to a resolved thread reached nobody and
// left no sign of it.
describe("§8's reopen", () => {
  /** An engaged thread the user has resolved, outside §4's squash window. */
  async function resolvedThread(): Promise<string> {
    const id = await engagedThread();
    expect((await ws.post(`/api/threads/${id}/resolve`, {})).status).toBe(200);
    expect(threadFrontmatterOf(ws, id)["status"]).toBe("resolved");
    // Past SQUASH_IDLE_MS, so the reply that follows makes a commit of its own
    // and its diff shows exactly what that one write carried.
    ws.advance(31_000);
    return id;
  }

  it("reopens the thread and wakes the agent, in the turn's own commit", async () => {
    const id = await resolvedThread();
    const before = { events: pendingEvents(ws).length, commits: ws.log("%H").length };

    const appended = await appendTurn(ws, id, { body: "actually, one more thing" });

    expect(appended.eventId).toMatch(/^evt_/);
    expect(pendingEvents(ws)).toHaveLength(before.events + 1);
    // The response, the file and the projection agree before the response is
    // sent — read-your-write, exactly as `POST …/reopen` promises.
    expect(appended.body["thread"]).toMatchObject({ status: "open", agent: "engaged" });
    expect(threadFrontmatterOf(ws, id)["status"]).toBe("open");
    expect(ws.db.prepare("SELECT status FROM threads WHERE id = ?").get(id)).toEqual({
      status: "open",
    });

    // One commit, authored by the acting party (§4), carrying *both* the turn
    // and the status flip — never a second write.
    expect(ws.log("%H")).toHaveLength(before.commits + 1);
    expect(ws.git("log", "-1", "--format=%an <%ae>%n%s").trim().split("\n")).toEqual([
      "user <user@corpus.local>",
      `comment: turn on ${id} by user (reopened)`,
    ]);
    const diff = ws.git("show", "--format=", "HEAD", "--", threadPath(id));
    expect(diff).toContain("-status: resolved");
    expect(diff).toContain("+status: open");
    expect(diff).toContain("+actually, one more thing");
    expect(ws.git("show", `HEAD~1..HEAD`, "--name-only", "--format=").trim()).toBe(threadPath(id));
  });

  it("reopens without waking anybody for a note-only reply", async () => {
    const id = await resolvedThread();
    const before = pendingEvents(ws).length;

    const appended = await appendTurn(ws, id, {
      body: "just for the record",
      requestsAgent: false,
    });

    expect(appended.eventId).toBeNull();
    expect(pendingEvents(ws)).toHaveLength(before);
    expect(threadFrontmatterOf(ws, id)["status"]).toBe("open");
  });

  it("reopens a resolved thread the agent was never engaged in", async () => {
    const created = await createThread(ws, { body: "a note to myself" });
    expect((await ws.post(`/api/threads/${created.id}/resolve`, {})).status).toBe(200);

    const appended = await appendTurn(ws, created.id, { body: "picking this back up" });

    expect(appended.eventId).toBeNull();
    expect(threadFrontmatterOf(ws, created.id)["status"]).toBe("open");
  });

  it("reopens beside the explicit request rather than instead of it", async () => {
    const id = await resolvedThread();
    const before = pendingEvents(ws).length;

    const appended = await appendTurn(ws, id, { body: "@agent one more thing" });

    expect(appended.eventId).toMatch(/^evt_/);
    expect(pendingEvents(ws)).toHaveLength(before + 1);
    expect(threadFrontmatterOf(ws, id)["status"]).toBe("open");
  });

  it.each([
    ["a plain turn", {}],
    ["a turn asking for the agent back", { requestsAgent: true }],
  ])("keeps the thread closed when the agent writes %s", async (_label, body) => {
    const id = await resolvedThread();

    await appendTurn(ws, id, { body: "nothing further from me", ...body }, "agent");

    expect(threadFrontmatterOf(ws, id)["status"]).toBe("resolved");
    expect(ws.log("%s")[0]).toBe(`comment: turn on ${id} by agent`);
  });

  it("is indistinguishable afterwards from reopening by hand", async () => {
    const id = await resolvedThread();
    await appendTurn(ws, id, { body: "actually" });
    const head = ws.head();

    // `POST …/reopen` is idempotent and silent on a thread that is already open
    // (`status.ts`): a 200 that writes no commit is only possible if the reply
    // left the thread genuinely open, not merely reported as open.
    const response = await ws.post(`/api/threads/${id}/reopen`, {});
    expect(response.status).toBe(200);
    expect(((await response.json()) as { thread: { status: string } }).thread.status).toBe("open");
    expect(ws.head()).toBe(head);
  });

  it("leaves an open thread's `status` out of the write entirely", async () => {
    const id = await engagedThread();
    // A fresh commit rather than a fold, so the diff is this turn's alone.
    ws.advance(31_000);
    await appendTurn(ws, id, { body: "still open here" });

    // Context lines carry `status: open`; what must not appear is a *changed*
    // one, in either direction.
    const changed = ws
      .git("show", "--format=", "HEAD", "--", threadPath(id))
      .split("\n")
      .filter((line) => /^[+-]status:/.test(line));
    expect(changed).toEqual([]);
    expect(ws.log("%s")[0]).toBe(`comment: turn on ${id} by user`);
  });

  it("never rewrites an archived thread's status", async () => {
    // `read.ts` reports an archived thread as `open` — an archived thread is
    // still an unresolved conversation — so a reply that restated `status`
    // would silently unarchive it.
    const created = await createThread(ws, { body: "filed away" });
    const path = threadPath(created.id);
    ws.write(path, ws.read(path).replace("status: open", "status: archived"));
    ws.reproject();

    await appendTurn(ws, created.id, { body: "a later thought" });

    expect(threadFrontmatterOf(ws, created.id)["status"]).toBe("archived");
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
