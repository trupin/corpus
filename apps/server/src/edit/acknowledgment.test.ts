// SPEC.md §4's edit acknowledgment, end to end: a real workspace, a real git
// repository, the real HTTP surface and the real file-backed queue.
//
// The unit suite beside this one decides *which range* the tracker names from a
// synthetic commit graph. This one asks the question that graph cannot: does a
// `PUT /api/docs/{id}` by a person, against a repository git actually wrote,
// produce one queue file whose range and stats describe what the person did.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDocEditedPayload, type DocEditedPayload } from "@corpus/contract";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";

/** Short enough to watch a session idle out; the shipped window is three minutes. */
const IDLE_MS = 80;

const workspaces: WriteWorkspace[] = [];

function workspace(prefix: string, options: { editAckIdleMs?: number } = {}): WriteWorkspace {
  const ws = createWriteWorkspace(prefix, { sprint: "s011", ...options });
  workspaces.push(ws);
  return ws;
}

afterEach(async () => {
  for (const ws of workspaces.splice(0)) {
    await ws.server.close();
    ws.close();
  }
});

/** The queue's `pending/` directory is the observable: files are the source of truth (§7). */
function pendingEvents(ws: WriteWorkspace): { type: string; source: string; payload: unknown }[] {
  const dir = join(ws.root, ".corpus", "queue", "pending");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(dir, name), "utf8")) as {
          type: string;
          source: string;
          payload: unknown;
        },
    );
}

function acknowledgments(ws: WriteWorkspace): DocEditedPayload[] {
  return pendingEvents(ws)
    .map((event) => parseDocEditedPayload(event))
    .filter((payload): payload is DocEditedPayload => payload !== undefined);
}

const edit = (ws: WriteWorkspace, id: string, body: string, actor: "user" | "agent" = "user") =>
  ws.put(`/api/docs/${id}`, { body }, { "x-corpus-author": actor });

/**
 * §4's squash idle (30 s), stepped over so that a `POST /api/docs` and the edits
 * that follow are separate commits.
 *
 * Without it the create and the first save fold into **one** commit — same
 * document, same author, no time elapsed on the injected clock — and the session
 * that save opens is a session whose only commit *is* the create. That is a real
 * behaviour, pinned by its own case below; the suites that want to measure a
 * session's own lines step past it so the numbers say what they mean.
 */
const pastTheSquashWindow = (ws: WriteWorkspace): void => {
  ws.advance(60_000);
};

