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
  AUTH,
  appendTurn,
  createDoc,
  createThread,
  createThreadWorkspace,
  pendingEvents,
  threadFrontmatterOf,
  threadPath,
  type WriteWorkspace,
} from "./thread-fixture.js";
import { LANE_GRACE_MS } from "../queue/liveness.js";
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

/**
 * The same route with **no body at all** — §7's ordinary designation since the
 * SHARED-048 rider, which names no profile and requires nothing to exist first.
 *
 * Sent bodyless rather than as `{}` because the contract makes the body optional
 * in full and the two must be the same request; the `{}` spelling is exercised
 * separately below.
 */
const designateGeneral = (id: string, headers: Record<string, string> = {}) =>
  ws.request(`/api/threads/${id}/resident`, { method: "POST", headers: { ...AUTH, ...headers } });

const release = (id: string, headers: Record<string, string> = {}) =>
  ws.del(`/api/threads/${id}/resident`, headers);

const readThread = async (id: string): Promise<Record<string, unknown>> =>
  (await (await ws.request(`/api/threads/${id}`)).json()) as Record<string, unknown>;

/**
 * The projection's three resident columns.
 *
 * `resident_designated` is the one the lane predicate, the recipient check and
 * the park guard all ask (SERVER-121); the other two carry the *profile*, and
 * are null together for a general resident. They are read as one row here
 * precisely so a case cannot assert the profile and leave the flag unstated.
 */
const residentRow = (id: string): unknown =>
  ws.db
    .prepare("SELECT resident_designated, resident_name, resident_doc_id FROM threads WHERE id = ?")
    .get(id);

/** Just the flag — "is this conversation a lane", the question routing asks. */
const designatedRow = (id: string): number =>
  (
    ws.db.prepare("SELECT resident_designated AS d FROM threads WHERE id = ?").get(id) as
      { d: number } | undefined
  )?.d ?? -1;

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
      resident_designated: 1,
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

  /**
   * SERVER-125. A `type: agent-def` document under `data/docs/` used to
   * designate — the whole conversation handed to a persona Claude Code has never
   * heard of. It is refused now, and the refusal names the file, because this is
   * the one surface where somebody asks for a persona by name and waits.
   */
  it("refuses an agent-def filed outside `.claude/agents/`, and says which file it is", async () => {
    const created = await createThread(ws, { body: "start" });
    const misfiled = await createDoc(ws, { type: "agent-def", title: "Legacy", folder: "inbox" });
    expect(misfiled.path).toBe("data/docs/inbox/legacy.md");

    const response = await designate(created.id, "Legacy");

    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message).toContain("data/docs/inbox/legacy.md");
    expect(body.message).toContain(".claude/agents/");
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toBeUndefined();
  });

  it("keeps the plain refusal for a name that names no document at all", async () => {
    const created = await createThread(ws, { body: "start" });

    const body = (await (await designate(created.id, "nobody")).json()) as { message: string };

    expect(body.message).toContain("a designation names an agent-def the way a mention does");
    expect(body.message).not.toContain("data/docs");
  });

  /**
   * PR #50 NIT 9. `AgentNameSchema` accepts any non-blank single line, so a
   * padded name is a legal request; both lookups trim it before searching. The
   * refusals interpolated the caller's untrimmed bytes, and the off-root one
   * built `` `@<name>` `` out of them — quoting, as *the token that fails to
   * resolve*, a string the mention scanner can never produce: its charset is
   * `[A-Za-z0-9_-]+`, which admits neither the padding nor the space in a title
   * like `Legacy Analyst`.
   */
  it("quotes the trimmed name it looked up, and no mention token, in either refusal", async () => {
    const created = await createThread(ws, { body: "start" });
    const misfiled = await createDoc(ws, {
      type: "agent-def",
      title: "Legacy Analyst",
      folder: "inbox",
    });

    const offRoot = (await (await designate(created.id, "  Legacy Analyst  ")).json()) as {
      message: string;
    };
    const missing = (await (await designate(created.id, "  nobody  ")).json()) as {
      message: string;
    };

    expect(offRoot.message).toContain("no agent named Legacy Analyst in this workspace");
    expect(offRoot.message).toContain(misfiled.path);
    expect(missing.message).toContain("no agent named nobody in this workspace");
    // Nothing in either sentence is offered as something to type after a sigil.
    for (const message of [offRoot.message, missing.message]) expect(message).not.toContain("@");
  });

  it("refuses a designation that names nobody", async () => {
    const created = await createThread(ws, { body: "start" });

    expect((await designate(created.id, "")).status).toBe(400);
    expect((await designate(created.id, "   ")).status).toBe(400);
  });
});

