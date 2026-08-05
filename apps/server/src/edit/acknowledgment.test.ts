// SPEC.md §4's edit acknowledgment, end to end: a real workspace, a real git
// repository, the real HTTP surface and the real file-backed queue.
//
// The unit suite beside this one decides *which range* the tracker names from a
// synthetic commit graph. This one asks the question that graph cannot: does a
// `PUT /api/docs/{id}` by a person, against a repository git actually wrote,
// produce one queue file whose range and stats describe what the person did.
//
// It also owns §4's **close** door — `POST /api/docs/{id}/edit-session/flush`
// (SERVER-057) — because every property that route publishes is a statement
// about the queue file it does or does not produce, which is the observable this
// file already reads.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDocEditedPayload, type DocEditedPayload } from "@corpus/contract";
import {
  AUTH,
  createDoc,
  createWriteWorkspace,
  type WriteWorkspace,
  type WriteWorkspaceOptions,
} from "../docs/write-fixture.js";

/** Short enough to watch a session idle out; the shipped window is three minutes. */
const IDLE_MS = 80;

const workspaces: WriteWorkspace[] = [];

function workspace(prefix: string, options: WriteWorkspaceOptions = {}): WriteWorkspace {
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
 * The flush as a real caller makes it: `POST`, no body, no acting party header.
 * `keepalive` is the browser's affair — on the wire it is this request.
 */
const flush = (ws: WriteWorkspace, id: string, headers: Record<string, string> = AUTH) =>
  ws.request(`/api/docs/${id}/edit-session/flush`, { method: "POST", headers });

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

describe("POST /api/docs/{id}/edit-session/flush", () => {
  it("ends the open session now, without waiting out §4's window", async () => {
    // The shipped window is three minutes and this workspace's is the default:
    // nothing here waits it out, which is the whole point of the route.
    const ws = workspace("flush-close");
    const doc = await createDoc(ws, { type: "note", title: "Put down", body: "one\n" });
    pastTheSquashWindow(ws);
    await edit(ws, doc.id, "one\ntwo\n");
    expect(acknowledgments(ws)).toHaveLength(0);

    const response = await flush(ws, doc.id);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");

    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    const payload = acknowledgments(ws)[0];
    expect(payload).toMatchObject({ docId: doc.id, actor: "user", endedBy: "close" });
    expect(payload?.to).toBe(ws.head());
    expect(payload?.stats.commits).toBe(1);
    expect(payload?.stats.insertions).toBeGreaterThan(0);
  });

  it("answers before the acknowledgment exists — emission is decided after the response", async () => {
    // The contract's reason for a bodyless `204`: at the moment the caller is
    // answered, whether an event follows is not yet known, so the response can
    // only state the postcondition.
    const ws = workspace("flush-after");
    const doc = await createDoc(ws, { type: "note", title: "Ordering", body: "a\n" });
    pastTheSquashWindow(ws);
    await edit(ws, doc.id, "a\nb\n");

    expect((await flush(ws, doc.id)).status).toBe(204);
    expect(acknowledgments(ws)).toHaveLength(0);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
  });

  it("emits exactly one event per session however many times it is flushed", async () => {
    // The route inherits the tracker's structural guarantee: `end()` removes the
    // session from the map before it emits, so the second flush finds nothing.
    // An unload path that fires twice — `pagehide` after `visibilitychange` — is
    // the case this makes free.
    const ws = workspace("flush-twice", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Twice", body: "x\n" });
    pastTheSquashWindow(ws);
    await edit(ws, doc.id, "x\ny\n");

    expect((await flush(ws, doc.id)).status).toBe(204);
    expect((await flush(ws, doc.id)).status).toBe(204);
    expect((await flush(ws, doc.id)).status).toBe(204);

    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    // And the other door finds nothing either: the window elapses on a session
    // that is already gone.
    ws.advance(IDLE_MS * 4);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 4));
    expect(acknowledgments(ws)).toHaveLength(1);
    expect(acknowledgments(ws)[0]?.endedBy).toBe("close");
  });

  it("does not re-acknowledge the flushed change when the reader reopens inside the squash window", async () => {
    // "Close the document, reopen within 30 seconds, fix a typo" — an ordinary
    // sitting, and before SERVER-052's review (PR #22) it produced two events
    // whose ranges overlapped: §4's squash amended the very commit the first
    // event had just named, so the second session opened at the *same* parent
    // and re-described the first session's change under a second `sessionId`
    // that no dedupe rule can match. The first event's `to` was left dangling
    // as well.
    const ws = workspace("ack-reopen");
    const doc = await createDoc(ws, { type: "note", title: "Reopened", body: "one\n" });
    pastTheSquashWindow(ws);

    await edit(ws, doc.id, "one\ntwo\n");
    const named = ws.head();
    expect((await flush(ws, doc.id)).status).toBe(204);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });

    // The clock does not move: the reopened reader is inside §4's 30 s squash
    // window, which is exactly the state that used to amend.
    await edit(ws, doc.id, "one\ntwo\nthree\n");
    expect(ws.head()).not.toBe(named);
    // The acknowledged commit is still on the branch, not rewritten under the
    // event that named it.
    expect(ws.log("%H")).toContain(named);
    expect(ws.git("rev-parse", "HEAD^").trim()).toBe(named);

    await ws.server.close();

    const payloads = acknowledgments(ws);
    expect(payloads).toHaveLength(2);
    // Adjacent, not overlapping: the second range starts where the first ended.
    const first = payloads.find((entry) => entry.to === named);
    const second = payloads.find((entry) => entry.from === named);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second?.to).toBe(ws.head());
    expect(new Set(payloads.map((entry) => entry.sessionId)).size).toBe(2);
    // And each range names exactly its own session's commit.
    for (const payload of payloads) {
      const commits = ws
        .git("rev-list", `${payload.from}..${payload.to}`)
        .trim()
        .split("\n")
        .filter((line) => line !== "");
      expect(commits).toHaveLength(1);
    }
  });

  it("answers 204 with no session open — never a 409 or a 'nothing to flush' 404", async () => {
    // The idempotence the contract publishes. A document that was only read has
    // no session, and the caller cannot know that: sessions open on the server's
    // own write path and close on a timer no client can observe.
    const ws = workspace("flush-idle-doc");
    const doc = await createDoc(ws, { type: "note", title: "Only read", body: "x\n" });

    expect((await flush(ws, doc.id)).status).toBe(204);
    expect((await flush(ws, doc.id)).status).toBe(204);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acknowledgments(ws)).toHaveLength(0);
  });

  it("answers 204 and emits nothing when the session's commits were all skipped (§14)", async () => {
    // A workspace with no git: every auto-commit is `skipped`, so there is no
    // revision to name and no session to end. The postcondition still holds, so
    // the answer is still `204` — the route reports the state, not the work.
    const ws = workspace("flush-no-git", { git: false });
    const doc = await createDoc(ws, { type: "note", title: "No git", body: "a\n" });
    await edit(ws, doc.id, "a\nb\n");

    expect((await flush(ws, doc.id)).status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acknowledgments(ws)).toHaveLength(0);
    // The write itself landed — only the acknowledgment did not.
    expect(ws.read(doc.path)).toContain("b");
  });

  it("404s for a document the projection does not have — the only 404 there is", async () => {
    const ws = workspace("flush-unknown");
    const response = await flush(ws, "doc_zzzzzzzz");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe("not_found");
  });

  it("requires the workspace token like every other route", async () => {
    const ws = workspace("flush-auth");
    const doc = await createDoc(ws, { type: "note", title: "Guarded", body: "x\n" });
    expect((await flush(ws, doc.id, {})).status).toBe(401);
  });
});
