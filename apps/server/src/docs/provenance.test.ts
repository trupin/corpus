// SERVER-110 end to end: a write names the job it serves, and the document it
// creates says which conversation that work came from (SPEC.md §7 scope, §9.2
// provenance). Real server, real queue, real git — the event ids below are ones
// the server actually enqueued.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "@corpus/contract";
import { AUTH, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

beforeEach(() => {
  ws = createWriteWorkspace("provenance", { sprint: "s032" });
});

afterEach(() => {
  ws.close();
});

const asAgent = { [ACTOR_HEADER]: "agent" };
const asUser = { [ACTOR_HEADER]: "user" };

/** A thread whose first turn requests the agent, and the event that enqueued. */
async function threadWithJob(): Promise<{ threadId: string; job: string }> {
  const created = await ws.post(
    "/api/threads",
    { title: "Mortgage", body: "@agent please look at this", requestsAgent: true },
    asUser,
  );
  expect(created.status).toBe(201);
  // `POST /api/threads` answers `{ thread, … }`, not the document envelope the
  // doc routes use.
  const threadId = ((await created.json()) as { thread: { id: string } }).thread.id;

  const claimed = await ws.post("/api/queue/claim-all", {}, asAgent);
  const { events } = (await claimed.json()) as { events: { id: string; type: string }[] };
  const job = events[0]?.id;
  expect(job).toBeDefined();
  return { threadId, job: job as string };
}

const originOf = async (id: string): Promise<string | null> => {
  const response = await ws.request(`/api/docs/${id}`);
  const body = (await response.json()) as { frontmatter: { origin: string | null } };
  return body.frontmatter.origin;
};

describe("a write that names its job is stamped with the conversation", () => {
  it("stamps a created document with the thread the job came from", async () => {
    const { threadId, job } = await threadWithJob();

    const created = await ws.post("/api/docs", { type: "note", title: "Draft", job }, asAgent);
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;

    expect(await originOf(id)).toBe(threadId);
  });

  it("writes it into the file, not only onto the wire", async () => {
    // Frontmatter-backed, in canonical key order: a projection rebuilt from
    // disk has to reach the same answer, and §7's scope walk reads it.
    const { threadId, job } = await threadWithJob();
    const created = await ws.post("/api/docs", { type: "note", title: "Draft", job }, asAgent);
    const doc = (await created.json()) as { doc: { frontmatter: { id: string }; path: string } };

    expect(ws.read(doc.doc.path)).toContain(`origin: ${threadId}`);
  });

  it("records nothing when the write names no job", async () => {
    // §9.2: "a write that names no job records no origin… forgetting it costs
    // provenance, never correctness." Nothing is refused.
    const created = await ws.post("/api/docs", { type: "note", title: "Unfiled" }, asAgent);
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;

    expect(await originOf(id)).toBeNull();
  });

  it("stamps a thread too, which is how a subthread joins the scope", async () => {
    const { threadId, job } = await threadWithJob();
    const created = await ws.post(
      "/api/threads",
      { title: "Follow-up", body: "a note", job },
      asAgent,
    );
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { thread: { id: string } }).thread.id;

    expect(await originOf(id)).toBe(threadId);
  });
});

describe("first writer wins", () => {
  it("never overwrites an origin a document already carries", async () => {
    // An edit that could re-file a document would let any later write move
    // someone else's artifact between conversations.
    const first = await threadWithJob();
    const created = await ws.post(
      "/api/docs",
      { type: "note", title: "Draft", job: first.job },
      asAgent,
    );
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;
    expect(await originOf(id)).toBe(first.threadId);

    const second = await threadWithJob();
    expect(second.threadId).not.toBe(first.threadId);
    const edited = await ws.put(
      `/api/docs/${id}`,
      { title: "Draft, revised", job: second.job },
      asAgent,
    );
    expect(edited.status).toBe(200);

    expect(await originOf(id)).toBe(first.threadId);
  });

  it("fills an origin an unfiled document does not have", async () => {
    const created = await ws.post("/api/docs", { type: "note", title: "Unfiled" }, asAgent);
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;
    expect(await originOf(id)).toBeNull();

    const { threadId, job } = await threadWithJob();
    expect((await ws.put(`/api/docs/${id}`, { title: "Filed", job }, asAgent)).status).toBe(200);

    expect(await originOf(id)).toBe(threadId);
  });
});

