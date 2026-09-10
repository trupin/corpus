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
import { createThread, threadPath, putDoc } from "../threads/thread-fixture.js";
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
      const edited = await putDoc(
        ws,
        doc.id,
        { body: `rewritten by the agent ${String(index)}` },
        asAgent,
      );
      expect(edited.status).toBe(200);
    }
    const changelog = await putDoc(
      ws,
      docs[3]?.id ?? "",
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
    const later = await putDoc(ws, parent, { body: "a later thought" }, asAgent);
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
    const saved = await putDoc(ws, docId, { body: `underway, by the ${actor}` }, headers);
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

    const saved = await putDoc(ws, doc.id, { body: "underway" }, asUser);
    expect(saved.status).toBe(200);
    const before = commitCount() - 1;

    const turn = await ws.post(`/api/threads/${thread.id}/turns`, { body: "mine" }, asUser);
    expect(turn.status).toBe(201);

    // The turn folded into the open window and named it.
    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe(`comment: turn on ${thread.id} by user`);

    // And closed it: the next save by the same party opens a fresh commit
    // rather than folding into the one the turn named.
    const later = await putDoc(ws, doc.id, { body: "still typing" }, asUser);
    expect(later.status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });

  it("a thread started mid-edit — the first turn is a turn (SERVER-101)", async () => {
    // §4's first entry is "a turn posted to a thread", and the turn posted
    // *with* the thread is one of them (orchestrator ruling, 2026-09-06;
    // sprint-024 Ruling 2). No spec change was needed: `commitTurnAppend`'s own
    // justification — a person's comment is "a change someone else can act on",
    // since under §8 it is what wakes the agent — applies verbatim to the
    // comment that creates the thread, and starting one is the canonical UI flow
    // for commenting.
    const doc = await settledDoc("Pricing", "one");

    const saved = await putDoc(ws, doc.id, { body: "still typing" }, asUser);
    expect(saved.status).toBe(200);
    const before = commitCount() - 1;

    const thread = await createThread(ws, { parent: doc.id, body: "is this right?" }, "user");

    // One commit: the save folded in, and the creation named it.
    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe(`comment: new thread on ${doc.id} (${thread.id}) by user`);
    expect(filesIn("HEAD")).toEqual([doc.path, threadPath(thread.id)].sort());

    // And the subject survives: the next save by the same party opens a fresh
    // window rather than folding in and relabelling this commit an editing
    // session, which is what it did before SERVER-101.
    const later = await putDoc(ws, doc.id, { body: "a later thought" }, asUser);
    expect(later.status).toBe(200);
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD^")).toBe(`comment: new thread on ${doc.id} (${thread.id}) by user`);
  });

  it("an anchored thread creation stays one commit, not two (SERVER-101)", async () => {
    // The anchored mode writes the parent's frontmatter *and* the thread file,
    // and §6 forbids the intermediate state — "no highlight is ever left
    // pointing at an empty conversation". Declaring the act must not split them,
    // which is what `"names-the-window"` buys: the write folds into the open
    // window and the close comes after. `"commits-alone"` would have closed
    // first, landing the anchor entry in a different commit from the thread it
    // names.
    const doc = await settledDoc("Pricing", "the sentence to quote");
    const before = commitCount();

    const thread = await createThread(
      ws,
      { parent: doc.id, selector: { exact: "the sentence to quote" }, body: "why?" },
      "user",
    );
    expect(thread.anchorId).not.toBeNull();

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toBe(`comment: new thread on ${doc.id} (${thread.id}) by user`);
    expect(filesIn("HEAD")).toEqual([doc.path, threadPath(thread.id)].sort());
    expect(ws.read(doc.path)).toContain(String(thread.anchorId));
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

  it.each([
    ["archive", "doc archive"],
    ["unarchive", "doc unarchive"],
  ])("a **skill folder** %sd — the one directory-valued act", async (verb, prefix) => {
    // The gap that let PR #46's regression through. Every other case here acts
    // on a file-valued document, and a skill is a *folder*: archiving it stages
    // `move.from`/`move.to`, both directories. A fold guard that refused any
    // save staging a directory therefore broke §4 for skills alone while 547
    // tests stayed green — because none of them archived one.
    const neighbour = await settledDoc("Neighbour", "kept");
    const created = await ws.server.app.request("/api/skills", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json", [ACTOR_HEADER]: "agent" },
      body: JSON.stringify({ name: "weekly-review", description: "Run the weekly review." }),
    });
    expect(created.status).toBe(201);
    const skill = ((await created.json()) as { doc: { frontmatter: { id: string } } }).doc
      .frontmatter.id;
    if (verb === "unarchive") {
      expect((await ws.post(`/api/docs/${skill}/archive`, {}, asAgent)).status).toBe(200);
    }
    ws.advance(QUIET);

    const before = await saveThenAct(neighbour.id, "agent", () =>
      ws.post(`/api/docs/${skill}/${verb}`, {}, asAgent),
    );

    // §4: archiving is one of the four acts whose "own change is the last thing
    // in the window's commit" — it folds into the open window and *then* closes
    // it. One commit, not two, and it carries the neighbour's save.
    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`${prefix}:`);
    expect(filesIn("HEAD")).toContain(neighbour.path);
  });

  it("a document archived through a save that writes `status` (rider, 2026-09-09)", async () => {
    // §4's rider signed 2026-09-09 (SERVER-106): "§4's list names what happened
    // to the document and not which verb was used, so a document reaching
    // `archived`, or leaving it, closes the open commit window and names its
    // commit — through the archive and unarchive verbs, through a save that
    // writes `status`, and through a kanban drag whose stage the board maps to a
    // status (§5)."
    //
    // Before it, the two rows above declared the act and this one did not, so
    // the same change to the same document answered §4 differently depending on
    // a door `git log` does not record.
    const neighbour = await settledDoc("Neighbour", "kept", "agent");
    const subject = await createDoc(ws, { type: "note", title: "Subject", body: "one" }, "agent");
    ws.advance(QUIET);

    const before = await saveThenAct(neighbour.id, "agent", () =>
      putDoc(ws, subject.id, { status: "archived" }, asAgent),
    );

    // Ordering, not counting: "the act's change is the last thing in it, so a
    // body edit and a status change made in one sitting remain **one** commit".
    expect(commitCount()).toBe(before + 1);
    expect(filesIn("HEAD")).toEqual([neighbour.path, subject.path].sort());
    expect(subjectOf("HEAD")).toContain(`doc edit: Subject (${subject.id})`);
    expect(ws.read(subject.path)).toContain("status: archived");

    // "and that the window closes behind it".
    expect((await putDoc(ws, neighbour.id, { body: "after" }, asAgent)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });

  it("a document restored through §5's stage coupling (rider, 2026-09-09)", async () => {
    // The restore door the rider has to cover, because it is the only one `PUT`
    // has: a caller writing `status: open` over an archived document is refused
    // outright (SERVER-039, and the rider leaves that refusal standing), while
    // §5's kanban coupling writes `status` from a `stage` in both directions so
    // that a board mapping a stage to `archived` is not a one-way trip.
    await createDoc(ws, {
      type: "board",
      title: "K",
      folder: "views",
      order: 1,
      query: { folder: "inbox" },
      kanban: {
        field: "stage",
        stages: ["triage", "done"],
        status: { done: "archived", triage: "open" },
      },
    });
    const neighbour = await settledDoc("Neighbour", "kept", "agent");
    const subject = await createDoc(ws, { type: "note", title: "Task", body: "one" }, "agent");
    ws.advance(QUIET);

    // Archive it by dragging it into the mapped stage, and settle that.
    expect((await putDoc(ws, subject.id, { stage: "done" }, asAgent)).status).toBe(200);
    expect(ws.read(subject.path)).toContain("status: archived");
    ws.advance(QUIET);

    const before = await saveThenAct(neighbour.id, "agent", () =>
      putDoc(ws, subject.id, { stage: "triage" }, asAgent),
    );

    expect(ws.read(subject.path)).toContain("status: open");
    expect(commitCount()).toBe(before + 1);
    expect(filesIn("HEAD")).toEqual([neighbour.path, subject.path].sort());
    expect(subjectOf("HEAD")).toContain(`doc edit: Task (${subject.id})`);

    expect((await putDoc(ws, neighbour.id, { body: "after" }, asAgent)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
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
      putDoc(ws, subject.id, { reviewed: "2026-08-10T09:00:00Z" }, asAgent),
    );

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`doc edit: Subject (${subject.id})`);
    expect(filesIn("HEAD")).toEqual([neighbour.path, subject.path].sort());
    // The mark is on disk, and it did not stamp `updated` (§5).
    expect(ws.read(subject.path)).toContain("reviewed: 2026-08-10T09:00:00Z");

    // The window is closed: the next save is a commit of its own.
    const later = await putDoc(ws, neighbour.id, { body: "after" }, asAgent);
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

    expect((await putDoc(ws, first.id, { body: "draft" }, asUser)).status).toBe(200);
    const before = commitCount() - 1;
    await between();
    expect((await putDoc(ws, second.id, { body: "draft too" }, asUser)).status).toBe(200);
    return before;
  }

  /**
   * **The most expensive test in this file, and it needs its own budget**
   * (SERVER-146, INFRA-020). Fourteen real HTTP mutations, each with a real git
   * commit: two creates, then five create/save pairs, then two more saves.
   * Measured on this machine at **2.8–3.1 s** — 62% of vitest's 5 s default at
   * rest, which INFRA-020's own proposed rule ("a test that needs >20% of its
   * timeout idle will flake under the gate") calls out exactly. Under a full
   * suite competing with another agent's it was **1 in 3**, timing out at 5000 ms
   * rather than failing an assertion.
   *
   * The budget is sized to the measurement and not raised across the board: the
   * work here is genuine, and every other test in this file keeps the default.
   * Making the work *cheaper* is the real fix and belongs to INFRA-020.
   */
  it(
    "an ordinary save of a document body, whichever document it is to",
    { timeout: 20_000 },
    async () => {
      const before = await windowAround(async () => {
        // Five more saves across two more documents, all by the same party.
        for (let index = 0; index < 5; index += 1) {
          const doc = await createDoc(
            ws,
            { type: "note", title: `Extra ${String(index)}`, body: "x" },
            "user",
          );
          expect((await putDoc(ws, doc.id, { body: `x${String(index)}` }, asUser)).status).toBe(
            200,
          );
        }
      });
      expect(commitCount()).toBe(before + 1);
    },
  );

  it("opening or closing a reader", async () => {
    const before = await windowAround(async () => {
      expect((await ws.request("/api/docs")).status).toBe(200);
      expect((await ws.request("/api/tree")).status).toBe(200);
    });
    expect(commitCount()).toBe(before + 1);
  });

  it("reading a document's key (SPEC.md §7 — a read, and it is all a key is)", async () => {
    // The line §4 used to spend on the edit lock (SHARED-041 item 4). Nothing
    // replaces it: reading a key is a read, and "any read that does not touch
    // git history" already covers it — so this asserts that, rather than a rule
    // of its own.
    const doc = await createDoc(ws, { type: "note", title: "Keyed", body: "x" }, "user");
    const before = await windowAround(async () => {
      const read = await ws.request(`/api/docs/${doc.id}`);
      expect(read.status).toBe(200);
      expect(((await read.json()) as { key: string }).key).toMatch(/^[0-9a-f]{64}$/);
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
    // key read, a projection pass and a seen-mark interleaved".
    const doc = await createDoc(ws, { type: "note", title: "Marked", body: "x" }, "user");
    const thread = await createThread(ws, { parent: doc.id, body: "?" });
    const before = await windowAround(async () => {
      expect((await ws.request(`/api/docs/${doc.id}`)).status).toBe(200);
      expect((await putDoc(ws, doc.id, { body: "with my own key" }, asUser)).status).toBe(200);
      ws.reproject();
      expect((await ws.post(`/api/threads/${thread.id}/seen`, {}, asUser)).status).toBe(200);
      expect((await ws.request("/api/docs")).status).toBe(200);
      expect((await ws.request(`/api/docs/${doc.id}`)).status).toBe(200);
    });
    expect(commitCount()).toBe(before + 1);

    // Still open, so it still carries the last save's subject. Let it go quiet
    // and the close labels it for what it was: three documents, no act.
    ws.advance(QUIET);
    expect((await putDoc(ws, doc.id, { body: "much later" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD^")).toBe(editingSessionSubject(3, "user"));
  });
});

// ---------------------------------------------------------------------------
// §4's "two acts commit alone". (It said three until SHARED-041 struck the
// force unlock with the lock it broke — SERVER-099.)
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
    expect((await putDoc(ws, keeper.id, { body: "after" }, asUser)).status).toBe(200);
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

    expect((await putDoc(ws, edited.id, { body: "underway" }, asUser)).status).toBe(200);
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
