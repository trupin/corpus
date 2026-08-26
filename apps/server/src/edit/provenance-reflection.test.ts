// SERVER-110's `doc.edited` rule, end to end (PR #47 re-review).
//
// The first attempt at this test was abandoned with the note that "the write
// fixture wires no `editSessions`, so no `doc.edited` event is ever emitted
// there". **That was false** — `createWriteWorkspace` always passes a
// projection, and `app.ts` builds the tracker whenever one is present;
// `editAckIdleMs` only shortens the window rather than enabling it. This file
// is the test that should have been written, and it exercises the real
// `DocEditedPayload` against a real projection row rather than a hand-inserted
// one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTOR_HEADER } from "@corpus/contract";
import { createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";

const IDLE_MS = 50;
let ws: WriteWorkspace;

beforeEach(() => {
  ws = createWriteWorkspace("reflect", { sprint: "s032", editAckIdleMs: IDLE_MS });
});

afterEach(() => {
  ws.close();
});

const asAgent = { [ACTOR_HEADER]: "agent" };
const asUser = { [ACTOR_HEADER]: "user" };

const idOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { doc: { frontmatter: { id: string } } }).doc.frontmatter.id;

const originOf = async (id: string): Promise<string | null> => {
  const response = await ws.request(`/api/docs/${id}`);
  return ((await response.json()) as { frontmatter: { origin: string | null } }).frontmatter.origin;
};

describe("reflection work stays in the scope of what it reflects on", () => {
  it("files a follow-up written while working a `doc.edited` job into the edited document's scope", async () => {
    // A conversation, and a document filed into it.
    const thread = await ws.post(
      "/api/threads",
      { title: "Mortgage", body: "@agent look at this", requestsAgent: true },
      asUser,
    );
    const threadId = ((await thread.json()) as { thread: { id: string } }).thread.id;
    // Scoped, because SPEC.md §7's rider A designates a general resident on a
    // new standalone thread (SERVER-154) and the fallback is gone: this turn is
    // its lane's, and an unscoped claim never sees another lane's work.
    const firstClaim = await ws.post(`/api/queue/claim-all?scope=${threadId}`, {}, asAgent);
    const commentJob = ((await firstClaim.json()) as { events: { id: string }[] }).events[0]?.id;

    const filed = await idOf(
      await ws.post("/api/docs", { type: "note", title: "Draft", job: commentJob }, asAgent),
    );
    expect(await originOf(filed)).toBe(threadId);

    // A person edits it; the session goes idle and the server emits `doc.edited`.
    const read = await ws.request(`/api/docs/${filed}`);
    const key = ((await read.json()) as { key: string }).key;
    expect(
      (await ws.put(`/api/docs/${filed}`, { body: "revised by a person\n", key }, asUser)).status,
    ).toBe(200);

    ws.advance(IDLE_MS * 4);
    const reflection = await vi.waitFor(async () => {
      /*
       * Scoped, and the reason is the property this whole case is about
       * (SERVER-154). The filed document's `origin` reaches `threadId`, which
       * is a designated lane since rider A, so the scope walk stamps its
       * `doc.edited` for that lane — and with the fallback gone (SERVER-152) an
       * unscoped claim never sees it. The resident owning the artifacts its
       * conversation produced is exactly what §7 promises.
       */
      const claimed = await ws.post(`/api/queue/claim-all?scope=${threadId}`, {}, asAgent);
      const { events } = (await claimed.json()) as { events: { id: string; type: string }[] };
      const found = events.find((event) => event.type === "doc.edited");
      expect(found).toBeDefined();
      return found as { id: string };
    });

    // The agent reflects, and writes a note naming that job. It must land in the
    // *edited document's* conversation — a `doc.edited` event names no thread,
    // so without the document lookup this falls out of every scope.
    const follow = await idOf(
      await ws.post(
        "/api/docs",
        { type: "note", title: "What I noticed", job: reflection.id },
        asAgent,
      ),
    );

    expect(await originOf(follow)).toBe(threadId);
  });

  it("leaves a follow-up unfiled when the edited document belongs to no conversation", async () => {
    const unfiled = await idOf(
      await ws.post("/api/docs", { type: "note", title: "Loose note" }, asAgent),
    );
    expect(await originOf(unfiled)).toBeNull();

    const read = await ws.request(`/api/docs/${unfiled}`);
    const key = ((await read.json()) as { key: string }).key;
    expect((await ws.put(`/api/docs/${unfiled}`, { body: "edited\n", key }, asUser)).status).toBe(
      200,
    );

    ws.advance(IDLE_MS * 4);
    const reflection = await vi.waitFor(async () => {
      /*
       * **Unscoped, and that is the case** (SERVER-154). This document belongs
       * to no conversation, so its `doc.edited` falls in no scope and takes the
       * orchestrator's lane — the sibling above is scoped precisely because its
       * document *does* reach a designated thread. The two together are what
       * says the walk is doing the deciding.
       */
      const claimed = await ws.post("/api/queue/claim-all", {}, asAgent);
      const { events } = (await claimed.json()) as { events: { id: string; type: string }[] };
      const found = events.find((event) => event.type === "doc.edited");
      expect(found).toBeDefined();
      return found as { id: string };
    });

    const follow = await idOf(
      await ws.post("/api/docs", { type: "note", title: "Noticed", job: reflection.id }, asAgent),
    );

    expect(await originOf(follow)).toBeNull();
  });
});
