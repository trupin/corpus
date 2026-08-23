// What a folder holds, asked of the projection directly (SERVER-136).
//
// The acts' own suite drives everything over HTTP, which is the right level for
// behaviour and the wrong one for this: the rule these functions keep — that a
// folder is matched **byte-exactly** — is invisible through a route on a
// case-insensitive filesystem, because the `404` fires before any query runs.
// Asked here instead, where a spelling the workspace does not have can still be
// put to the query.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDoc,
  createThread,
  createThreadWorkspace,
  type WriteWorkspace,
} from "../threads/thread-fixture.js";
import { documentsUnder, folderExists, folderPath, membersUnder, threadsUnder } from "./members.js";

const workspaces: WriteWorkspace[] = [];

afterEach(() => {
  while (workspaces.length > 0) workspaces.pop()?.close();
});

function workspace(prefix: string): WriteWorkspace {
  const ws = createThreadWorkspace(prefix, { sprint: "s041" });
  workspaces.push(ws);
  return ws;
}

describe("folderPath", () => {
  it("is the folder under the one document root a folder act reaches", () => {
    expect(folderPath("finance/mortgage")).toBe("data/docs/finance/mortgage");
  });
});

describe("folderExists", () => {
  it("answers for a directory spelled exactly as it is on disk", () => {
    const ws = workspace("exists");
    mkdirSync(join(ws.root, "data/docs/Finance/2026"), { recursive: true });

    expect(folderExists(ws.root, "Finance")).toBe(true);
    expect(folderExists(ws.root, "Finance/2026")).toBe(true);
    // The spelling the workspace does not have, which a case-insensitive
    // filesystem would otherwise `stat` happily.
    expect(folderExists(ws.root, "finance")).toBe(false);
    expect(folderExists(ws.root, "Finance/2027")).toBe(false);
    expect(folderExists(ws.root, "nowhere")).toBe(false);
  });

  it("is false for a file, and for a path that only resolves through one", () => {
    const ws = workspace("exists-file");
    mkdirSync(join(ws.root, "data/docs/f"), { recursive: true });
    ws.write("data/docs/f/note.md", "---\nid: doc_x\n---\n");

    expect(folderExists(ws.root, "f/note.md")).toBe(false);
    expect(folderExists(ws.root, "f/note.md/deeper")).toBe(false);
  });
});

describe("documentsUnder", () => {
  it("matches the folder byte-exactly, whatever SQLite's LIKE would fold", async () => {
    const ws = workspace("exact");
    const created = await createDoc(ws, { type: "note", title: "Note", folder: "fin", body: "x" });

    expect(documentsUnder(ws.db, "fin").map((member) => member.id)).toEqual([created.id]);
    // `LIKE 'data/docs/FIN/%'` matches this row in SQLite; the folder grammar
    // says it does not name it.
    expect(documentsUnder(ws.db, "FIN")).toEqual([]);
  });

  it("does not reach a sibling whose name merely starts the same way", async () => {
    const ws = workspace("prefix");
    const inside = await createDoc(ws, { type: "note", title: "In", folder: "fin", body: "x" });
    await createDoc(ws, { type: "note", title: "Out", folder: "finance", body: "y" });

    expect(documentsUnder(ws.db, "fin").map((member) => member.id)).toEqual([inside.id]);
  });

  it("reaches every level of a subtree, in path order", async () => {
    const ws = workspace("subtree");
    const deep = await createDoc(ws, { type: "note", title: "Deep", folder: "t/a/b", body: "x" });
    const top = await createDoc(ws, { type: "note", title: "Top", folder: "t", body: "y" });

    expect(documentsUnder(ws.db, "t").map((member) => member.path)).toEqual([
      "data/docs/t/a/b/deep.md",
      "data/docs/t/top.md",
    ]);
    expect(
      documentsUnder(ws.db, "t")
        .map((member) => member.id)
        .sort(),
    ).toEqual([deep.id, top.id].sort());
  });

  it("reaches only itself when the folder's name carries a LIKE wildcard", async () => {
    const ws = workspace("wildcard");
    await createDoc(ws, { type: "note", title: "Under", folder: "q_1", body: "x" });
    const decoy = await createDoc(ws, { type: "note", title: "Decoy", folder: "q11", body: "y" });

    // `q_1` is a `LIKE` pattern matching `q11`, and an act that moved somebody
    // else's folder because of a `_` in a name would be hard to explain. Two
    // rules keep it from happening — the pattern is escaped and every row is
    // then compared byte-exactly — and this asserts the outcome, which is what
    // the caller is owed either way.
    expect(documentsUnder(ws.db, "q_1").map((member) => member.path)).toEqual([
      "data/docs/q_1/under.md",
    ]);
    expect(documentsUnder(ws.db, "q11").map((member) => member.id)).toEqual([decoy.id]);
  });
});

describe("threadsUnder", () => {
  it("finds the threads of the documents filed there, and no others", async () => {
    const ws = workspace("threads");
    const parent = await createDoc(ws, { type: "note", title: "Note", folder: "f", body: "x" });
    const elsewhere = await createDoc(ws, { type: "note", title: "Other", folder: "g", body: "y" });
    const about = await createThread(ws, { parent: parent.id, body: "here" });
    await createThread(ws, { parent: elsewhere.id, body: "there" });
    // A standalone thread belongs to no folder — there is no parent to inherit
    // one from (§6).
    await createThread(ws, { parent: null, body: "loose" });

    expect(threadsUnder(ws.db, "f").map((member) => member.id)).toEqual([about.id]);
    // Its file is flat, whichever folder it is counted in (§4).
    expect(threadsUnder(ws.db, "f")[0]?.path).toBe(`data/threads/${about.id}.md`);
    expect(threadsUnder(ws.db, "FANCY")).toEqual([]);
  });
});

describe("membersUnder", () => {
  it("lists the folder's documents first and its conversations after them", async () => {
    const ws = workspace("members");
    const parent = await createDoc(ws, { type: "note", title: "Note", folder: "f", body: "x" });
    const thread = await createThread(ws, { parent: parent.id, body: "about it" });

    expect(membersUnder(ws.db, "f").map((member) => member.id)).toEqual([parent.id, thread.id]);
    expect(membersUnder(ws.db, "f").map((member) => member.type)).toEqual(["note", "thread"]);
  });
});
