// SPEC.md §7's resident rider (SHARED-043), server side: designation is
// user-only state on a standalone thread, single-valued, released by the person
// who set it or by the thread being resolved.
//
// Everything here runs against the real app, real files, a real git repository
// and the real queue directory, for the reason the rest of the thread suites do:
// what designation has to be right about — a frontmatter key written and later
// *removed*, a commit authored by the acting party, a projection row the enqueue
// path can read, an event file a parked agent can see — is only observable
// against those.

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_QUEUE_EVENT_TYPES, type QueryKey } from "@corpus/contract";
import {
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  pendingEvents,
  threadFrontmatterOf,
  threadPath,
  type WriteWorkspace,
} from "./thread-fixture.js";
import { RESIDENT_DESIGNATED } from "./resident.js";

let ws: WriteWorkspace;

const AGENT = { "x-corpus-author": "agent" };

/** The agent-defs every case here resolves against, projected like any document. */
function seedAgents(): void {
  ws.write(
    ".claude/agents/researcher.md",
    "---\nid: doc_researcher\nname: researcher\ndescription: digs things up\n---\nBody.\n",
  );
  ws.write(
    ".claude/agents/editor.md",
    "---\nid: doc_editorone\nname: editor\ndescription: tightens prose\n---\nBody.\n",
  );
  ws.write(
    ".claude/agents/retired.md",
    "---\nid: doc_retired\nname: retired\ndescription: no longer used\nstatus: archived\n---\nBody.\n",
  );
  ws.reproject();
}

beforeEach(() => {
  ws = createThreadWorkspace("resident");
  seedAgents();
});

afterEach(() => {
  ws.close();
});

const designate = (id: string, name: string, headers: Record<string, string> = {}) =>
  ws.post(`/api/threads/${id}/resident`, { name }, headers);

const release = (id: string, headers: Record<string, string> = {}) =>
  ws.del(`/api/threads/${id}/resident`, headers);

const readThread = async (id: string): Promise<Record<string, unknown>> =>
  (await (await ws.request(`/api/threads/${id}`)).json()) as Record<string, unknown>;

const residentRow = (id: string): unknown =>
  ws.db.prepare("SELECT resident_name, resident_doc_id FROM threads WHERE id = ?").get(id);

/** One event file, as the queue wrote it. */
type StoredEvent = {
  readonly type: string;
  readonly source: string;
  readonly status: string;
  readonly created: string;
  readonly lane: string;
  readonly payload: Record<string, unknown>;
};

/** Every pending queue event, parsed. */
const pendingPayloads = (): StoredEvent[] =>
  pendingEvents(ws).map(
    (name) =>
      JSON.parse(
        readFileSync(join(ws.root, ".corpus", "queue", "pending", name), "utf8"),
      ) as StoredEvent,
  );

/**
 * Every pending `resident.designated`, **oldest first**.
 *
 * Sorted by `created` and not left in `pendingPayloads`' order, which is the
 * directory's — i.e. by event id, which is randomly generated. An assertion
 * about two designations in sequence was therefore a coin flip on which one came
 * first, and failed roughly half the time (found while running the suite for
 * SERVER-111). The fixture advances its clock between designations, so `created`
 * is the deterministic key that says what the assertion means.
 */
const designations = (): StoredEvent[] =>
  pendingPayloads()
    .filter((event) => event.type === RESIDENT_DESIGNATED)
    .sort((left, right) => left.created.localeCompare(right.created));

/** The title the server derived for a created thread — what a commit subject names. */
const titleOf = (created: { thread: Record<string, unknown> }): string =>
  created.thread["title"] as string;

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

describe("the event type", () => {
  // Spelled as a literal here and in `resident.ts` rather than indexed out of
  // the contract's tuple; this is what keeps the two spellings one value.
  it("is one of the contract's core queue event types", () => {
    expect(CORE_QUEUE_EVENT_TYPES).toContain(RESIDENT_DESIGNATED);
  });
});

