// SPEC.md §4's two checkable lists — "what closes a window" and "what does
// **not**" — asserted against a real workspace, a real git repository and the
// real Hono app (SERVER-092).
//
// §4 publishes both lists, so a reader will check them, and each is a different
// kind of assertion:
//
// - **The positive list** is about *ordering*, not merely about counting. For
//   the four ordinary acts the act's own change is the last thing in the
//   window's commit and the subject names the act, so one commit holding both
//   changes is the proof; closing the window *before* committing the act would
//   produce the right number of commits in the wrong order and pass a looser
//   test. Every case here therefore asserts the subject **and** the files in
//   that one commit.
// - **The negative list** is about the window *surviving*, and it gets one test
//   per entry rather than one combined one, so a regression names itself.
//
// Nothing here is a mock: what §4 promises is only observable in `git log`, so a
// test that inspected the server's own bookkeeping would pass over exactly the
// fragmentation the rider was written to replace.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "@corpus/contract";
import { editingSessionSubject } from "../git/index.js";
import { createThread, threadPath } from "../threads/thread-fixture.js";
import { AUTH, createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

const asAgent: Record<string, string> = { [ACTOR_HEADER]: "agent" };
const asUser: Record<string, string> = { [ACTOR_HEADER]: "user" };

/** Comfortably past §4's 30 s idle window, so a preceding window has gone quiet. */
const QUIET = 60_000;

beforeEach(() => {
  ws = createWriteWorkspace("acts", { sprint: "s092" });
});

afterEach(() => {
  ws.close();
});

/** The files one commit contains, from git itself, sorted. */
const filesIn = (rev: string): string[] =>
  ws
    .git("show", "--name-only", "--no-renames", "--format=", rev)
    .split("\n")
    .filter((line) => line !== "")
    .sort();

const subjectOf = (rev: string): string => ws.git("log", "-1", "--format=%s", rev).trim();
const authorOf = (rev: string): string => ws.git("log", "-1", "--format=%an", rev).trim();
const commitCount = (): number => ws.log("%H").length;

/** A document with a body, created by `actor` and settled into its own commit. */
async function settledDoc(
  title: string,
  body: string,
  actor: "user" | "agent" = "user",
): Promise<{ id: string; path: string }> {
  const doc = await createDoc(ws, { type: "note", title, body }, actor);
  ws.advance(QUIET);
  return { id: doc.id, path: doc.path };
}

// ---------------------------------------------------------------------------
// The scenario the rider was written for.
// ---------------------------------------------------------------------------

describe("the agent's stewardship for one event is one commit (§4)", () => {
  it("gathers three edits, a changelog and the turn into one commit the turn names", async () => {
    const docs = [
      await createDoc(ws, { type: "note", title: "Pricing", body: "one" }, "user"),
      await createDoc(ws, { type: "note", title: "Roadmap", body: "two" }, "user"),
      await createDoc(ws, { type: "note", title: "Runbook", body: "three" }, "user"),
      await createDoc(ws, { type: "note", title: "Changelog", body: "history" }, "user"),
    ];
    const parent = docs[0]?.id ?? "";
    const thread = await createThread(ws, { parent, body: "is this still right?" });
    // The user's own window goes quiet before the agent starts, so the one
    // commit counted below is the agent's and nothing else.
    ws.advance(QUIET);
    const before = commitCount();

    for (const [index, doc] of docs.slice(0, 3).entries()) {
      const edited = await ws.put(
        `/api/docs/${doc.id}`,
        { body: `rewritten by the agent ${String(index)}` },
        asAgent,
      );
      expect(edited.status).toBe(200);
    }
    const changelog = await ws.put(
      `/api/docs/${docs[3]?.id ?? ""}`,
      { body: "history\n\n## 2026-08-10\n\nthree documents revised" },
      asAgent,
    );
    expect(changelog.status).toBe(200);
    // Still one open window, four documents deep, nothing named it yet.
    expect(commitCount()).toBe(before + 1);

    const turn = await ws.post(
      `/api/threads/${thread.id}/turns`,
      { body: "revised all three; the runbook needed the most work" },
      asAgent,
    );
    expect(turn.status).toBe(201);

    // **One** commit for the whole pass — five files, the turn's subject.
    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe(`comment: turn on ${thread.id} by agent`);
    expect(authorOf("HEAD")).toBe("agent");
    expect(filesIn("HEAD")).toEqual([...docs.map((doc) => doc.path), threadPath(thread.id)].sort());

    // And it is closed: the next save by the same party cannot fold into it.
    const later = await ws.put(`/api/docs/${parent}`, { body: "a later thought" }, asAgent);
    expect(later.status).toBe(200);
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD^")).toBe(`comment: turn on ${thread.id} by agent`);
  });
});

// ---------------------------------------------------------------------------
// §4's positive list: each act, one at a time.
// ---------------------------------------------------------------------------

describe("each act closes the window and names its commit (§4)", () => {
  /**
   * A body save by `actor`, then the act, with no clock movement between them —
   * exactly the situation an ordinary save folds into. Returns the commit count
   * before the save, so the caller asserts how many the pair produced.
   */
  async function saveThenAct(
    docId: string,
    actor: "user" | "agent",
    act: () => Promise<Response>,
    expected = 200,
  ): Promise<number> {
    const headers = actor === "agent" ? asAgent : asUser;
    const saved = await ws.put(
      `/api/docs/${docId}`,
      { body: `underway, by the ${actor}` },
      headers,
    );
    expect(saved.status).toBe(200);
    // The save's own commit is the window; the act must not add a second.
    const before = commitCount() - 1;
    expect((await act()).status).toBe(expected);
    return before;
  }

  it("a turn posted to a thread, by the agent", async () => {
    const doc = await settledDoc("Pricing", "one");
    const thread = await createThread(ws, { parent: doc.id, body: "?" });
    ws.advance(QUIET);

    const before = await saveThenAct(
      doc.id,
      "agent",
      () => ws.post(`/api/threads/${thread.id}/turns`, { body: "answered" }, asAgent),
      201,
    );

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe(`comment: turn on ${thread.id} by agent`);
    expect(filesIn("HEAD")).toEqual([doc.path, threadPath(thread.id)].sort());
  });

  it("a person's turn is an act too, and closes the window it lands in", async () => {
    // §4 said "an agent turn posted to a thread" until the user struck the word
    // on 2026-08-10 (SHARED-040 held item (c)): every other entry in that list
    // names an act without a party, and a person's comment is the clearest case
    // of §4's own definition — "a change someone else can act on" — since under
    // §8 it is what wakes the agent.
    const doc = await settledDoc("Pricing", "one");
    const thread = await createThread(ws, { parent: doc.id, body: "?" });
    ws.advance(QUIET);

    const saved = await ws.put(`/api/docs/${doc.id}`, { body: "underway" }, asUser);
    expect(saved.status).toBe(200);
    const before = commitCount() - 1;

    const turn = await ws.post(`/api/threads/${thread.id}/turns`, { body: "mine" }, asUser);
    expect(turn.status).toBe(201);

    // The turn folded into the open window and named it.
    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe(`comment: turn on ${thread.id} by user`);

    // And closed it: the next save by the same party opens a fresh commit
    // rather than folding into the one the turn named.
    const later = await ws.put(`/api/docs/${doc.id}`, { body: "still typing" }, asUser);
    expect(later.status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });

  it.each([
    ["resolved", "resolve", "thread resolve"],
    ["reopened", "reopen", "thread reopen"],
  ])("a thread %s", async (_label, verb, prefix) => {
    const doc = await settledDoc("Pricing", "one");
    const thread = await createThread(ws, { parent: doc.id, body: "?" });
    if (verb === "reopen") {
      expect((await ws.post(`/api/threads/${thread.id}/resolve`, {}, asAgent)).status).toBe(200);
    }
    ws.advance(QUIET);

    const before = await saveThenAct(doc.id, "agent", () =>
      ws.post(`/api/threads/${thread.id}/${verb}`, {}, asAgent),
    );

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`${prefix}:`);
    expect(filesIn("HEAD")).toEqual([doc.path, threadPath(thread.id)].sort());
  });

  it.each([
    ["archive", "doc archive"],
    ["unarchive", "doc unarchive"],
  ])("a document %sd", async (verb, prefix) => {
    const neighbour = await settledDoc("Neighbour", "kept");
    const subject = await createDoc(ws, { type: "note", title: "Subject", body: "one" }, "agent");
    if (verb === "unarchive") {
      expect((await ws.post(`/api/docs/${subject.id}/archive`, {}, asAgent)).status).toBe(200);
    }
    ws.advance(QUIET);

    const before = await saveThenAct(neighbour.id, "agent", () =>
      ws.post(`/api/docs/${subject.id}/${verb}`, {}, asAgent),
    );

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`${prefix}:`);
    expect(filesIn("HEAD")).toContain(neighbour.path);
  });

  it("a document moved", async () => {
    const neighbour = await settledDoc("Neighbour", "kept");
    const subject = await createDoc(ws, { type: "note", title: "Subject", body: "one" }, "agent");
    ws.advance(QUIET);

    const before = await saveThenAct(neighbour.id, "agent", () =>
      ws.post(`/api/docs/${subject.id}/move`, { folder: "archive-2026" }, asAgent),
    );

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain("doc move:");
    expect(filesIn("HEAD")).toContain(neighbour.path);
    expect(filesIn("HEAD")).toContain("data/docs/archive-2026/subject.md");
  });

  it("a document marked still current (§5)", async () => {
    const neighbour = await settledDoc("Neighbour", "kept", "agent");
    const subject = await createDoc(ws, { type: "note", title: "Subject", body: "one" }, "agent");
    ws.advance(QUIET);

    const before = await saveThenAct(neighbour.id, "agent", () =>
      ws.put(`/api/docs/${subject.id}`, { reviewed: "2026-08-10T09:00:00Z" }, asAgent),
    );

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`doc edit: Subject (${subject.id})`);
    expect(filesIn("HEAD")).toEqual([neighbour.path, subject.path].sort());
    // The mark is on disk, and it did not stamp `updated` (§5).
    expect(ws.read(subject.path)).toContain("reviewed: 2026-08-10T09:00:00Z");

    // The window is closed: the next save is a commit of its own.
    const later = await ws.put(`/api/docs/${neighbour.id}`, { body: "after" }, asAgent);
    expect(later.status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });
});