describe("doc.edited over the real write path", () => {
  it("acknowledges a user edit session once the acknowledgment window elapses", async () => {
    const ws = workspace("ack-idle", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, {
      type: "note",
      title: "Mortgage options",
      body: "First line.\n",
    });
    pastTheSquashWindow(ws);

    expect((await edit(ws, doc.id, "First line.\nSecond line.\nThird line.\n")).status).toBe(200);
    expect(acknowledgments(ws)).toHaveLength(0);

    ws.advance(IDLE_MS * 2);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });

    const [event] = pendingEvents(ws);
    expect(event?.source).toBe("edit");
    const payload = acknowledgments(ws)[0];
    expect(payload).toMatchObject({ docId: doc.id, actor: "user", endedBy: "idle" });
    expect(payload?.stats.commits).toBe(1);
    expect(payload?.stats.insertions).toBeGreaterThan(0);

    // The range is passable verbatim to git — which is the property that makes
    // it passable to `GET /api/docs/{id}/diff`.
    const range = ws.git(
      "diff",
      "--shortstat",
      `${payload?.from ?? ""}..${payload?.to ?? ""}`,
      "--",
      doc.path,
    );
    expect(range).toContain(`${String(payload?.stats.insertions)} insertion`);
    expect(payload?.to).toBe(ws.head());
  });

  it("never acknowledges an agent-authored edit — the loop cannot feed itself", async () => {
    const ws = workspace("ack-agent", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Agent note", body: "Before.\n" });

    expect((await edit(ws, doc.id, "After, rewritten by the agent.\n", "agent")).status).toBe(200);
    ws.advance(IDLE_MS * 4);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 4));

    expect(acknowledgments(ws)).toHaveLength(0);
    // And the commit really was the agent's — the write happened, only the
    // acknowledgment did not.
    expect(ws.log("%an")[0]).toBe("agent");
  });

  it("folds an editing session's repeated saves into one acknowledgment", async () => {
    const ws = workspace("ack-session", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Draft", body: "one\n" });
    pastTheSquashWindow(ws);

    await edit(ws, doc.id, "one\ntwo\n");
    await edit(ws, doc.id, "one\ntwo\nthree\n");
    await edit(ws, doc.id, "one\ntwo\nthree\nfour\n");

    ws.advance(IDLE_MS * 2);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    const payload = acknowledgments(ws)[0];
    // Three body lines, plus the one `updated:` line every save re-stamps: the
    // stats are of the *file*, frontmatter included, which is what makes them
    // agree with what `GET /api/docs/{id}/diff` will show for the same range.
    expect(payload?.stats).toEqual({ commits: 1, insertions: 4, deletions: 1 });
  });

  it("emits nothing for a session whose saves changed nothing", async () => {
    const ws = workspace("ack-noop", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Unchanged", body: "same\n" });

    // §4's autosave fires on a timer, so most saves carry the bytes already on
    // disk: `updateDocumentLocked` short-circuits and no commit lands.
    expect((await edit(ws, doc.id, "same\n")).status).toBe(200);
    ws.advance(IDLE_MS * 4);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 4));

    expect(acknowledgments(ws)).toHaveLength(0);
  });

  it("flushes an open session at shutdown rather than dropping the acknowledgment", async () => {
    const ws = createWriteWorkspace("ack-close", { sprint: "s011" });
    try {
      const doc = await createDoc(ws, {
        type: "note",
        title: "Open when the server stops",
        body: "a\n",
      });
      await edit(ws, doc.id, "a\nb\n");
      expect(acknowledgments(ws)).toHaveLength(0);

      await ws.server.close();

      const payloads = acknowledgments(ws);
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toMatchObject({ docId: doc.id, endedBy: "close", actor: "user" });
    } finally {
      ws.close();
    }
  });

  it("splits the session at an agent commit, so no range credits the user with the agent's work", async () => {
    const ws = createWriteWorkspace("ack-interleave", { sprint: "s011" });
    try {
      const doc = await createDoc(ws, { type: "note", title: "Shared", body: "line one\n" });
      pastTheSquashWindow(ws);

      await edit(ws, doc.id, "line one\nuser line\n");
      const beforeAgent = ws.head();
      await edit(ws, doc.id, "line one\nuser line\nagent line\n", "agent");
      const agentCommit = ws.head();
      await edit(ws, doc.id, "line one\nuser line\nagent line\nuser again\n");

      await ws.server.close();

      const payloads = acknowledgments(ws);
      expect(payloads).toHaveLength(2);
      // The first session ends at the commit before the agent's; the second
      // starts *from* the agent's commit. Neither range spans it.
      const first = payloads.find((entry) => entry.to === beforeAgent);
      const second = payloads.find((entry) => entry.from === agentCommit);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second?.to).toBe(ws.head());
      expect(new Set(payloads.map((entry) => entry.sessionId)).size).toBe(2);

      // And what each range reports is only that session's own line (plus the
      // `updated:` re-stamp) — the agent's line is in neither.
      expect(first?.stats).toEqual({ commits: 1, insertions: 2, deletions: 1 });
      // One line and no re-stamp: the agent's write already moved `updated` to
      // this (fixed) instant, so the user's save leaves the frontmatter alone.
      expect(second?.stats).toEqual({ commits: 1, insertions: 1, deletions: 0 });
    } finally {
      ws.close();
    }
  });

  it("acknowledges a document created and edited in one sitting as one whole change", async () => {
    // §4 folds a create and the saves that follow it into **one** commit, so the
    // session's only commit *is* the create and its range is that commit's own —
    // the whole document, frontmatter included. Deliberate: git has no sha
    // between the two halves of one commit to draw a smaller range at, and
    // "the person wrote this document" is a true thing to wake the agent for.
    const ws = workspace("ack-create-fold", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Brand new", body: "one\n" });
    await edit(ws, doc.id, "one\ntwo\n");

    ws.advance(IDLE_MS * 2);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    const payload = acknowledgments(ws)[0];
    expect(payload?.stats.commits).toBe(1);
    // Every line of the file, not just the one the edit added.
    expect(payload?.stats.insertions).toBe(ws.read(doc.path).split("\n").length - 1);
    expect(payload?.stats.deletions).toBe(0);
  });

  it("honours the window configured for the workspace", async () => {
    const ws = workspace("ack-window", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Configured", body: "x\n" });
    await edit(ws, doc.id, "x\ny\n");

    // Half the configured window: nothing yet, and the shipped three-minute
    // default would have said the same for another three minutes.
    ws.advance(IDLE_MS / 2);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 2));
    expect(acknowledgments(ws)).toHaveLength(0);

    ws.advance(IDLE_MS);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
  });
});