describe("POST /api/threads/{id}/resident", () => {
  it("writes the resolved resident into the thread's frontmatter and answers with it", async () => {
    const created = await createThread(ws, { body: "let us talk about the archive" });

    const response = await designate(created.id, "researcher");
    const payload = (await response.json()) as {
      thread: { id: string; resident: { name: string; docId: string } | null };
      warnings: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.thread).toMatchObject({
      id: created.id,
      resident: { name: "researcher", docId: "doc_researcher" },
    });
    expect(payload.warnings).toEqual([]);
    // The file is the source of truth, and it holds both halves.
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
    // Read back through the route a client uses, off the re-projected state.
    expect((await readThread(created.id))["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
    // And in the projection, where SERVER-111's enqueue path will ask.
    expect(residentRow(created.id)).toEqual({
      resident_name: "researcher",
      resident_doc_id: "doc_researcher",
    });
  });

  it("commits once, authored by the acting party, naming the act", async () => {
    const created = await createThread(ws, { body: "start" });
    // Past the fold window, so the designation is not amended into the create.
    ws.advance(61_000);
    const before = ws.log("%H").length;

    expect((await designate(created.id, "researcher")).status).toBe(200);

    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%s")[0]).toBe(
      `resident designate: researcher on ${titleOf(created)} (${created.id}) by user`,
    );
    expect(ws.log("%an")[0]).toBe("user");
  });

  it("enqueues resident.designated naming the thread and the resolved resident", async () => {
    const created = await createThread(ws, { body: "start" });

    await designate(created.id, "researcher");

    expect(designations()).toMatchObject([
      {
        type: RESIDENT_DESIGNATED,
        source: "thread",
        status: "pending",
        payload: {
          threadId: created.id,
          resident: { name: "researcher", docId: "doc_researcher" },
        },
      },
    ]);
  });

  it("announces the thread, the collection and the roster", async () => {
    const created = await createThread(ws, { body: "start" });

    const frames = await framesDuring(() => designate(created.id, "researcher"));

    // One frame for the write. The queue's own enqueue announces `["queue"]` and
    // `["jobs"]` in a frame of its own, which is not this route's business.
    expect(frames[0]).toEqual([
      ["docs"],
      ["docs", created.id],
      ["threads", created.id],
      ["agents"],
    ]);
  });

  it("resolves the name through the index a mention uses, case and all", async () => {
    const created = await createThread(ws, { body: "start" });

    const response = await designate(created.id, "ReSeArChEr");

    expect(response.status).toBe(200);
    // The *resolved* name is stored, never the caller's spelling.
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
  });

  it("designates an archived agent-def rather than silently refusing it", async () => {
    const created = await createThread(ws, { body: "start" });

    const response = await designate(created.id, "retired");

    expect(response.status).toBe(200);
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "retired",
      docId: "doc_retired",
    });
  });

  it("replaces a resident rather than refusing, and enqueues afresh", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    ws.advance(61_000);

    const response = await designate(created.id, "editor");

    expect(response.status).toBe(200);
    // Single-valued: one resident or none, so this is a replacement.
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "editor",
      docId: "doc_editorone",
    });
    expect(designations().map((event) => event.payload["resident"])).toEqual([
      { name: "researcher", docId: "doc_researcher" },
      { name: "editor", docId: "doc_editorone" },
    ]);
  });

  it("writes nothing when the resident is already the one asked for — but still announces it", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    ws.advance(61_000);
    const before = ws.log("%H").length;
    const text = ws.read(threadPath(created.id));

    const response = await designate(created.id, "researcher");

    expect(response.status).toBe(200);
    // The state asked for is the state that holds: nothing written, nothing
    // committed. Not even `updated` moves, which would report a change nobody
    // made.
    expect(ws.read(threadPath(created.id))).toBe(text);
    expect(ws.log("%H")).toHaveLength(before);
    // The event is still written: re-issuing a designation is how a person asks
    // for a listener that is no longer running to be launched again, and there
    // is no other verb for it.
    expect(designations()).toHaveLength(2);
  });

  it("refuses the agent: designation is the person's act", async () => {
    const created = await createThread(ws, { body: "start" });

    const response = await designate(created.id, "researcher", AGENT);

    expect(response.status).toBe(403);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "forbidden" });
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toBeUndefined();
    expect(designations()).toEqual([]);
  });

  it("refuses a thread with a parent: a resident owns a conversation, not a passage", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const anchored = await createThread(ws, {
      parent,
      body: "about this",
      selector: { exact: "A body." },
    });
    const wholeDoc = await createThread(ws, { parent, body: "about all of it" });

    for (const id of [anchored.id, wholeDoc.id]) {
      const response = await designate(id, "researcher");
      expect([id, response.status]).toEqual([id, 409]);
      expect((await response.json()) as { code: string }).toMatchObject({ code: "conflict" });
      expect(threadFrontmatterOf(ws, id)["resident"]).toBeUndefined();
    }
  });

  it("answers 404 for a name that resolves to no agent-def, and for an unknown thread", async () => {
    const created = await createThread(ws, { body: "start" });

    expect((await designate(created.id, "nobody")).status).toBe(404);
    // A skill is not a subagent: the sigils do not cross (§8), and neither does
    // this lookup.
    ws.write(".claude/skills/comment/SKILL.md", "---\nname: comment\n---\nBody.\n");
    ws.reproject();
    expect((await designate(created.id, "comment")).status).toBe(404);
    expect((await designate("th_zzzzzzzz", "researcher")).status).toBe(404);
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toBeUndefined();
  });

  it("refuses a designation that names nobody", async () => {
    const created = await createThread(ws, { body: "start" });

    expect((await designate(created.id, "")).status).toBe(400);
    expect((await designate(created.id, "   ")).status).toBe(400);
  });
});

