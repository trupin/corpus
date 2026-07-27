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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER, LockSchema, LockedErrorSchema } from "@corpus/contract";
import {
  AUTH,
  createDoc,
  createWriteWorkspace,
  type WriteWorkspace,
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

    const refused = await ws.put(`/api/docs/${docId}`, { body: "the user's edit" });

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

    const accepted = await ws.put(`/api/docs/${docId}`, { body: "the user's edit" });

    expect(accepted.status).toBe(200);
    expect(ws.read(`data/docs/inbox/mortgage-options.md`)).toContain("the user's edit");
    // And the commit is authored by the acting party, which is what makes
    // `git log` the audit trail (SPEC.md §4).
    expect(ws.log("%an|%ae")[0]).toBe("user|user@corpus.local");
  });

  it("never blocks the holder's own writes, nor any read", async () => {
    expect((await acquire(docId, "agent")).status).toBe(201);

    // The holder edits freely — holding the lock is what the lock is for.
    expect((await ws.put(`/api/docs/${docId}`, { body: "the agent's edit" }, asAgent)).status).toBe(
      200,
    );
    // And a read is never guarded: §7 locks editing, not looking.
    expect((await ws.request(`/api/docs/${docId}`, { headers: AUTH })).status).toBe(200);
  });

  it("guards every write verb, not just the edit", async () => {
    expect((await acquire(docId, "agent")).status).toBe(201);

    const verbs: { name: string; run: () => Promise<Response> }[] = [
      { name: "update", run: () => ws.put(`/api/docs/${docId}`, { body: "x" }) },
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
    const response = await ws.put(`/api/docs/${docId}`, { body: "after the lease" });

    expect(response.status).toBe(200);
  });
});