// SPEC.md §7's SHARED-048 rider: "a designation may name a `type: agent-def`
// document ... or it may name **none**, in which case the conversation gets a
// **general resident** ... naming none is the ordinary case and requires nothing
// to exist first".
describe("designating with no profile at all", () => {
  it("succeeds on a bare POST, writing a legible general residency", async () => {
    const created = await createThread(ws, { body: "let us talk" });

    const response = await designateGeneral(created.id);
    const payload = (await response.json()) as {
      thread: { id: string; resident: { name: string | null; docId: string | null } | null };
      warnings: unknown[];
    };

    expect(response.status).toBe(200);
    // Two nulls, not a synthesised name: a word here would sit in the roster and
    // the composer's recipient list beside real profile names (CONTRACT-061).
    expect(payload.thread).toMatchObject({
      id: created.id,
      resident: { name: null, docId: null },
    });
    expect(payload.warnings).toEqual([]);
    // On disk, in the same `{name, docId}` shape a profiled residency uses, so a
    // person reading the markdown tells them apart by the values and not by a
    // second grammar. The key being *present* is the designation; releasing
    // removes it.
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({ name: null, docId: null });
    expect((await readThread(created.id))["resident"]).toEqual({ name: null, docId: null });
    // And in the projection: designated, with no profile.
    expect(residentRow(created.id)).toEqual({
      resident_designated: 1,
      resident_name: null,
      resident_doc_id: null,
    });
  });

  // The body is optional *in full*, so `{}` and no body must be one request.
  it("treats an empty body and no body as the same designation", async () => {
    const bodyless = await createThread(ws, { body: "one" });
    const empty = await createThread(ws, { body: "two" });

    expect((await designateGeneral(bodyless.id)).status).toBe(200);
    expect((await ws.post(`/api/threads/${empty.id}/resident`, {})).status).toBe(200);

    expect(threadFrontmatterOf(ws, bodyless.id)["resident"]).toEqual(
      threadFrontmatterOf(ws, empty.id)["resident"],
    );
    expect(designatedRow(bodyless.id)).toBe(designatedRow(empty.id));
  });

  // The frontmatter has to survive a round trip through the file the server
  // wrote — not just the in-memory value it had before serialising it — because
  // §5 makes the file the source of truth and the projection rebuilds from it.
  it("round-trips: a rebuilt projection still calls it a lane", async () => {
    const created = await createThread(ws, { body: "start" });
    await designateGeneral(created.id);

    // Everything re-read from the bytes on disk.
    ws.reproject();

    expect(designatedRow(created.id)).toBe(1);
    expect((await readThread(created.id))["resident"]).toEqual({ name: null, docId: null });
  });

  it("commits once, authored by the acting party, naming the act in words", async () => {
    const created = await createThread(ws, { body: "start" });
    ws.advance(61_000);
    const before = ws.log("%H").length;

    expect((await designateGeneral(created.id)).status).toBe(200);

    expect(ws.log("%H")).toHaveLength(before + 1);
    // A `git log` subject is prose about what happened; it chooses nothing and
    // is matched against nothing, so it may say in words what the field says by
    // being null.
    expect(ws.log("%s")[0]).toBe(
      `resident designate: general resident on ${titleOf(created)} (${created.id}) by user`,
    );
    expect(ws.log("%an")[0]).toBe("user");
  });

  it("enqueues resident.designated on the orchestrator's lane, carrying two nulls", async () => {
    const created = await createThread(ws, { body: "start" });

    await designateGeneral(created.id);

    expect(designations()).toMatchObject([
      {
        type: RESIDENT_DESIGNATED,
        source: "thread",
        status: "pending",
        // §7's carve-out holds whoever is designated: the resident does not
        // announce itself to itself, and a general one is no exception.
        lane: "orchestrator",
        payload: { threadId: created.id, resident: { name: null, docId: null } },
      },
    ]);
  });

  it("announces the same keys a profiled designation does", async () => {
    const created = await createThread(ws, { body: "start" });

    const frames = await framesDuring(() => designateGeneral(created.id));

    expect(frames[0]).toEqual([
      ["docs"],
      ["docs", created.id],
      ["threads", created.id],
      ["agents"],
    ]);
  });

  it("refuses the agent and a parented thread, exactly as a named designation does", async () => {
    const standalone = await createThread(ws, { body: "start" });
    const parent = (await createDoc(ws, { type: "note", title: "Model", body: "A body.\n" })).id;
    const child = await createThread(ws, { parent, body: "about all of it" });

    expect((await designateGeneral(standalone.id, AGENT)).status).toBe(403);
    expect((await designateGeneral(child.id)).status).toBe(409);
    expect((await designateGeneral("th_zzzzzzzz")).status).toBe(404);
    expect(threadFrontmatterOf(ws, standalone.id)["resident"]).toBeUndefined();
    expect(threadFrontmatterOf(ws, child.id)["resident"]).toBeUndefined();
  });

  // Single-valued in both directions, and the *name* is what moves: a general
  // residency is not a lesser state a profile is layered onto.
  it("replaces in both directions, one write each way", async () => {
    const created = await createThread(ws, { body: "start" });

    await designateGeneral(created.id);
    ws.advance(61_000);
    expect((await designate(created.id, "researcher")).status).toBe(200);
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });

    ws.advance(61_000);
    const before = ws.log("%H").length;
    expect((await designateGeneral(created.id)).status).toBe(200);

    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({ name: null, docId: null });
    expect(ws.log("%H")).toHaveLength(before + 1);
    expect(designations().map((event) => event.payload["resident"])).toEqual([
      { name: null, docId: null },
      { name: "researcher", docId: "doc_researcher" },
      { name: null, docId: null },
    ]);
  });

  it("writes nothing when it is already general — but still announces it", async () => {
    const created = await createThread(ws, { body: "start" });
    await designateGeneral(created.id);
    ws.advance(61_000);
    const before = ws.log("%H").length;
    const text = ws.read(threadPath(created.id));

    expect((await designateGeneral(created.id)).status).toBe(200);

    expect(ws.read(threadPath(created.id))).toBe(text);
    expect(ws.log("%H")).toHaveLength(before);
    // Re-issuing is how a person asks for a listener that is no longer running
    // to be launched again — the same reason a profiled re-designation enqueues.
    expect(designations()).toHaveLength(2);
  });

  it("releases like any other resident, and is released by resolving", async () => {
    const released = await createThread(ws, { body: "one" });
    const resolved = await createThread(ws, { body: "two" });
    await designateGeneral(released.id);
    await designateGeneral(resolved.id);
    ws.advance(61_000);

    expect((await release(released.id)).status).toBe(200);
    expect((await ws.post(`/api/threads/${resolved.id}/resolve`, {})).status).toBe(200);

    for (const id of [released.id, resolved.id]) {
      expect([id, Object.hasOwn(threadFrontmatterOf(ws, id), "resident")]).toEqual([id, false]);
      expect([id, designatedRow(id)]).toEqual([id, 0]);
      expect([id, (await readThread(id))["resident"]]).toEqual([id, null]);
    }
  });

  // §7's release announces the roster because a lane leaves it. This would pass
  // vacuously if a general residency had never been a lane in the first place,
  // which is why the row's disappearance is asserted through the real route
  // rather than through the key alone.
  it("leaves the roster when released", async () => {
    const created = await createThread(ws, { body: "start" });
    await designateGeneral(created.id);
    const lanes = async (): Promise<string[]> =>
      (
        (await (await ws.request("/api/agents")).json()) as { agents: { lane: string }[] }
      ).agents.map((row) => row.lane);

    expect(await lanes()).toContain(created.id);
    ws.advance(61_000);
    await release(created.id);

    expect(await lanes()).not.toContain(created.id);
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
    expect(residentRow(created.id)).toEqual({
      resident_designated: 0,
      resident_name: null,
      resident_doc_id: null,
    });
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
    expect(residentRow(created.id)).toEqual({
      resident_designated: 0,
      resident_name: null,
      resident_doc_id: null,
    });

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

  // SPEC.md §7's SHARED-048 rider: "a profile that is renamed or archived after
  // designation does not end the designation: the resident goes on owning its
  // scope, and the missing profile is **reported rather than silently
  // substituted**". The report is `docId: null` — the contract's `docId` is what
  // the name resolves to *right now* — and repeating the stored id instead would
  // send a reader to a document the workspace no longer has, which is the exact
  // failure the re-read exists to prevent.
  it("reports a gone agent-def as a null docId, keeping the name it was designated with", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");

    rmSync(join(ws.root, ".claude", "agents", "researcher.md"));
    ws.reproject();

    expect((await readThread(created.id))["resident"]).toEqual({
      name: "researcher",
      docId: null,
    });
    // Nothing was rewritten to say so: the designation stands, and the file
    // still holds the pair it was written with.
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
    // And it is still a lane — a missing persona ends nothing (§7).
    expect(designatedRow(created.id)).toBe(1);
  });

  /**
   * The third way `Resident.docId` goes null, and the one SERVER-125 created:
   * the profile was **moved out of `.claude/agents/`** (`ResidentSchema.docId`
   * — "renamed, archived, or moved out of `.claude/agents/`, the root a persona
   * has to live in to be addressable at all"). It is not the deleted case in
   * different words: the document is still there, still projected under the very
   * id the designation stored, still listed and readable — and the read still
   * says null, because `currentResident` re-resolves through
   * `resolveMentionTarget`, which is gated on `invocableName` and answers
   * nothing for a persona filed off-root.
   *
   * **Reached by hand, because nothing else can reach it.** `POST
   * /api/docs/{id}/move` refuses a document that is not under `data/docs/`
   * outright (`assertMovable`), so the state exists only in a workspace somebody
   * moved a file in — which §5 makes as real as anything the server writes, and
   * which is exactly the workspace this claim was published for.
   */
  it("reports a profile moved out of `.claude/agents/` as null, though the document is still there", async () => {
    const created = await createThread(ws, { body: "start" });
    await designate(created.id, "researcher");

    // The API cannot produce this state; the refusal is what makes the hand
    // move below the workspace's only route to it.
    const refused = await ws.post("/api/docs/doc_researcher/move", { folder: "inbox" });
    expect(refused.status).toBe(400);

    const profile = ws.read(".claude/agents/researcher.md");
    rmSync(join(ws.root, ".claude", "agents", "researcher.md"));
    // Filed where an explicit `--folder` still puts it (SERVER-122): the same
    // bytes, plus the `type:` the `.claude/agents/` root used to supply, so it
    // is still a `type: agent-def` document — a document *about* a persona.
    ws.write("data/docs/researcher.md", profile.replace("---\n", "---\ntype: agent-def\n"));
    ws.reproject();

    expect((await readThread(created.id))["resident"]).toEqual({
      name: "researcher",
      docId: null,
    });
    // The document it used to resolve to is still a document, under the same id
    // — so the null is about the root and not about existence. This is the whole
    // difference from the deleted case above.
    const still = await ws.request("/api/docs/doc_researcher");
    expect(still.status).toBe(200);
    expect(((await still.json()) as { path: string }).path).toBe("data/docs/researcher.md");
    // Nothing was rewritten, on disk or in the row: the projection stores the
    // pair verbatim and only the read re-resolves.
    expect(threadFrontmatterOf(ws, created.id)["resident"]).toEqual({
      name: "researcher",
      docId: "doc_researcher",
    });
    expect(residentRow(created.id)).toEqual({
      resident_designated: 1,
      resident_name: "researcher",
      resident_doc_id: "doc_researcher",
    });
    // And the same gate now refuses a fresh designation by that name, naming the
    // file it will not use (SERVER-125).
    const response = await designate(created.id, "researcher");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { message: string }).message).toContain(
      "data/docs/researcher.md",
    );
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
    expect(residentRow(child.id)).toEqual({
      resident_designated: 0,
      resident_name: null,
      resident_doc_id: null,
    });

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
    expect(residentRow(created.id)).toEqual({
      resident_designated: 0,
      resident_name: null,
      resident_doc_id: null,
    });
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

  // SPEC.md §7's SHARED-048 rider, in the one place the claim is cheapest to
  // break and hardest to notice: "everything else about a resident is identical
  // either way — the lane, the scope, presence, the lapse fallback, release, and
  // resolution releasing it". Every case here is written to go red against a
  // server that quietly routed a general resident's work to the orchestrator,
  // which is what the pre-SERVER-121 predicate did.
  describe("a general resident routes exactly as a profiled one", () => {
    /** Everything queued so far, cleared, so a case measures only its own event. */
    const drainQueue = (): void => {
      rmSync(join(ws.root, ".corpus", "queue", "pending"), { recursive: true, force: true });
      ws.server.queue.store.ensureLayoutSync();
    };

    const claimed = async (scope?: string): Promise<string[]> => {
      const query = scope === undefined ? "" : `?scope=${scope}`;
      const response = await ws.post(`/api/queue/claim-all${query}`, {});
      expect(response.status).toBe(200);
      return ((await response.json()) as { events: { id: string }[] }).events.map(
        (event) => event.id,
      );
    };

    /** Parks a scoped `idle`, which is the whole of §7's presence. */
    function park(scope: string): { done: Promise<Response>; leave: () => void } {
      const controller = new AbortController();
      const done = ws
        .request(`/api/queue/idle?timeout=60&scope=${scope}`, {
          headers: AUTH,
          signal: controller.signal,
        })
        .catch(() => new Response(null, { status: 499 }));
      return {
        done,
        leave: () => {
          controller.abort();
        },
      };
    }

    /** The park has to reach the handler before anything is asked about it. */
    const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 50));

    it("stamps a reply in its own conversation with that thread's lane", async () => {
      const created = await createThread(ws, { body: "start" });
      await designateGeneral(created.id);
      ws.advance(61_000);
      drainQueue();

      await appendTurn(ws, created.id, { body: "please look", requestsAgent: true });

      expect(onlyPending().lane).toBe(created.id);
    });

    it("owns the artifacts its conversation produced, walked at enqueue time", async () => {
      const created = await createThread(ws, { body: "start" });
      await designateGeneral(created.id);
      ws.advance(61_000);
      // §7's scope is *computed* by walking `origin`, never stored, so what this
      // needs is a document filed into the conversation. The stamp itself is
      // `docs/create.ts`'s and SERVER-110's subject; here it is written into the
      // frontmatter directly, which §5 makes as real as anything the server
      // wrote, so the case is about the walk and nothing else.
      const draft = await createDoc(ws, { type: "note", title: "Draft", body: "A body.\n" });
      const path = (
        ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(draft.id) as { path: string }
      ).path;
      const text = ws.read(path);
      ws.write(path, text.replace("\n---\n", `\norigin: ${created.id}\n---\n`));
      ws.reproject();

      ws.advance(61_000);
      const onDraft = await createThread(ws, { parent: draft.id, body: "a comment" });
      ws.advance(61_000);
      drainQueue();

      // §7's point of the whole scope: the conversation that produced a draft,
      // and a comment left on that draft, reach the same agent.
      await appendTurn(ws, onDraft.id, { body: "please look", requestsAgent: true });

      expect(onlyPending().lane).toBe(created.id);
    });

    it("is addressable as a recipient from outside its scope", async () => {
      const designated = await createThread(ws, { body: "start" });
      await designateGeneral(designated.id);
      ws.advance(61_000);
      const host = await createThread(ws, { body: "unrelated" });
      ws.advance(61_000);
      drainQueue();

      await appendTurn(ws, host.id, {
        body: "a question",
        requestsAgent: true,
        recipient: designated.id,
      });

      // Routing follows the recipient, filing follows the conversation.
      const event = onlyPending();
      expect(event.lane).toBe(designated.id);
      expect(event.payload["threadId"]).toBe(host.id);
    });

    // The partition, and §7's lapse fallback, on a lane with no profile: while it
    // is live the orchestrator sees nothing of it, and once it has lapsed the
    // same claim hands the work over — with nothing about the lapse written into
    // the event.
    it("hides its live lane from the unscoped claim and hands it over once lapsed", async () => {
      const created = await createThread(ws, { body: "start" });
      await designateGeneral(created.id);
      ws.advance(61_000);
      // The designation itself is the orchestrator's (§7's carve-out), so it has
      // to be off the board before this measures anything.
      expect(await claimed()).toHaveLength(1);

      const parked = park(created.id);
      await settle();
      await appendTurn(ws, created.id, { body: "please look", requestsAgent: true });

      expect(await claimed()).toEqual([]);
      expect(await claimed(created.id)).toHaveLength(1);

      parked.leave();
      await parked.done;
    });

    it("lapses to the orchestrator when nobody is parked on it", async () => {
      const created = await createThread(ws, { body: "start" });
      await designateGeneral(created.id);
      ws.advance(61_000);
      expect(await claimed()).toHaveLength(1);
      await appendTurn(ws, created.id, { body: "please look", requestsAgent: true });
      ws.advance(LANE_GRACE_MS * 2);

      // Never live, so long lapsed: §7's cost of a lapse is that the work is
      // done by the orchestrator, never that it is silently not done.
      expect(await claimed()).toHaveLength(1);
    });

    // §7: presence is asked at the request and never re-asked of one already
    // admitted, so a park survives its lane's residency changing under it —
    // including a profiled residency going general and back.
    it("keeps an in-flight park when the residency changes shape", async () => {
      const created = await createThread(ws, { body: "start" });
      await designate(created.id, "researcher");
      ws.advance(61_000);
      const parked = park(created.id);
      await settle();

      expect((await designateGeneral(created.id)).status).toBe(200);

      const status = (await (await ws.request("/api/queue/status")).json()) as {
        agent: { live: boolean };
      };
      expect(status.agent.live).toBe(true);

      parked.leave();
      await parked.done;
    });
  });
});