// ---------------------------------------------------------------------------
// §4's negative list — one test per entry, so a regression names itself.
// ---------------------------------------------------------------------------

describe("what does not close a window (§4)", () => {
  /** Two documents saved by one party, with `between` run in the middle. */
  async function windowAround(between: () => Promise<void>): Promise<number> {
    const first = await createDoc(ws, { type: "note", title: "First", body: "one" }, "user");
    const second = await createDoc(ws, { type: "note", title: "Second", body: "two" }, "user");
    ws.advance(QUIET);

    expect((await ws.put(`/api/docs/${first.id}`, { body: "draft" }, asUser)).status).toBe(200);
    const before = commitCount() - 1;
    await between();
    expect((await ws.put(`/api/docs/${second.id}`, { body: "draft too" }, asUser)).status).toBe(
      200,
    );
    return before;
  }

  it("an ordinary save of a document body, whichever document it is to", async () => {
    const before = await windowAround(async () => {
      // Five more saves across two more documents, all by the same party.
      for (let index = 0; index < 5; index += 1) {
        const doc = await createDoc(
          ws,
          { type: "note", title: `Extra ${String(index)}`, body: "x" },
          "user",
        );
        expect(
          (await ws.put(`/api/docs/${doc.id}`, { body: `x${String(index)}` }, asUser)).status,
        ).toBe(200);
      }
    });
    expect(commitCount()).toBe(before + 1);
  });

  it("opening or closing a reader", async () => {
    const before = await windowAround(async () => {
      expect((await ws.request("/api/docs")).status).toBe(200);
      expect((await ws.request("/api/tree")).status).toBe(200);
    });
    expect(commitCount()).toBe(before + 1);
  });

  it("acquiring, renewing or releasing an edit lock", async () => {
    const doc = await createDoc(ws, { type: "note", title: "Locked", body: "x" }, "user");
    const before = await windowAround(async () => {
      expect((await ws.post(`/api/locks/${doc.id}`, {}, asUser)).status).toBe(201);
      // A second acquire by the same holder is the renewal.
      expect([200, 201]).toContain((await ws.post(`/api/locks/${doc.id}`, {}, asUser)).status);
      expect((await ws.del(`/api/locks/${doc.id}`, asUser)).status).toBe(200);
    });
    expect(commitCount()).toBe(before + 1);
  });

  it("a projection or index pass", async () => {
    const before = await windowAround(async () => {
      ws.reproject();
      expect((await ws.request("/api/db/doctor", { method: "GET", headers: AUTH })).status).toBe(
        200,
      );
    });
    expect(commitCount()).toBe(before + 1);
  });

  it("a job-log line", async () => {
    const event = await ws.server.queue.enqueue({
      type: "comment.created",
      source: "ui",
      payload: {},
    });
    const before = await windowAround(async () => {
      const response = await ws.server.app.request(
        `/api/jobs/${event.id}/log`,
        { method: "POST", headers: { ...AUTH, "content-type": "application/json" }, body: "{}" },
        { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
      );
      // Whatever the route makes of an empty line, it wrote no document and so
      // closed no window — which is the only thing this entry is about.
      expect(response.status).toBeLessThan(500);
    });
    expect(commitCount()).toBe(before + 1);
  });

  it("a read-state mark", async () => {
    const doc = await createDoc(ws, { type: "note", title: "Marked", body: "x" }, "user");
    const thread = await createThread(ws, { parent: doc.id, body: "?" });
    const before = await windowAround(async () => {
      expect((await ws.post(`/api/threads/${thread.id}/seen`, {}, asUser)).status).toBe(200);
    });
    expect(commitCount()).toBe(before + 1);
  });

  it("all of them at once, interleaved through one editing session", async () => {
    // The acceptance criterion, spelled as §4 spells it: "N body saves across M
    // documents by one party inside the idle window are still one commit, with a
    // lock acquire/release, a projection pass and a seen-mark interleaved".
    const doc = await createDoc(ws, { type: "note", title: "Marked", body: "x" }, "user");
    const thread = await createThread(ws, { parent: doc.id, body: "?" });
    const before = await windowAround(async () => {
      expect((await ws.post(`/api/locks/${doc.id}`, {}, asUser)).status).toBe(201);
      expect(
        (await ws.put(`/api/docs/${doc.id}`, { body: "under my own lock" }, asUser)).status,
      ).toBe(200);
      ws.reproject();
      expect((await ws.post(`/api/threads/${thread.id}/seen`, {}, asUser)).status).toBe(200);
      expect((await ws.request("/api/docs")).status).toBe(200);
      expect((await ws.del(`/api/locks/${doc.id}`, asUser)).status).toBe(200);
    });
    expect(commitCount()).toBe(before + 1);

    // Still open, so it still carries the last save's subject. Let it go quiet
    // and the close labels it for what it was: three documents, no act.
    ws.advance(QUIET);
    expect((await ws.put(`/api/docs/${doc.id}`, { body: "much later" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD^")).toBe(editingSessionSubject(3, "user"));
  });
});

// ---------------------------------------------------------------------------
// §4's "three acts commit alone".
// ---------------------------------------------------------------------------

describe("a deletion closes the window and then commits alone (§4)", () => {
  it("leaves a document created and deleted inside one window recoverable from git", async () => {
    // The case §7's "deletion is user-only, git preserves history" depends on,
    // and a live regression before this issue: with a *neighbour* document in
    // the same window HEAD is no longer empty, so `amendWouldEmptyHead` says no
    // and the deletion amends the create away — leaving nothing at all in git.
    const neighbour = await createDoc(
      ws,
      { type: "note", title: "Neighbour", body: "kept" },
      "user",
    );
    const doomed = await createDoc(
      ws,
      { type: "note", title: "Doomed", body: "the only revision" },
      "user",
    );
    // One window, two documents, one commit so far.
    const before = commitCount() - 1;
    expect(filesIn("HEAD").sort()).toEqual([neighbour.path, doomed.path].sort());

    // No clock movement: the deletion is inside the very window that created it.
    expect((await ws.del(`/api/docs/${doomed.id}`, asUser)).status).toBe(200);

    // Two commits: the window's, then the deletion's, in that order.
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD")).toBe(`doc delete: Doomed (${doomed.id}) by user`);
    expect(filesIn("HEAD")).toEqual([doomed.path]);
    expect(subjectOf("HEAD^")).toBe(editingSessionSubject(2, "user"));

    // The create is recoverable — the whole point of the flush.
    expect(ws.git("show", `HEAD^:${doomed.path}`)).toContain("the only revision");
    const blob = ws.git("rev-parse", `HEAD^:${doomed.path}`).trim();
    expect(ws.git("cat-file", "-t", blob).trim()).toBe("blob");
    expect(ws.git("cat-file", "-p", blob)).toContain("the only revision");
    // …and the neighbour survived the deletion untouched.
    expect(ws.exists(neighbour.path)).toBe(true);
  });

  it("opens no window for a later save to fold into", async () => {
    const doomed = await settledDoc("Doomed", "one");
    const keeper = await settledDoc("Keeper", "two");
    const before = commitCount();

    expect((await ws.del(`/api/docs/${doomed.id}`, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 1);

    // Same party, same instant — an ordinary save would fold. This must not.
    expect((await ws.put(`/api/docs/${keeper.id}`, { body: "after" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD^")).toBe(`doc delete: Doomed (${doomed.id}) by user`);
  });
});

describe("a staged bulk Save flushes first and then lands alone (§4)", () => {
  it("commits the editing session first, then the act, and reverts as a unit", async () => {
    const edited = await settledDoc("Edited", "one");
    const staged = [
      await createDoc(ws, { type: "note", title: "Alpha", body: "a" }, "user"),
      await createDoc(ws, { type: "note", title: "Beta", body: "b" }, "user"),
    ];
    ws.advance(QUIET);

    expect((await ws.put(`/api/docs/${edited.id}`, { body: "underway" }, asUser)).status).toBe(200);
    const before = commitCount() - 1;

    // No clock movement: the act meets a window that is wide open.
    const response = await ws.post(
      "/api/docs/bulk",
      { entries: staged.map((doc) => ({ id: doc.id, action: { action: "archive" } })) },
      asUser,
    );
    expect(response.status).toBe(200);

    // Editing commit first, bulk commit alone after it.
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD")).toBe("bulk archive: 2 documents by user");
    expect(filesIn("HEAD")).toEqual(staged.map((doc) => doc.path).sort());
    expect(subjectOf("HEAD^")).toBe(editingSessionSubject(1, "user"));
    expect(filesIn("HEAD^")).toEqual([edited.path]);

    // Reverting the act undoes the act and nothing else.
    ws.git(
      "-c",
      "user.name=Revert",
      "-c",
      "user.email=r@example.test",
      "revert",
      "--no-edit",
      "HEAD",
    );
    for (const doc of staged) expect(ws.read(doc.path)).toContain("status: open");
    expect(ws.read(edited.path)).toContain("underway");
  });
});

describe("a force unlock flushes before its audit entry (§4, §7)", () => {
  it("puts the agent's work in git under the agent's name, before the break", async () => {
    const doc = await settledDoc("Contended", "one");
    expect((await ws.post(`/api/locks/${doc.id}`, {}, asAgent)).status).toBe(201);
    const before = commitCount();

    // The agent works under its own lease; the window is open when the break
    // arrives, with no clock movement at all.
    expect(
      (await ws.put(`/api/docs/${doc.id}`, { body: "the agent's work" }, asAgent)).status,
    ).toBe(200);
    expect(commitCount()).toBe(before + 1);

    expect((await ws.post(`/api/locks/${doc.id}/break`, {}, asUser)).status).toBe(200);

    // The audit entry stands alone, on top of the agent's own commit.
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD")).toBe(`lock: force-break on ${doc.id} (was agent) by user`);
    expect(authorOf("HEAD")).toBe("user");
    expect(filesIn("HEAD")).toEqual([]);
    expect(authorOf("HEAD^")).toBe("agent");
    expect(subjectOf("HEAD^")).toBe(editingSessionSubject(1, "agent"));
    expect(ws.git("show", `HEAD^:${doc.path}`)).toContain("the agent's work");

    // `git log --author` still answers exactly: the break is the user's, the
    // work under it is the agent's, and neither is attributed to the other.
    expect(ws.git("log", "--author=agent", "--format=%s")).toContain("editing session: 1 document");
    expect(ws.git("log", "--author=agent", "--format=%s")).not.toContain("lock: force-break");
  });

  it("takes no later save into the audit entry", async () => {
    const doc = await settledDoc("Contended", "one");
    expect((await ws.post(`/api/locks/${doc.id}`, {}, asAgent)).status).toBe(201);
    expect((await ws.put(`/api/docs/${doc.id}`, { body: "agent work" }, asAgent)).status).toBe(200);
    expect((await ws.post(`/api/locks/${doc.id}/break`, {}, asUser)).status).toBe(200);
    const audit = ws.head();

    expect(
      (await ws.put(`/api/docs/${doc.id}`, { body: "the user carries on" }, asUser)).status,
    ).toBe(200);
    expect(ws.git("rev-parse", "HEAD^").trim()).toBe(audit);
  });
});