describe("detach — the person's correction", () => {
  it("clears the origin for a user", async () => {
    const { threadId, job } = await threadWithJob();
    const created = await ws.post("/api/docs", { type: "note", title: "Draft", job }, asAgent);
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;
    expect(await originOf(id)).toBe(threadId);

    expect((await ws.put(`/api/docs/${id}`, { origin: null }, asUser)).status).toBe(200);
    expect(await originOf(id)).toBeNull();
  });

  it("refuses an agent with a 403, the same doctrine as delete", async () => {
    // §9.2: detaching is a person's correction of where their work was filed,
    // and an agent that could undo it could quietly move an artifact out of the
    // scope it belongs to.
    const { job } = await threadWithJob();
    const created = await ws.post("/api/docs", { type: "note", title: "Draft", job }, asAgent);
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;

    const refused = await ws.put(`/api/docs/${id}`, { origin: null }, asAgent);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { message: string }).message).toContain("user-only");
  });

  it("refuses an attempt to *set* an origin, naming the field", async () => {
    // Clear-only, enforced here rather than in the type: a `{"type":"null"}`
    // schema reaches `openapi-fetch` as `never` (CONTRACT-050), so the wire
    // carries an ordinary nullable id and the write path is where "never set"
    // is true.
    const { threadId } = await threadWithJob();
    const created = await ws.post("/api/docs", { type: "note", title: "Draft" }, asAgent);
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;

    const refused = await ws.put(`/api/docs/${id}`, { origin: threadId }, asUser);
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { issues: { path: string }[] };
    expect(body.issues.some((issue) => issue.path === "body.origin")).toBe(true);
  });

  it("lets a later job claim a detached document — a correction, not a lock", async () => {
    const first = await threadWithJob();
    const created = await ws.post(
      "/api/docs",
      { type: "note", title: "Draft", job: first.job },
      asAgent,
    );
    const id = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter
      .id;
    expect((await ws.put(`/api/docs/${id}`, { origin: null }, asUser)).status).toBe(200);
    expect(await originOf(id)).toBeNull();

    const second = await threadWithJob();
    expect(
      (await ws.put(`/api/docs/${id}`, { title: "Re-filed", job: second.job }, asAgent)).status,
    ).toBe(200);

    expect(await originOf(id)).toBe(second.threadId);
  });
});

describe("a job that names no work this write can serve", () => {
  it("refuses an unknown id with a 422 naming it", async () => {
    const refused = await ws.post(
      "/api/docs",
      { type: "note", title: "Draft", job: "evt_nosuchevent" },
      asAgent,
    );

    expect(refused.status).toBe(422);
    const body = (await refused.json()) as { code: string; job: string; message: string };
    expect(body.code).toBe("unknown_job");
    expect(body.job).toBe("evt_nosuchevent");
    expect(body.message).toContain("evt_nosuchevent");
  });

  it("refuses a settled event, and says which state it is in", async () => {
    // Settled work cannot acquire a scope: a write claiming to serve it is a
    // stale id being reused, or a loop that never settled its own event.
    const { job } = await threadWithJob();
    expect((await ws.post(`/api/queue/${job}/complete`, {}, asAgent)).status).toBe(200);

    const refused = await ws.post("/api/docs", { type: "note", title: "Draft", job }, asAgent);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toContain("processed");
  });

  it("writes nothing when it refuses", async () => {
    // The refusal is raised before the file is written, so a caller that got the
    // id wrong has not half-created a document.
    const before = await ws.request("/api/docs?type=note");
    const countBefore = ((await before.json()) as { items: unknown[] }).items.length;

    await ws.post("/api/docs", { type: "note", title: "Draft", job: "evt_nope" }, asAgent);

    const after = await ws.request("/api/docs?type=note");
    expect(((await after.json()) as { items: unknown[] }).items.length).toBe(countBefore);
  });
});