describe("DELETE /api/threads/{id}/resident", () => {
  it("removes the key — dissolution is the absence of a resident, not a third state", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    ws.advance(61_000);
    const before = ws.log("%H").length;

    const response = await release(created.id);
    const payload = (await response.json()) as {
      thread: { resident: unknown };
      warnings: unknown[];
    };

    expect(response.status).toBe(200);
    expect(payload.thread.resident).toBeNull();
    expect(payload.warnings).toEqual([]);
    // The key is gone, not set to null.
    expect(Object.hasOwn(threadFrontmatterOf(ws, created.id), "resident")).toBe(false);
    expect(residentRow(created.id)).toEqual({ resident_name: null, resident_doc_id: null });
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%s")[0]).toBe(`resident release: ${titleOf(created)} (${created.id}) by user`);
  });

  it("is idempotent: a release with nothing to release writes, commits and announces nothing", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    await release(created.id);
    ws.advance(61_000);
    const before = ws.log("%H").length;
    const text = ws.read(threadPath(created.id));

    const frames = await framesDuring(async () => {
      const again = await release(created.id);
      expect(again.status).toBe(200);
      expect(await again.json()).toMatchObject({ thread: { resident: null }, warnings: [] });
    });

    expect(ws.read(threadPath(created.id))).toBe(text);
    expect(ws.log("%H")).toHaveLength(before);
    expect(frames).toEqual([]);
  });

  it("enqueues nothing: §7 names one event, and it is designation's", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    const before = pendingEvents(ws).length;

    await release(created.id);

    expect(pendingEvents(ws)).toHaveLength(before);
  });

  it("refuses the agent, and 404s an unknown thread", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");

    expect((await release(created.id, AGENT)).status).toBe(403);
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
    expect((await release("th_zzzzzzzz")).status).toBe(404);
  });
});

