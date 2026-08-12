// The lock guard where it actually matters: mounted on the document write path
// (SPEC.md §7, "the other party's edit is refused with a 423 naming the holder").
//
// SERVER-009 could only prove the guard in isolation — its worktree had no write
// route to mount it on — so `guard.test.ts` drives it through a bare Hono app.
// This is the other half, and it is deliberately end to end: a real workspace, a
// real git repository, the real `createServer` wiring, and the lock taken over
// HTTP rather than by writing a file. What is being tested is not
// `assertWritable` (that is covered) but that `createServer` hands it to every
// write verb — a wiring mistake no unit test can see.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER, LockSchema, LockedErrorSchema } from "@corpus/contract";
import {
  AUTH,
  createDoc,
  createWriteWorkspace,
  type WriteWorkspace,
  putDoc,
} from "../docs/write-fixture.js";

let ws: WriteWorkspace;
let docId: string;

const asAgent: Record<string, string> = { [ACTOR_HEADER]: "agent" };

const acquire = async (id: string, actor: "user" | "agent"): Promise<Response> =>
  ws.server.app.request(`/api/locks/${id}`, {
    method: "POST",
    headers: { ...AUTH, [ACTOR_HEADER]: actor },
  });

const release = async (id: string, actor: "user" | "agent"): Promise<Response> =>
  ws.server.app.request(`/api/locks/${id}`, {
    method: "DELETE",
    headers: { ...AUTH, [ACTOR_HEADER]: actor },
  });

beforeEach(async () => {
  ws = createWriteWorkspace("lockguard");
  const created = await createDoc(ws, { type: "note", title: "Mortgage options" });
  docId = created.id;
});

afterEach(() => {
  ws.close();
});

describe("a document held by the other party", () => {
  it("refuses the write with 423 and hands it back once the lease is released", async () => {
    const taken = await acquire(docId, "agent");
    expect(taken.status).toBe(201);
    const lock = LockSchema.parse(await taken.json());
    const headBefore = ws.head();
    const fileBefore = ws.read(`data/docs/inbox/mortgage-options.md`);

    const refused = await putDoc(ws, docId, { body: "the user's edit" });

    expect(refused.status).toBe(423);
    // The body is the contract's `LockedError`, carrying the live lock — holder,
    // when it was acquired and how long it runs — so a client can say who to ask.
    expect(LockedErrorSchema.parse(await refused.json())).toEqual({
      code: "locked",
      message: `${docId} is being edited by agent; the lock was acquired at ${lock.acquired}`,
      lock,
    });
    // Refused before anything was read or written: the file and the audit trail
    // are byte-for-byte what they were.
    expect(ws.read(`data/docs/inbox/mortgage-options.md`)).toBe(fileBefore);
    expect(ws.head()).toBe(headBefore);

    expect((await release(docId, "agent")).status).toBe(200);

    const accepted = await putDoc(ws, docId, { body: "the user's edit" });

    expect(accepted.status).toBe(200);
    expect(ws.read(`data/docs/inbox/mortgage-options.md`)).toContain("the user's edit");
    // And the commit is authored by the acting party, which is what makes
    // `git log` the audit trail (SPEC.md §4).
    expect(ws.log("%an|%ae")[0]).toBe("user|user@corpus.local");
  });

  it("never blocks the holder's own writes, nor any read", async () => {
    expect((await acquire(docId, "agent")).status).toBe(201);

    // The holder edits freely — holding the lock is what the lock is for.
    expect((await putDoc(ws, docId, { body: "the agent's edit" }, asAgent)).status).toBe(200);
    // And a read is never guarded: §7 locks editing, not looking.
    expect((await ws.request(`/api/docs/${docId}`, { headers: AUTH })).status).toBe(200);
  });

  it("guards every write verb, not just the edit", async () => {
    expect((await acquire(docId, "agent")).status).toBe(201);

    const verbs: { name: string; run: () => Promise<Response> }[] = [
      { name: "update", run: () => putDoc(ws, docId, { body: "x" }) },
      { name: "move", run: () => ws.post(`/api/docs/${docId}/move`, { folder: "finance" }) },
      { name: "archive", run: () => ws.post(`/api/docs/${docId}/archive`, {}) },
      { name: "unarchive", run: () => ws.post(`/api/docs/${docId}/unarchive`, {}) },
      { name: "delete", run: () => ws.del(`/api/docs/${docId}`) },
    ];

    for (const verb of verbs) {
      const response = await verb.run();
      expect({ verb: verb.name, status: response.status }).toEqual({
        verb: verb.name,
        status: 423,
      });
    }
    // Nothing got through: the document is still where it was, still open.
    expect(ws.exists("data/docs/inbox/mortgage-options.md")).toBe(true);
  });

  it("stops blocking the moment the lease expires, with no reaper run", async () => {
    expect((await acquire(docId, "agent")).status).toBe(201);
    ws.advance(301_000);

    // The lock file is still on disk — nothing has unlinked it — but a lease
    // that has run out refuses nothing.
    const response = await putDoc(ws, docId, { body: "after the lease" });

    expect(response.status).toBe(200);
  });
});

