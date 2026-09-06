// **The status quo on §4's undecided doors, pinned pending a rider** (SERVER-106).
//
// SPEC.md §4 lists "a document archived, restored, moved, renamed, or marked
// still current (§5)" among the acts that close a commit window. SPEC.md §10's
// frontmatter-strip rider (signed 2026-08-12) says the opposite of the same
// change made through the reader: "every field the reader edits — the title
// above the body, and the strip's tags, status, stage and dates — is an
// ordinary save that joins the open window", and "§4's acts are reached through
// their own verbs, not through the strip".
//
// Both sentences are in force, and they disagree about the status a `PUT
// /api/docs/{id}` writes. Settling that changes SPEC.md whichever way it goes,
// so it needs the user's signature, which sprint-024 does not have (Ruling 3).
// **Nothing here asserts a decision, and nothing here changed behaviour.**
//
// What it does assert is what the server does **today**, so that the diff a
// signature produces is visible rather than silent: whichever reading is signed,
// one of these tests changes, and it changes in the file whose whole purpose is
// to say so. The cases that assert §4's *decided* behaviour live in
// `acts.test.ts` and are untouched by this file.
//
// The audit — every §4 list entry against every door that reaches it — and the
// drafted rider are in
// `issues/server/106-archiving-through-the-form-is-not-an-act.md`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "@corpus/contract";
import { editingSessionSubject } from "../git/index.js";
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

describe("status quo, pending SERVER-106's rider: archiving through `PUT`", () => {
  it("folds into the open window and does not close it", async () => {
    const { before, neighbour, subject } = await openWindowAndSubject();

    const flipped = await putDoc(ws, subject.id, { status: "archived" }, asUser);
    expect(flipped.status).toBe(200);
    expect(statusOf(subject.path)).toBe("status: archived");

    // TODAY: the flip folds in like any save — still the one window's commit.
    expect(commitCount()).toBe(before + 1);

    // TODAY: the window is still open, so the next save by the same party folds
    // into it too. Under §4's list read literally this would be a second commit,
    // because the act would have closed the window.
    expect((await putDoc(ws, neighbour.id, { body: "still typing" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 1);

    // TODAY: and when the window finally closes it is relabelled an editing
    // session — the archive's own subject does not survive. Under §4's list read
    // literally the subject would name the act.
    ws.advance(QUIET);
    expect((await putDoc(ws, neighbour.id, { body: "much later" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
    expect(subjectOf("HEAD^")).toBe(editingSessionSubject(2, "user"));
  });

  it("the archive **verb** on the same document does close the window", async () => {
    // The divergence in one file: the same change to the same document, through
    // the door §4's list is uncontroversially about. `acts.test.ts` owns this
    // assertion for §4's sake; it is repeated here only so the two doors can be
    // read side by side while the rider is unsigned.
    const { before, neighbour, subject } = await openWindowAndSubject();

    expect((await ws.post(`/api/docs/${subject.id}/archive`, {}, asUser)).status).toBe(200);

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`doc archive: Subject (${subject.id})`);

    // Closed: the next save opens a fresh window rather than folding.
    expect((await putDoc(ws, neighbour.id, { body: "after" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });
});

describe("status quo, pending SERVER-106's rider: restoring through `PUT`", () => {
  it("is refused outright when the caller writes `status: open` (SERVER-039)", async () => {
    // The audit's correction to sprint-024's P9, which lists this as the second
    // act-declaration gap. It is not one, because the door is shut a step
    // earlier: `assertNotUnarchivingByPut` answers `400` for **every** document,
    // since for a §7 skill unarchiving is a folder move a field edit cannot
    // undo. So "restored" has exactly one direct door — the unarchive verb —
    // and it declares the act.
    const { subject } = await openWindowAndSubject();
    expect((await ws.post(`/api/docs/${subject.id}/archive`, {}, asUser)).status).toBe(200);
    ws.advance(QUIET);

    const restored = await putDoc(ws, subject.id, { status: "open" }, asUser);
    expect(restored.status).toBe(400);
    expect(statusOf(subject.path)).toBe("status: archived");
  });

  it("reaches the file through §5's stage coupling, and folds there too", async () => {
    // The restore door that **does** exist through `PUT`, and the one the rider
    // has to cover: §5's kanban coupling writes `status` from a `stage`, and it
    // deliberately bypasses `assertNotUnarchivingByPut` (`update.ts`) so a board
    // that maps a stage to `archived` is not a one-way trip. Both directions run
    // through the same `act:` expression as a plain flip, so both fold.
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

    // TODAY: folded, window still open, subject relabelled on close.
    expect(commitCount()).toBe(before + 1);
    expect((await putDoc(ws, neighbour.id, { body: "still typing" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 1);
    ws.advance(QUIET);
    expect((await putDoc(ws, neighbour.id, { body: "much later" }, asUser)).status).toBe(200);
    expect(subjectOf("HEAD^")).toBe(editingSessionSubject(2, "user"));
  });
});

describe("status quo, pending SERVER-106's rider: the rest of §4's list through `PUT`", () => {
  it("retitling does not close the window", async () => {
    // The third door the audit found, and the one SERVER-106's own summary
    // reports as a wrong repair of §10: §4 lists "renamed" as an act, and a
    // document's *name* is its title (§5 makes the path presentation).
    // `docs/move.ts` — the only door that declares that act — changes the
    // containing folder and never the title, so a retitle reaches §4's list
    // through nothing at all. Pinned, not judged.
    const { before, neighbour, subject } = await openWindowAndSubject();

    const renamed = await putDoc(ws, subject.id, { title: "Subject, renamed" }, asUser);
    expect(renamed.status).toBe(200);
    expect(ws.read(subject.path)).toContain("title: Subject, renamed");

    expect(commitCount()).toBe(before + 1);
    expect((await putDoc(ws, neighbour.id, { body: "still typing" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 1);
  });

  it("marking a document still current does close it, on this same route", async () => {
    // The one §4 entry the `PUT` door already honours (`update.ts`'s
    // `Object.hasOwn(fields, "reviewed")`), asserted here so the audit's claim
    // that one route answers §4 two different ways is checkable in one file.
    const { before, neighbour, subject } = await openWindowAndSubject();

    const reviewed = await putDoc(ws, subject.id, { reviewed: "2026-09-06T09:00:00Z" }, asUser);
    expect(reviewed.status).toBe(200);

    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain(`doc edit: Subject (${subject.id})`);
    expect((await putDoc(ws, neighbour.id, { body: "after" }, asUser)).status).toBe(200);
    expect(commitCount()).toBe(before + 2);
  });
});
