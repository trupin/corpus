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
  putDoc,
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
  putDoc(ws, id, { body }, { "x-corpus-author": actor });

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
      await edit(ws, doc.id, "line one\nuser line\nagent line\n", "agent");
      await edit(ws, doc.id, "line one\nuser line\nagent line\nuser again\n");
      // Both named by position, not by the sha each had when it landed: a window
      // no act named is relabelled as it closes (SERVER-091), which is an amend
      // and so a new sha for the same tree. The user's first save was closed by
      // the agent's write; the agent's was closed by the user's third.
      const userCommit = ws.git("rev-parse", "HEAD~2").trim();
      const agentCommit = ws.git("rev-parse", "HEAD^").trim();

      await ws.server.close();

      const payloads = acknowledgments(ws);
      expect(payloads).toHaveLength(2);
      // The first session ends at the commit before the agent's; the second
      // starts *from* the agent's commit. Neither range spans it.
      //
      // CLOSED (SERVER-091 escalated it, SERVER-093 fixed it): the agent's write
      // closed the user's window, which relabelled its commit — an amend, so a
      // new sha for the same tree. The first session's `to` is that *new* sha,
      // because the commit path now tells the tracker when a close moves one and
      // the tracker follows it. Before the fix this named the sha the commit had
      // beforehand: identical content, but an object no branch reaches, which is
      // exactly what PR #22 forbade for any sha the server publishes.
      const first = payloads.find((entry) => entry.to === userCommit);
      const second = payloads.find((entry) => entry.from === agentCommit);
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      // The published guarantee itself, stated as such: every sha either event
      // names is one `git log` finds.
      const branch = ws.log("%H");
      for (const payload of payloads) expect(branch).toContain(payload.to);
      expect(branch).toContain(second?.from);
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