describe("resolving a conversation releases its resident (SPEC.md §7)", () => {
  it("clears the field in the same write, and reopening does not bring it back", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    ws.advance(61_000);
    const before = ws.log("%H").length;

    expect((await ws.post(`/api/threads/${created.id}/resolve`, {})).status).toBe(200);

    // One write, one commit: the release is part of resolving rather than a
    // second act.
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(ws.log("%s")[0]).toBe(`thread resolve: ${titleOf(created)} (${created.id}) by user`);
    expect(Object.hasOwn(threadFrontmatterOf(ws, created.id), "resident")).toBe(false);
    expect(residentRow(created.id)).toEqual({ resident_name: null, resident_doc_id: null });

    ws.advance(61_000);
    expect((await ws.post(`/api/threads/${created.id}/reopen`, {})).status).toBe(200);

    // §8 as amended: the conversation resumes on the orchestrator's lane, and
    // designating again is a deliberate act.
    expect((await readThread(created.id))["resident"]).toBeNull();
  });

  // Designating a resolved conversation is not refused — CONTRACT-051's `409` is
  // for a thread that may not have a resident *at all*, which is a thread with a
  // parent — so the verb §7 names has to be able to undo it whatever the status
  // already is. Without this, a resident designated after resolving could be let
  // go only by reopening first.
  it("releases one even when the status it asks for already holds", async () => {
    const created = await createThread(ws, { body: "start" });
    await ws.post(`/api/threads/${created.id}/resolve`, {});
    await designate(created.id, "researcher");
    ws.advance(61_000);
    const before = ws.log("%H").length;

    expect((await ws.post(`/api/threads/${created.id}/resolve`, {})).status).toBe(200);

    expect(Object.hasOwn(threadFrontmatterOf(ws, created.id), "resident")).toBe(false);
    expect(threadFrontmatterOf(ws, created.id)["status"]).toBe("resolved");
    expect(ws.log("%H")).toHaveLength(before + 1);
  });

  it("announces the roster too, and only when it actually released one", async () => {
    const designated = await createThread(ws, { body: "one" });
    await designate(designated.id, "researcher");
    const plain = await createThread(ws, { body: "two" });

    const withResident = await framesDuring(() =>
      ws.post(`/api/threads/${designated.id}/resolve`, {}),
    );
    const without = await framesDuring(() => ws.post(`/api/threads/${plain.id}/resolve`, {}));

    expect(withResident[0]).toContainEqual(["agents"]);
    expect(without[0]).not.toContainEqual(["agents"]);
  });
});

describe("reading a resident back", () => {
  it("re-reads the document id from the name, so a moved agent-def is not stale", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");

    // The same name, a different document: what a rename or a move produces,
    // since an agent-def with no Corpus id is identified by its path.
    ws.write(
      ".claude/agents/researcher.md",
      "---\nid: doc_researchernew\nname: researcher\ndescription: digs things up\n---\nBody.\n",
    );
    ws.reproject();

    expect((await readThread(created.id))["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researchernew",
    });
    // Nothing was rewritten to make that true: the file still holds what the
    // designation stored.
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
  });

  it("keeps the stored pair when the agent-def is gone: the name is the durable half", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");

    rmSync(join(ws.root, ".claude", "agents", "researcher.md"));
    ws.reproject();

    expect((await readThread(created.id))["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
  });

  it("reads nothing off a parented thread, whatever its frontmatter says", async () => {
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const child = await createThread(ws, { parent, body: "about all of it" });

    // A hand edit, which §5 makes as real as anything the server writes.
    const text = ws.read(threadPath(child.id));
    ws.write(
      threadPath(child.id),
      text.replace("\n---\n", "\nresident:\n  name: researcher\n  docId: doc_researcher\n---\n"),
    );
    ws.reproject();

    // §7 allows a resident only on a standalone thread, and the contract
    // promises `resident` is always null on an anchored or whole-document one.
    expect((await readThread(child.id))["resident"]).toBeNull();
    expect(residentRow(child.id)).toEqual({ resident_name: null, resident_doc_id: null });

    // The release still clears it, rather than leaving a key no route can reach.
    expect((await release(child.id)).status).toBe(200);
    expect(Object.hasOwn(threadFrontmatterOf(ws, child.id), "resident")).toBe(false);
  });

  it("reads an unusable resident as no resident rather than failing the thread", async () => {
    const created = await createThread(ws, { body: "start" });
    const text = ws.read(threadPath(created.id));
    ws.write(threadPath(created.id), text.replace("\n---\n", "\nresident: mine\n---\n"));
    ws.reproject();

    // A corpus that used the key for something of its own stays readable.
    expect((await readThread(created.id))["resident"]).toBeNull();
    expect(residentRow(created.id)).toEqual({ resident_name: null, resident_doc_id: null });
  });
});

