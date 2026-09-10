// **§4's status doors, after the rider signed 2026-09-09** (SERVER-106).
//
// SPEC.md §4 lists "a document archived, restored, moved, renamed, or marked
// still current (§5)" among the acts that close a commit window, and the rider
// signed 2026-09-09 says which doors that reaches:
//
// > **Archiving and restoring are acts wherever they happen.** §4's list names
// > what happened to the document and not which verb was used, so a document
// > reaching `archived`, or leaving it, closes the open commit window and names
// > its commit — through the archive and unarchive verbs, through a save that
// > writes `status`, and through a kanban drag whose stage the board maps to a
// > status (§5).
//
// Before it, `POST /api/docs/{id}/archive` declared the act and `PUT
// /api/docs/{id}` did not, so the same change to the same document answered §4
// two different ways and `git log` did not record which door was used. This file
// was written to pin that divergence while the rider was unsigned. It now
// asserts the rider instead: every case below that once carried a `TODAY:`
// comment carries a citation of the signed text.
//
// The rider settles two other things, and both are asserted here too:
//
// - **The refusal stands.** A save writing `status: open` over an archived
//   document is still refused rather than promoted to an act — "unarchiving a
//   skill is a folder move a field edit cannot undo (§7)" — so the restore that
//   reaches this route is §5's stage coupling.
// - **Retitling is not an act.** "§4's 'renamed' is about where a document
//   lives, not what it is called", so a title change joins the open window like
//   the tags beside it.
//
// The cases that assert §4's list as a whole live in `acts.test.ts`, which gains
// the two positive cases this rider adds. This file keeps the doors side by
// side, which is what made the divergence legible in the first place.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "@corpus/contract";
import { createDoc, createWriteWorkspace, putDoc, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

const asUser: Record<string, string> = { [ACTOR_HEADER]: "user" };

/** Comfortably past §4's 30 s idle window, so a preceding window has gone quiet. */
const QUIET = 60_000;

beforeEach(() => {
  ws = createWriteWorkspace("status-doors", { sprint: "s106" });
});

afterEach(() => {
  ws.close();
});

const subjectOf = (rev: string): string => ws.git("log", "-1", "--format=%s", rev).trim();
const commitCount = (): number => ws.log("%H").length;
/** The files one commit contains, from git itself, sorted. */
const filesIn = (rev: string): string[] =>
  ws
    .git("show", "--name-only", "--no-renames", "--format=", rev)
    .split("\n")
    .filter((line) => line !== "")
    .sort();
const statusOf = (path: string): string | undefined =>
  ws
    .read(path)
    .split("\n")
    .find((line) => line.startsWith("status:"));

/**
 * A neighbour document saved by the user — which opens the window every case
 * below meets — plus a settled subject document for the flip to act on. Returns
 * the commit count as it stood **before** the neighbour's save, so a caller
 * asserts how many commits the pair produced.
 */
async function openWindowAndSubject(): Promise<{
  before: number;
  neighbour: { id: string; path: string };
  subject: { id: string; path: string };
}> {
  const neighbour = await createDoc(ws, { type: "note", title: "Neighbour", body: "kept" }, "user");
  const subject = await createDoc(ws, { type: "note", title: "Subject", body: "one" }, "user");
  ws.advance(QUIET);

  expect((await putDoc(ws, neighbour.id, { body: "underway" }, asUser)).status).toBe(200);
  return { before: commitCount() - 1, neighbour, subject };
}

/** A kanban board over `stage`, mapping `done` → `archived` and `triage` → `open`. */
const archivingBoard = async (): Promise<void> => {
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
};

describe("§4's rider (2026-09-09): archiving through `PUT`", () => {
  it("folds into the open window and then closes it", async () => {
    const { before, neighbour, subject } = await openWindowAndSubject();

    const flipped = await putDoc(ws, subject.id, { status: "archived" }, asUser);
    expect(flipped.status).toBe(200);
    expect(statusOf(subject.path)).toBe("status: archived");

    // The rider: "The commit is still the window's: the act's change is the last
    // thing in it, so a body edit and a status change made in one sitting remain
    // **one** commit, exactly as §10 promises." One commit, and it carries both
    // the neighbour's body edit and the archived document.
    expect(commitCount()).toBe(before + 1);
    expect(filesIn("HEAD")).toEqual([neighbour.path, subject.path].sort());
    expect(subjectOf("HEAD")).toContain(`doc edit: Subject (${subject.id})`);

    // "and that the window closes behind it" — so the next save by the same
    // party is a commit of its own rather than folding into a window that is no
    // longer open. This is the assertion the unsigned rider inverted.
    expect((await putDoc(ws, neighbour.id, { body: "still typing" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);

    // And the flip's own commit is never relabelled an editing session: the act
    // named the window it closed.
    expect(subjectOf("HEAD^")).toContain(`doc edit: Subject (${subject.id})`);
  });

  it("the archive **verb** on the same document closes it too", async () => {
    // The two doors side by side, which is what this file is for: the same
    // change to the same document, through the door §4's list was never
    // ambiguous about. `acts.test.ts` owns this assertion for §4's sake; it is
    // repeated here so the rider's "wherever they happen" is checkable in one
    // place.
    const { before, neighbour, subject } = await openWindowAndSubject();

    expect((await ws.post(`/api/docs/${subject.id}/archive`, {}, asUser)).status).toBe(200);

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`doc archive: Subject (${subject.id})`);

    // Closed: the next save opens a fresh window rather than folding.
    expect((await putDoc(ws, neighbour.id, { body: "after" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });
});

describe("§4's rider (2026-09-09): restoring through `PUT`", () => {
  it("is refused outright when the caller writes `status: open` (SERVER-039)", async () => {
    // The rider leaves this refusal exactly where it was: "A save that would
    // write `status: open` over an archived document on its own stays refused
    // rather than becoming an act — unarchiving a skill is a folder move a field
    // edit cannot undo (§7)". So the direct restore-through-`PUT` is not a door
    // that folds; it is not a door at all.
    const { subject } = await openWindowAndSubject();
    expect((await ws.post(`/api/docs/${subject.id}/archive`, {}, asUser)).status).toBe(200);
    ws.advance(QUIET);

    const restored = await putDoc(ws, subject.id, { status: "open" }, asUser);
    expect(restored.status).toBe(400);
    expect(statusOf(subject.path)).toBe("status: archived");
  });

  it("reaches the file through §5's stage coupling, and closes the window there", async () => {
    // The restore door that **does** exist through `PUT`, and the one the rider
    // names: "through a kanban drag whose stage the board maps to a status (§5)"
    // — "so restoring reaches this rule through the unarchive verb, through a
    // bulk Save or folder act, and through the stage coupling." The coupling
    // deliberately bypasses `assertNotUnarchivingByPut` (`update.ts`) so a board
    // that maps a stage to `archived` is not a one-way trip, and both directions
    // run through the same `act:` expression as a caller-written flip.
    await archivingBoard();
    const neighbour = await createDoc(
      ws,
      { type: "note", title: "Neighbour", body: "kept" },
      "user",
    );
    const subject = await createDoc(ws, { type: "note", title: "Task", body: "one" }, "user");
    ws.advance(QUIET);

    // Archive it by dragging it into the mapped stage, and settle that.
    expect((await putDoc(ws, subject.id, { stage: "done" }, asUser)).status).toBe(200);
    expect(statusOf(subject.path)).toBe("status: archived");
    ws.advance(QUIET);

    // Now open a window and drag it back out — a restore, by §4's word for it.
    expect((await putDoc(ws, neighbour.id, { body: "underway" }, asUser)).status).toBe(200);
    const before = commitCount() - 1;

    expect((await putDoc(ws, subject.id, { stage: "triage" }, asUser)).status).toBe(200);
    expect(statusOf(subject.path)).toBe("status: open");

    // Folded into the window, and the window closed behind it.
    expect(commitCount()).toBe(before + 1);
    expect(filesIn("HEAD")).toEqual([neighbour.path, subject.path].sort());
    expect((await putDoc(ws, neighbour.id, { body: "still typing" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD^")).toContain(`doc edit: Task (${subject.id})`);
  });

  it("a drag between two stages the board maps the same way is still a save", async () => {
    // The other half of "not which verb was used": the act is the status change,
    // and a stage move that changes no status changes nothing §4 lists.
    // `statusCoupled` is already false for a coupled status the document is not
    // moving to, so this needs no second rule — but it is the case a broader
    // reading ("any patch carrying `stage`") would have got wrong, so it is
    // pinned.
    await createDoc(ws, {
      type: "board",
      title: "K",
      folder: "views",
      order: 1,
      query: { folder: "inbox" },
      kanban: { field: "stage", stages: ["triage", "doing"], status: { triage: "open" } },
    });
    const { before, neighbour, subject } = await openWindowAndSubject();

    expect((await putDoc(ws, subject.id, { stage: "doing" }, asUser)).status).toBe(200);
    expect(statusOf(subject.path)).toBe("status: open");

    expect(commitCount()).toBe(before + 1);
    expect((await putDoc(ws, neighbour.id, { body: "still typing" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 1);
  });
});

describe("§4's rider (2026-09-09): the rest of the strip through `PUT`", () => {
  it("retitling does not close the window", async () => {
    // Settled by the rider's third paragraph, and settled the *other* way:
    // "**And §4's 'renamed' is about where a document lives, not what it is
    // called.** A document is renamed when its file moves — §9.2's folder move
    // and the folder rename beside it. Changing a document's title is the
    // strip's own field and joins the open window like the tags next to it, so a
    // sitting that retitles a document and rewrites its opening paragraph is one
    // commit and not two." No code changed for this case; the assertion is
    // unchanged from the pass that pinned it, and is now a decision rather than
    // a status quo.
    const { before, neighbour, subject } = await openWindowAndSubject();

    const renamed = await putDoc(ws, subject.id, { title: "Subject, renamed" }, asUser);
    expect(renamed.status).toBe(200);
    expect(ws.read(subject.path)).toContain("title: Subject, renamed");

    expect(commitCount()).toBe(before + 1);
    expect((await putDoc(ws, neighbour.id, { body: "still typing" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 1);
  });

  it("marking a document still current closes it, on this same route", async () => {
    // The §4 entry this route already honoured before the rider (SERVER-092's
    // `Object.hasOwn(fields, "reviewed")`), kept here so the file shows the two
    // acts this one verb can declare rather than the two answers it used to give.
    const { before, neighbour, subject } = await openWindowAndSubject();

    const reviewed = await putDoc(ws, subject.id, { reviewed: "2026-09-06T09:00:00Z" }, asUser);
    expect(reviewed.status).toBe(200);

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`doc edit: Subject (${subject.id})`);
    expect((await putDoc(ws, neighbour.id, { body: "after" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });
});