// SERVER-022 finding 7. Every write verb ran `assertWritable` *before* entering
// the document's serialization lane, so a write queued behind another operation
// on the same document was judged against a lock state that could be minutes
// old by the time it ran. The other party taking the lease in that interval —
// the ordinary case: a lock is taken because someone means to edit *now* — did
// not refuse it, and two parties wrote the same document.
//
// The interval is widened with a real `pre-commit` hook that parks the holding
// mutation inside its own commit until this test releases it. No sleep, no fake
// timer, no injected mutex: the lane is genuinely held, over real HTTP, for as
// long as the test needs it.
describe("a lease acquired while a write is queued", () => {
  const DOC_PATH = "data/docs/inbox/mortgage-options.md";

  /** Parks the next commit until {@link gatePath} appears; later commits pass straight through. */
  function installParkingHook(): { readonly started: string; readonly gate: string } {
    const hooks = join(ws.root, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    const started = join(ws.root, ".git", "corpus-hook-started");
    const gate = join(ws.root, ".git", "corpus-hook-gate");
    writeFileSync(
      join(hooks, "pre-commit"),
      [
        "#!/bin/sh",
        `: > "${started}"`,
        "i=0",
        // Bounded, so a test that never releases fails on its assertion rather
        // than leaving a shell spinning for the rest of the run.
        `while [ ! -f "${gate}" ] && [ "$i" -lt 200 ]; do sleep 0.05; i=$((i+1)); done`,
        "exit 0",
      ].join("\n"),
      "utf8",
    );
    chmodSync(join(hooks, "pre-commit"), 0o755);
    return { started, gate };
  }

  const waitForFile = async (path: string): Promise<void> => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (existsSync(path)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${path}`);
  };

  /**
   * Holds `laneDocId`'s lane with a real mutation, issues `queued` behind it,
   * lets the *other* party take the lease in between, and answers with what the
   * queued request got.
   */
  async function whileQueuedBehindALockedLane(
    lane: { readonly docId: string; readonly path: string },
    lockedDocId: string,
    queued: () => Promise<Response>,
  ): Promise<{ readonly response: Response; readonly fileBefore: string }> {
    const { started, gate } = installParkingHook();
    const holding = putDoc(ws, lane.docId, { body: "the save that holds the lane" });
    await waitForFile(started);

    const waiting = queued();
    // The lease is taken while `waiting` sits in the lane — after the point the
    // guard used to be consulted, before the point the write happens.
    expect((await acquire(lockedDocId, "agent")).status).toBe(201);

    // The state the queued verb must leave untouched is the one the holding save
    // left behind, not the one this test started from — and it is read while the
    // queued request is still parked, so nothing has raced it.
    const fileBefore = ws.read(lane.path);

    writeFileSync(gate, "", "utf8");
    expect((await holding).status).toBe(200);
    return { response: await waiting, fileBefore };
  }

  it.each([
    ["update", (): Promise<Response> => putDoc(ws, docId, { body: "the queued save" })],
    ["move", (): Promise<Response> => ws.post(`/api/docs/${docId}/move`, { folder: "finance" })],
    ["archive", (): Promise<Response> => ws.post(`/api/docs/${docId}/archive`, {})],
    ["delete", (): Promise<Response> => ws.del(`/api/docs/${docId}`)],
  ])("refuses a queued %s with 423", async (_verb, run) => {
    const { response, fileBefore } = await whileQueuedBehindALockedLane(
      { docId, path: DOC_PATH },
      docId,
      run,
    );

    expect(response.status).toBe(423);
    expect(LockedErrorSchema.parse(await response.json()).lock.holder).toBe("agent");
    // And nothing of the refused verb happened: same bytes, same path.
    expect(ws.exists(DOC_PATH)).toBe(true);
    expect(ws.read(DOC_PATH)).toBe(fileBefore);
  });

  it("refuses a queued unarchive with 423", async () => {
    expect((await ws.post(`/api/docs/${docId}/archive`, {})).status).toBe(200);

    const { response, fileBefore } = await whileQueuedBehindALockedLane(
      { docId, path: DOC_PATH },
      docId,
      () => ws.post(`/api/docs/${docId}/unarchive`, {}),
    );

    expect(response.status).toBe(423);
    expect(fileBefore).toContain("status: archived");
    expect(ws.read(DOC_PATH)).toBe(fileBefore);
  });

  it("refuses a queued anchored comment with 423, on the parent's lease", async () => {
    // Thread creation is guarded on the **parent**, and only when an anchor
    // entry is actually written into it (sprint-006 Adjudication 1).
    const parent = await createDoc(ws, {
      type: "note",
      title: "Anchored parent",
      body: "The model assumes a 30-year fixed at 6.1% throughout.",
    });

    const { response, fileBefore } = await whileQueuedBehindALockedLane(
      { docId: parent.id, path: parent.path },
      parent.id,
      () =>
        ws.post("/api/threads", {
          parent: parent.id,
          body: "is this still right?",
          selector: { exact: "a 30-year fixed at 6.1%" },
        }),
    );

    expect(response.status).toBe(423);
    // No anchor entry was written: the parent is byte-for-byte untouched.
    expect(fileBefore).toContain("anchors: {}");
    expect(ws.read(parent.path)).toBe(fileBefore);
  });

  it("refuses a queued last-turn deletion with 423, on the parent's lease", async () => {
    const parent = await createDoc(ws, {
      type: "note",
      title: "Cascade parent",
      body: "The model assumes a 30-year fixed at 6.1% throughout.",
    });
    const created = await ws.post("/api/threads", {
      parent: parent.id,
      body: "only turn",
      selector: { exact: "a 30-year fixed at 6.1%" },
    });
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { thread: { id: string }; anchorId: string };
    const threadId = payload.thread.id;
    const turns = (await (
      await ws.request(`/api/threads/${threadId}`, { headers: AUTH })
    ).json()) as {
      turns: { ts: string }[];
    };
    const ts = turns.turns[0]?.ts ?? "";

    const { response, fileBefore } = await whileQueuedBehindALockedLane(
      { docId: parent.id, path: parent.path },
      parent.id,
      () => ws.del(`/api/threads/${threadId}/turns/${encodeURIComponent(ts)}`),
    );

    expect(response.status).toBe(423);
    // The anchor entry the cascade would have removed is still in the parent.
    expect(fileBefore).toContain(payload.anchorId);
    expect(ws.read(parent.path)).toBe(fileBefore);
  });

  it("does not slow an unlocked write into a different outcome", async () => {
    // The same queueing, with nobody taking a lease: one save, one commit, the
    // ordinary answer. Re-running the guard must not double a side effect.
    const commitsBefore = ws.log("%H").length;
    const { started, gate } = installParkingHook();
    const holding = putDoc(ws, docId, { body: "first" });
    await waitForFile(started);
    const queued = putDoc(ws, docId, { body: "second" });
    writeFileSync(gate, "", "utf8");

    expect((await holding).status).toBe(200);
    const response = await queued;

    expect(response.status).toBe(200);
    expect(ws.read(DOC_PATH)).toContain("second");
    // Both saves are inside one squash window by the same author, so they fold
    // into one auto-commit — exactly as they do without a lane held. Re-running
    // the guard doubled no side effect.
    // …which here means folding into the create's own session commit, since the
    // fixture clock has not moved: one commit, describing the latest save.
    expect(ws.log("%H").length).toBe(commitsBefore);
    expect(ws.log("%s")[0]).toContain(`doc edit:`);
    expect(ws.git("status", "--porcelain").trim()).toBe("");
  });
});