// SPEC.md §7's lanes (SERVER-111), against the real server: designation is what
// makes the walk answer differently, and the walk is what stamps the file a
// parked agent will claim from.
describe("what a designation routes", () => {
  /** The one pending event, as the queue wrote it — including its lane stamp. */
  const onlyPending = (): StoredEvent => {
    const events = pendingPayloads();
    expect(events).toHaveLength(1);
    return events[0] as StoredEvent;
  };

  it("stamps a reply in the designated conversation with that thread's lane", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    ws.advance(61_000);
    rmSync(join(ws.root, ".corpus", "queue", "pending"), { recursive: true, force: true });
    ws.server.queue.store.ensureLayoutSync();

    await appendTurn(ws, created.id, { body: "@researcher please", requestsAgent: true });

    expect(onlyPending().lane).toBe(created.id);
  });

  it("stamps a comment outside every scope with the orchestrator's lane", async () => {
    const designated = await createThread(ws, { body: "start" });
    await designate(designated.id, "researcher");
    ws.advance(61_000);
    const elsewhere = await createThread(ws, { body: "unrelated" });
    ws.advance(61_000);
    rmSync(join(ws.root, ".corpus", "queue", "pending"), { recursive: true, force: true });
    ws.server.queue.store.ensureLayoutSync();

    await appendTurn(ws, elsewhere.id, { body: "hello", requestsAgent: true });

    expect(onlyPending().lane).toBe("orchestrator");
  });

  // §7's one deliberate scope crossing. Routing follows the recipient, filing
  // follows the conversation: the lane is the summoned agent's, the payload
  // still names the host thread.
  it("routes a summons to the recipient's lane while filing it in the host thread", async () => {
    const designated = await createThread(ws, { body: "start" });
    await designate(designated.id, "researcher");
    ws.advance(61_000);
    const host = await createThread(ws, { body: "unrelated" });
    ws.advance(61_000);
    rmSync(join(ws.root, ".corpus", "queue", "pending"), { recursive: true, force: true });
    ws.server.queue.store.ensureLayoutSync();

    await appendTurn(ws, host.id, {
      body: "a question",
      requestsAgent: true,
      recipient: designated.id,
    });

    const event = onlyPending();
    expect(event.lane).toBe(designated.id);
    expect(event.payload["threadId"]).toBe(host.id);
  });

  // §7 stamps once and never rewrites: releasing does not strand queued work,
  // it only changes what the *next* enqueue is stamped with.
  it("leaves an already-queued event on its lane when the resident is released", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");
    ws.advance(61_000);
    rmSync(join(ws.root, ".corpus", "queue", "pending"), { recursive: true, force: true });
    ws.server.queue.store.ensureLayoutSync();
    await appendTurn(ws, created.id, { body: "first", requestsAgent: true });
    ws.advance(61_000);

    await release(created.id);
    ws.advance(61_000);

    expect(onlyPending().lane).toBe(created.id);
    await appendTurn(ws, created.id, { body: "second", requestsAgent: true });
    expect(
      pendingPayloads()
        .map((event) => event.lane)
        .sort(),
    ).toEqual([created.id, "orchestrator"].sort());
  });

  describe("a recipient that names no lane", () => {
    it("is a 422 naming the value, with nothing written", async () => {
      const thread = await createThread(ws, { body: "start" });
      ws.advance(61_000);
      const before = ws.read(threadPath(thread.id));
      const pendingBefore = pendingEvents(ws).length;

      const response = await ws.post(`/api/threads/${thread.id}/turns`, {
        body: "a question",
        requestsAgent: true,
        recipient: thread.id,
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: "unknown_recipient",
        recipient: thread.id,
      });
      expect(ws.read(threadPath(thread.id))).toBe(before);
      expect(pendingEvents(ws)).toHaveLength(pendingBefore);
    });

    it("refuses a thread that does not exist the same way", async () => {
      const thread = await createThread(ws, { body: "start" });
      ws.advance(61_000);

      const response = await ws.post(`/api/threads/${thread.id}/turns`, {
        body: "a question",
        recipient: "th_nosuchthread",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "unknown_recipient" });
    });

    it("refuses it on creation too, before a thread exists to have been written", async () => {
      const response = await ws.post("/api/threads", {
        body: "start",
        recipient: "th_nosuchthread",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "unknown_recipient" });
    });
  });
});