// SPEC.md §4, party-scoped windows (SERVER-091): "Where several documents share
// one window commit, each document's acknowledgment names that same commit."
//
// A window belongs to a *party*, not to a document, so a save to document B
// **amends** the commit document A's session is sitting on. Nothing about that
// amend reaches A through `observeCommit` — the write names B — so until PR #42's
// review the second door of SERVER-093's hazard was open: A's acknowledgment
// named a sha two rewrites behind the branch. Under the pre-rider fold key
// (`docId` + actor) it was unreachable, which is why no earlier case covers it.
describe("one commit window, several documents", () => {
  it("names one commit from every document's acknowledgment, and it is on the branch", async () => {
    const ws = workspace("ack-shared-window");
    const alpha = await createDoc(ws, { type: "note", title: "Alpha", body: "a1\n" });
    const beta = await createDoc(ws, { type: "note", title: "Beta", body: "b1\n" });
    pastTheSquashWindow(ws);

    // Same party, same instant: the second save folds into the first's commit
    // by amending it, which is the move A's session has to follow.
    await edit(ws, alpha.id, "a1\na2\n");
    const opened = ws.head();
    await edit(ws, beta.id, "b1\nb2\n");
    expect(ws.head()).not.toBe(opened);

    await ws.server.close();

    const payloads = acknowledgments(ws);
    expect(payloads).toHaveLength(2);
    expect(new Set(payloads.map((entry) => entry.docId))).toEqual(new Set([alpha.id, beta.id]));
    // §4's sentence, made true: one commit, named by both.
    expect(new Set(payloads.map((entry) => entry.to)).size).toBe(1);
    expect(payloads[0]?.to).toBe(ws.head());
    // PR #22's rule, kept at this door too: every published sha is one that
    // `git log` finds.
    const branch = ws.log("%H");
    for (const payload of payloads) {
      expect(branch).toContain(payload.to);
      expect(branch).toContain(payload.from);
      expect(payload.stats.commits).toBe(1);
      // And each still answers about its own document: the stats are
      // path-scoped, so they describe the file rather than the shared commit.
      const path = payload.docId === alpha.id ? alpha.path : beta.path;
      const scoped = ws.git("diff", "--shortstat", `${payload.from}..${payload.to}`, "--", path);
      expect(scoped).toContain(`${String(payload.stats.insertions)} insertion`);
    }
    // The commit holds both documents, so its whole diff is strictly larger
    // than either acknowledgment reports.
    const whole = ws.git("diff", "--shortstat", `${payloads[0]?.from ?? ""}..${ws.head()}`);
    const total = payloads.reduce((sum, entry) => sum + entry.stats.insertions, 0);
    expect(whole).toContain(`${String(total)} insertion`);
  });

  it("forgets the shared window when one of its documents is flushed", async () => {
    // The same defect's third consequence. `end()` hands §4's squash the
    // session's own last sha, and a session the neighbour's fold left behind
    // offers a sha the window no longer sits on — so the forget silently no-ops
    // and the next save amends the very commit the acknowledgment published.
    const ws = workspace("ack-shared-forget");
    const alpha = await createDoc(ws, { type: "note", title: "Alpha", body: "a1\n" });
    const beta = await createDoc(ws, { type: "note", title: "Beta", body: "b1\n" });
    pastTheSquashWindow(ws);

    await edit(ws, alpha.id, "a1\na2\n");
    await edit(ws, beta.id, "b1\nb2\n");
    const shared = ws.head();

    expect((await flush(ws, alpha.id)).status).toBe(204);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    expect(acknowledgments(ws)[0]?.to).toBe(shared);

    // The clock does not move: still well inside §4's squash window, which is
    // exactly the state the forget exists to defeat.
    await edit(ws, alpha.id, "a1\na2\na3\n");
    expect(ws.head()).not.toBe(shared);
    expect(ws.git("rev-parse", "HEAD^").trim()).toBe(shared);
    expect(ws.log("%H")).toContain(shared);
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

// SPEC.md §4 asks the orchestrate skill to *reflect* on an acknowledged session
// — "whether the change ripples into other documents" — so a session is a
// sitting of somebody writing **prose**, not any write the board happens to
// make (SERVER-095).
//
// The reported failure, from the user's own workspace: the entire diff of a
// commit that woke the agent was a re-stamped `updated:` and `width: 444` →
// `width: 725`. Somebody had dragged a board column, which the UI persists as a
// `PUT /api/docs/{id}` carrying `{ extra: { width } }` and nothing else, and the
// agent was asked whether a column width ripples into other documents.
describe("only a content edit opens a session (SERVER-095)", () => {
  /** Every field class a `PUT` can move without touching a word of the document. */
  const frontmatterOnly: readonly (readonly [string, Record<string, unknown>])[] = [
    ["a dragged column width", { extra: { width: 725 } }],
    ["a tag", { tags: ["mortgage"] }],
    ["a status", { status: "resolved" }],
    ["a still-current mark", { reviewed: "2026-07-27T09:00:00Z" }],
    ["a view query", { query: { type: "thread", status: "open" } }],
    ["a board position", { order: 3, pinned: true, column: "todos/todo" }],
    ["a due date", { due: "2026-09-01" }],
    ["nothing at all — a save that names no change (§9.2)", {}],
  ];

  it.each(frontmatterOnly)("does not wake the agent for %s", async (_label, patch) => {
    const ws = workspace("ack-fm-only", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "view", title: "Open threads", body: "Body.\n" });
    pastTheSquashWindow(ws);
    const before = ws.head();

    expect((await putDoc(ws, doc.id, patch)).status).toBe(200);

    ws.advance(IDLE_MS * 4);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 4));
    expect(acknowledgments(ws)).toHaveLength(0);

    // The write itself is untouched — this is a save that landed and simply
    // did not open a session. (The empty patch is the one case with nothing
    // to land: `updateDocumentLocked` short-circuits a save that names no
    // change, which is a second, older reason the same event never appears.)
    if (Object.keys(patch).length > 0) {
      expect(ws.head()).not.toBe(before);
      expect(ws.log("%s")[0]).toContain(doc.id);
    }
  });

  it("does not wake the agent for a save that re-sends the stored body verbatim", async () => {
    // The quiet form of the same bug. The reader autosaves on a timer, so a
    // sitting where somebody only retagged a document sends the body it already
    // has, over and over — and a save carrying a frontmatter change alongside it
    // really does commit, so "no commit landed" cannot be what saves us here.
    const ws = workspace("ack-same-body", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Unmoved prose", body: "one\ntwo\n" });
    pastTheSquashWindow(ws);
    const before = ws.head();

    expect((await putDoc(ws, doc.id, { body: "one\ntwo\n", tags: ["retagged"] })).status).toBe(200);
    expect(ws.head()).not.toBe(before);
    expect(ws.read(doc.path)).toContain("retagged");

    ws.advance(IDLE_MS * 4);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 4));
    expect(acknowledgments(ws)).toHaveLength(0);
  });

  it("wakes the agent for a rename, which is a change to what the document says", async () => {
    // §4, amended by user sign-off 2026-08-11 after PR #42's re-review: a
    // session is opened by a change to what the document **says** — its body,
    // *or the title it goes by* — against how it is held. The first cut of
    // SERVER-095 scoped this to the body alone, and someone who opened the
    // reader and renamed a document was silently never acknowledged.
    const ws = workspace("ack-title", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Mortgage options", body: "one\n" });
    pastTheSquashWindow(ws);

    expect((await putDoc(ws, doc.id, { title: "Refinance options" })).status).toBe(200);

    ws.advance(IDLE_MS * 2);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    expect(acknowledgments(ws)[0]).toMatchObject({ docId: doc.id, actor: "user" });
  });

  it("does not wake the agent for a save re-sending the stored title verbatim", async () => {
    // The title's half of the identical-value rule. `changedFields` drops a
    // title equal to the file's, so this needs no second comparison — but it
    // needs the assertion, or a reader autosaving frontmatter would wake the
    // agent on every timer tick, which is the P0 in a new costume.
    const ws = workspace("ack-title-same", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Mortgage options", body: "one\n" });
    pastTheSquashWindow(ws);

    expect((await putDoc(ws, doc.id, { title: "Mortgage options", tags: ["m"] })).status).toBe(200);

    ws.advance(IDLE_MS * 4);
    await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 4));
    expect(acknowledgments(ws)).toHaveLength(0);
  });

  it("wakes the agent for a body change carrying frontmatter along with it", async () => {
    // The body is what decides — and what rides along does not disqualify it.
    const ws = workspace("ack-mixed", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "note", title: "Mortgage options", body: "one\n" });
    pastTheSquashWindow(ws);

    expect((await putDoc(ws, doc.id, { body: "one\ntwo\n", tags: ["mortgage"] })).status).toBe(200);

    ws.advance(IDLE_MS * 2);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    const payload = acknowledgments(ws)[0];
    expect(payload).toMatchObject({ docId: doc.id, actor: "user", endedBy: "idle" });
    expect(payload?.to).toBe(ws.head());
    expect(payload?.stats.commits).toBe(1);
  });

  it("keeps one session across the frontmatter writes a reader makes while editing", async () => {
    // Dragging a column, pinning, retagging mid-sitting: none of them opens a
    // second session, and none of them ends the one that is open. The person
    // wrote once, so the agent is woken once.
    const ws = workspace("ack-interleaved-fm", { editAckIdleMs: IDLE_MS });
    const doc = await createDoc(ws, { type: "view", title: "Open threads", body: "one\n" });
    pastTheSquashWindow(ws);

    await edit(ws, doc.id, "one\ntwo\n");
    expect((await putDoc(ws, doc.id, { extra: { width: 444 } })).status).toBe(200);
    expect((await putDoc(ws, doc.id, { extra: { width: 725 } })).status).toBe(200);
    expect((await putDoc(ws, doc.id, { pinned: true })).status).toBe(200);

    ws.advance(IDLE_MS * 2);
    await vi.waitFor(() => {
      expect(acknowledgments(ws)).toHaveLength(1);
    });
    const payload = acknowledgments(ws)[0];
    // The frontmatter saves folded into the session's own commit (same party,
    // same window), so the range still names a commit the branch holds.
    expect(payload?.to).toBe(ws.head());
    expect(ws.log("%H")).toContain(payload?.to);
    expect(payload?.stats.commits).toBe(1);
  });

  // SERVER-096, the regression SERVER-095 introduced and PR #42's re-review
  // caught. Making `editSession` conditional was right, and stays — but it broke
  // an assumption the tracker was making one layer down: that "every user `PUT`
  // is a save I follow" and "my commit is still `HEAD`" are the same fact. They
  // were only ever the same by accident. Once a write the tracker follows no
  // longer covers every commit the person's own party lands, the next fold
  // amends a commit the session never had, and a session that read that amend as
  // §4's squash rewriting *its* commit moved its base onto the interloper — so
  // the acknowledged range began after the person's first edit and the agent was
  // shown half of what they wrote.
  //
  // Both doors are here. The frontmatter-only save is the one SERVER-095 opened
  // and the board walks through constantly; the thread creation was reachable
  // before it, and neither is a save the tracker follows.
  describe("a commit that opened no session does not move the base (SERVER-096)", () => {
    /**
     * The reviewer's sequence, on a real repository: an edit, a pause past §4's
     * 30 s squash idle but nowhere near the three-minute acknowledgment window,
     * an unobserved write, and more typing.
     *
     * The default acknowledgment window is left in place — the pause has to be
     * inside it — so the session is ended by the server stopping, which is §4's
     * other door and emits the same event.
     */
    async function sitting(
      prefix: string,
      interlude: (ws: WriteWorkspace, docId: string) => Promise<void>,
    ): Promise<{ ws: WriteWorkspace; payload: DocEditedPayload | undefined; path: string }> {
      const ws = workspace(prefix);
      const doc = await createDoc(ws, { type: "view", title: "Open threads", body: "one\n" });
      pastTheSquashWindow(ws);

      await edit(ws, doc.id, "one\ntwo\n");

      // Past the squash idle: whatever comes next cannot fold, so it lands a
      // **new** commit and opens a window of its own.
      pastTheSquashWindow(ws);
      await interlude(ws, doc.id);

      // …and the person carries on typing, which folds into that window.
      await edit(ws, doc.id, "one\ntwo\nthree\n");

      await ws.server.close();
      return { ws, payload: acknowledgments(ws)[0], path: doc.path };
    }

    /**
     * What the range has to say, whichever write sat in the middle: it starts
     * before the first edit and ends at the branch's tip, so both sittings'
     * worth of typing is inside it.
     *
     * Named by position, never by a sha captured mid-window: a window no act
     * named is relabelled as it closes, which is an amend and so a new sha for
     * the same tree (SERVER-091).
     */
    function expectBothEditsInRange(
      ws: WriteWorkspace,
      payload: DocEditedPayload | undefined,
      path: string,
    ): void {
      expect(payload).toBeDefined();
      expect(payload?.to).toBe(ws.head());
      expect(payload?.from).toBe(ws.git("rev-parse", "HEAD~2").trim());
      // Two commits, not one: the sitting spans the interloper as well.
      expect(payload?.stats.commits).toBe(2);
      // The observable the review states: pre-fix the first edit shows up as a
      // context line rather than an added one, because `from` names the commit
      // that already contains it.
      const diff = ws.git("diff", `${payload?.from ?? ""}..${payload?.to ?? ""}`, "--", path);
      expect(diff).toContain("+two");
      expect(diff).toContain("+three");
      expect(payload?.stats.insertions).toBeGreaterThanOrEqual(2);
    }

    it("covers both edits across a frontmatter-only save — the board's own write", async () => {
      const { ws, payload, path } = await sitting("ack-base-fm", async (workspaceUnderTest, id) => {
        expect((await putDoc(workspaceUnderTest, id, { extra: { width: 725 } })).status).toBe(200);
      });
      expectBothEditsInRange(ws, payload, path);
    });

    it("covers both edits across a thread creation on the document", async () => {
      const { ws, payload, path } = await sitting("ack-base-thread", async (w, id) => {
        const response = await w.post("/api/threads", {
          parent: id,
          selector: { exact: "two" },
          body: "a question about this line",
        });
        expect(response.status).toBe(201);
      });
      expectBothEditsInRange(ws, payload, path);
    });
  });

  it("still seals a user's session on an agent save that changed only frontmatter", async () => {
    // The linchpin of the fix being conditional at all. `observeCommit` seals
    // through `touches(commit, session)`, which compares the document id and the
    // staged paths and never reads `editPath` — so withholding the path from a
    // save that moved no prose costs sealing nothing, whichever party made it.
    const ws = createWriteWorkspace("ack-seal-fm", { sprint: "s011" });
    try {
      const doc = await createDoc(ws, { type: "note", title: "Shared", body: "line one\n" });
      pastTheSquashWindow(ws);

      await edit(ws, doc.id, "line one\nuser line\n");
      // The agent files the document — a status, no prose. Before SERVER-095
      // this carried an `editPath` too; it never mattered, because the tracker
      // discards a non-`user` actor's path before it looks at it.
      expect(
        (await putDoc(ws, doc.id, { tags: ["filed"] }, { "x-corpus-author": "agent" })).status,
      ).toBe(200);
      await edit(ws, doc.id, "line one\nuser line\nuser again\n");

      // Named by position: a window no act named is relabelled as it closes,
      // which is an amend and so a new sha for the same tree (SERVER-091).
      const userCommit = ws.git("rev-parse", "HEAD~2").trim();
      const agentCommit = ws.git("rev-parse", "HEAD^").trim();
      expect(ws.log("%an")[1]).toBe("agent");

      await ws.server.close();

      const payloads = acknowledgments(ws);
      expect(payloads).toHaveLength(2);
      // Two sessions, split at the agent's commit: neither range spans it.
      expect(payloads.find((entry) => entry.to === userCommit)).toBeDefined();
      expect(payloads.find((entry) => entry.from === agentCommit)).toBeDefined();
      expect(new Set(payloads.map((entry) => entry.sessionId)).size).toBe(2);
      // And the agent's own write is acknowledged by neither — the loop still
      // cannot feed itself.
      for (const payload of payloads) expect(payload.actor).toBe("user");
    } finally {
      ws.close();
    }
  });
});
