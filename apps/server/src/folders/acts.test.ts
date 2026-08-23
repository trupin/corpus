// The four folder acts, against a real workspace and a real git repository
// (SPEC.md §9.2's rider 7, SERVER-136).
//
// Every assertion reads one of the three real surfaces the write path answers
// to: the file on disk, `git log`/`git ls-tree`, or the projection through the
// HTTP reads a client would use. Nothing here stubs git — a folder act's whole
// claim is "one action, one commit", and a stub would only prove it was called.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDoc,
  createThread,
  createThreadWorkspace,
  type WriteWorkspace,
} from "../threads/thread-fixture.js";

const workspaces: WriteWorkspace[] = [];

afterEach(() => {
  while (workspaces.length > 0) workspaces.pop()?.close();
});

function workspace(prefix: string): WriteWorkspace {
  const ws = createThreadWorkspace(prefix, { sprint: "s041" });
  workspaces.push(ws);
  return ws;
}

type FolderResponse = {
  status: number;
  documents: { id: string; path?: string; status?: string }[];
  warnings: { code: string; detail: string }[];
};

async function act(
  ws: WriteWorkspace,
  verb: "rename" | "archive" | "unarchive" | "delete",
  body: Record<string, unknown>,
  actor?: "user" | "agent",
): Promise<FolderResponse> {
  const response = await ws.post(
    `/api/folders/${verb}`,
    body,
    actor === undefined ? {} : { "x-corpus-author": actor },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    documents: (payload["documents"] ?? []) as FolderResponse["documents"],
    warnings: (payload["warnings"] ?? []) as FolderResponse["warnings"],
  };
}

/** Commit subjects newest-first, so a test can say "the act made exactly one". */
const subjects = (ws: WriteWorkspace): string[] => ws.log("%s");

/** Paths in `HEAD`, which is what a fresh clone of the workspace would hold. */
const tracked = (ws: WriteWorkspace): string[] =>
  ws
    .git("ls-tree", "-r", "--name-only", "HEAD")
    .split("\n")
    .filter((line) => line !== "");

const listIds = async (ws: WriteWorkspace, query: string): Promise<string[]> => {
  const response = await ws.request(`/api/docs?${query}`, {
    headers: { Authorization: `Bearer tkn_0123456789abcdef0123456789abcdef` },
  });
  const payload = (await response.json()) as { items: { id: string }[] };
  return payload.items.map((item) => item.id);
};

/** A folder with two documents and one thread on the first, in one subtree. */
async function seedFolder(
  ws: WriteWorkspace,
): Promise<{ first: string; second: string; thread: string }> {
  const first = await createDoc(ws, {
    type: "note",
    title: "Mortgage",
    folder: "a/b",
    body: "one",
  });
  const second = await createDoc(ws, {
    type: "note",
    title: "Rates",
    folder: "a/b/deep",
    body: "two",
  });
  const thread = await createThread(ws, { parent: first.id, body: "about it" });
  // Every act below counts commits, and §4 folds consecutive writes by one party
  // into one window. Letting the window close is what makes the count the act's.
  ws.advance(60_000);
  return { first: first.id, second: second.id, thread: thread.id };
}

describe("POST /api/folders/rename", () => {
  it("moves every document under the folder, keeps every id, and makes one commit", async () => {
    const ws = workspace("rename");
    const seeded = await seedFolder(ws);
    const before = subjects(ws).length;

    const result = await act(ws, "rename", { from: "a/b", to: "c/d" });

    expect(result.status).toBe(200);
    expect(ws.exists("data/docs/c/d/mortgage.md")).toBe(true);
    expect(ws.exists("data/docs/c/d/deep/rates.md")).toBe(true);
    expect(ws.exists("data/docs/a/b")).toBe(false);
    // The id is identity and the path is presentation (§5): the documents are
    // the same documents, reachable by the same ids.
    expect(await listIds(ws, "folder=c/d")).toEqual(
      expect.arrayContaining([seeded.first, seeded.second, seeded.thread]),
    );
    expect(await listIds(ws, "folder=a/b")).toEqual([]);
    // §6: a thread inherits its parent's folder, so it moved with the parent and
    // is listed as a document the act changed — not as a warning.
    expect(result.documents.map((document) => document.id).sort()).toEqual(
      [seeded.first, seeded.second, seeded.thread].sort(),
    );
    expect(result.documents.find((document) => document.id === seeded.first)?.path).toBe(
      "data/docs/c/d/mortgage.md",
    );
    // §4: one action, one commit.
    expect(subjects(ws).length).toBe(before + 1);
    expect(subjects(ws)[0]).toBe(
      "folder rename: data/docs/a/b → data/docs/c/d (2 documents) by user",
    );
    expect(tracked(ws)).toContain("data/docs/c/d/mortgage.md");
    expect(tracked(ws)).not.toContain("data/docs/a/b/mortgage.md");
  });

  it("carries files that are not documents", async () => {
    const ws = workspace("rename-extra");
    await createDoc(ws, { type: "note", title: "Note", folder: "keep", body: "x" });
    writeFileSync(join(ws.root, "data/docs/keep/diagram.svg"), "<svg/>", "utf8");
    ws.advance(60_000);

    expect((await act(ws, "rename", { from: "keep", to: "kept" })).status).toBe(200);

    expect(ws.exists("data/docs/kept/diagram.svg")).toBe(true);
    expect(ws.exists("data/docs/keep")).toBe(false);
  });

  it("renames an empty folder, which changes no document", async () => {
    const ws = workspace("rename-empty");
    mkdirSync(join(ws.root, "data/docs/hollow"), { recursive: true });

    const result = await act(ws, "rename", { from: "hollow", to: "filled" });

    expect(result.status).toBe(200);
    expect(result.documents).toEqual([]);
    expect(ws.exists("data/docs/filled")).toBe(true);
    expect(ws.exists("data/docs/hollow")).toBe(false);
  });

  it("answers 404 for a folder this workspace does not hold", async () => {
    const ws = workspace("rename-404");
    expect((await act(ws, "rename", { from: "nowhere", to: "somewhere" })).status).toBe(404);
  });

  it("answers 404 when the folder is spelled in a case the workspace does not have", async () => {
    const ws = workspace("rename-case-404");
    await createDoc(ws, { type: "note", title: "Note", folder: "finance", body: "x" });
    // The grammar compares exactly, so a folder act must too — or a workspace
    // would act on different files depending on the developer's filesystem.
    expect((await act(ws, "rename", { from: "FINANCE", to: "other" })).status).toBe(404);
  });

  it("answers 409 rather than merging onto a folder that already exists", async () => {
    const ws = workspace("rename-409");
    await createDoc(ws, { type: "note", title: "One", folder: "a", body: "x" });
    await createDoc(ws, { type: "note", title: "Two", folder: "b", body: "y" });
    ws.advance(60_000);
    const before = subjects(ws).length;

    const result = await act(ws, "rename", { from: "a", to: "b" });

    expect(result.status).toBe(409);
    expect(ws.exists("data/docs/a/one.md")).toBe(true);
    expect(subjects(ws).length).toBe(before);
  });

  it("refuses a path outside data/docs/, a dot segment, and a destination inside the source", async () => {
    const ws = workspace("rename-400");
    await createDoc(ws, { type: "note", title: "One", folder: "a", body: "x" });

    for (const body of [
      { from: "../etc", to: "a" },
      { from: "a", to: "a/deeper" },
      { from: "data/docs/a", to: "b" },
      { from: "a/", to: "b" },
      { from: ".claude/skills", to: "b" },
    ]) {
      expect((await act(ws, "rename", body)).status).toBe(400);
    }
    expect(ws.exists("data/docs/a/one.md")).toBe(true);
  });
});

describe("POST /api/folders/rename — a case-only rename", () => {
  it("recases the folder on disk, in the projection and in git, in one commit", async () => {
    const ws = workspace("rename-case");
    const created = await createDoc(ws, {
      type: "note",
      title: "Mortgage",
      folder: "Finance",
      body: "one",
    });
    ws.advance(60_000);
    const before = subjects(ws).length;

    const result = await act(ws, "rename", { from: "Finance", to: "finance" });

    expect(result.status).toBe(200);
    // On disk: the directory really carries the new spelling, which `existsSync`
    // cannot tell you on a case-insensitive filesystem — `readdir` can.
    expect(readdirSync(join(ws.root, "data/docs"))).toContain("finance");
    expect(readdirSync(join(ws.root, "data/docs"))).not.toContain("Finance");
    expect(result.documents).toEqual([{ id: created.id, path: "data/docs/finance/mortgage.md" }]);
    // In git: the tree a fresh clone would get. This is the half a plain
    // `--only` commit silently drops, because the kernel still answers
    // "present, unchanged" for every path under the old spelling.
    expect(tracked(ws)).toContain("data/docs/finance/mortgage.md");
    expect(tracked(ws)).not.toContain("data/docs/Finance/mortgage.md");
    expect(subjects(ws).length).toBe(before + 1);
    // And the index agrees with the commit, or `git status` would show the
    // rename staged in reverse forever.
    expect(ws.git("status", "--porcelain").trim()).toBe("");
  });

  it("recases a folder that has a subtree", async () => {
    const ws = workspace("rename-case-deep");
    await createDoc(ws, { type: "note", title: "Top", folder: "Docs", body: "one" });
    await createDoc(ws, { type: "note", title: "Deep", folder: "Docs/Sub", body: "two" });
    ws.advance(60_000);

    expect((await act(ws, "rename", { from: "Docs", to: "docs" })).status).toBe(200);

    expect(readdirSync(join(ws.root, "data/docs"))).toContain("docs");
    expect(tracked(ws)).toEqual(
      expect.arrayContaining(["data/docs/docs/top.md", "data/docs/docs/Sub/deep.md"]),
    );
    expect(ws.git("status", "--porcelain").trim()).toBe("");
  });

  it("declares both spellings to the watcher, so neither event re-projects the old path", async () => {
    const ws = workspace("rename-case-watcher");
    await createDoc(ws, { type: "note", title: "Deed", folder: "Finance", body: "the deed" });
    ws.advance(60_000);

    expect((await act(ws, "rename", { from: "Finance", to: "finance" })).status).toBe(200);

    // chokidar reports a case-only directory rename as `change` at the file's
    // **old** spelling followed by `add` at its new one — the old path still
    // stats, so nothing looks unlinked. `claim` is the seam the watcher decides
    // on, and both spellings have to answer it or the row is re-projected under
    // the path the rename just removed (found on a real server: `db doctor`
    // reported `orphan_row` and `duplicate_id`).
    const content = readFileSync(join(ws.root, "data/docs/finance/deed.md"));
    expect(ws.server.selfWrites.claim(join(ws.root, "data/docs/Finance/deed.md"), content)).toBe(
      true,
    );
    expect(ws.server.selfWrites.claim(join(ws.root, "data/docs/finance/deed.md"), content)).toBe(
      true,
    );
  });

  it("does not swallow the operator's unrelated staged work", async () => {
    const ws = workspace("rename-case-staged");
    await createDoc(ws, { type: "note", title: "Mortgage", folder: "Finance", body: "one" });
    ws.advance(60_000);
    writeFileSync(join(ws.root, "NOTES.md"), "mine\n", "utf8");
    ws.git("add", "--", "NOTES.md");

    expect((await act(ws, "rename", { from: "Finance", to: "finance" })).status).toBe(200);

    // The whole reason the ordinary commit is `--only`: an operator's staged
    // file is never taken by a mutation it has nothing to do with.
    expect(tracked(ws)).not.toContain("NOTES.md");
    expect(ws.git("status", "--porcelain")).toContain("A  NOTES.md");
  });
});

describe("POST /api/folders/archive and /unarchive", () => {
  it("archives every document and thread in the folder in one commit, and restores them", async () => {
    const ws = workspace("archive");
    const seeded = await seedFolder(ws);
    const before = subjects(ws).length;

    const archived = await act(ws, "archive", { path: "a/b" });

    expect(archived.status).toBe(200);
    expect(archived.documents.map((document) => document.status)).toEqual([
      "archived",
      "archived",
      "archived",
    ]);
    expect(archived.documents.map((document) => document.id).sort()).toEqual(
      [seeded.first, seeded.second, seeded.thread].sort(),
    );
    // Nothing moved: archiving a folder is a status act (rider 7).
    expect(ws.exists("data/docs/a/b/mortgage.md")).toBe(true);
    expect(await listIds(ws, "folder=a/b")).toEqual([]);
    expect((await listIds(ws, "folder=a/b&includeArchived=true")).sort()).toEqual(
      [seeded.first, seeded.second, seeded.thread].sort(),
    );
    expect(subjects(ws).length).toBe(before + 1);
    expect(subjects(ws)[0]).toBe("folder archive: data/docs/a/b (3 documents) by user");

    ws.advance(60_000);
    const restored = await act(ws, "unarchive", { path: "a/b" });

    // §5: archiving already implied resolved, so restoring lifts the hidden half
    // and nothing else.
    expect(restored.documents.map((document) => document.status)).toEqual([
      "resolved",
      "resolved",
      "resolved",
    ]);
    expect((await listIds(ws, "folder=a/b")).sort()).toEqual(
      [seeded.first, seeded.second, seeded.thread].sort(),
    );
  });

  it("lists a document that was already archived, and writes nothing for it", async () => {
    const ws = workspace("archive-idempotent");
    const first = await createDoc(ws, { type: "note", title: "One", folder: "f", body: "x" });
    const second = await createDoc(ws, { type: "note", title: "Two", folder: "f", body: "y" });
    await ws.post(`/api/docs/${first.id}/archive`, {});
    ws.advance(60_000);
    const before = subjects(ws).length;

    const result = await act(ws, "archive", { path: "f" });

    expect(result.documents.map((document) => document.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(result.documents.every((document) => document.status === "archived")).toBe(true);
    expect(subjects(ws).length).toBe(before + 1);
    // Only the document that moved is in the commit.
    expect(ws.git("show", "--name-only", "--format=", "HEAD").trim()).toBe("data/docs/f/two.md");
  });

  it("answers an empty result for a folder with nothing in it, and makes no commit", async () => {
    const ws = workspace("archive-empty");
    mkdirSync(join(ws.root, "data/docs/hollow"), { recursive: true });
    const before = subjects(ws).length;

    const result = await act(ws, "archive", { path: "hollow" });

    expect(result.status).toBe(200);
    expect(result.documents).toEqual([]);
    expect(subjects(ws).length).toBe(before);
  });

  it("answers 404 for a folder this workspace does not hold", async () => {
    const ws = workspace("archive-404");
    expect((await act(ws, "archive", { path: "nowhere" })).status).toBe(404);
    expect((await act(ws, "unarchive", { path: "nowhere" })).status).toBe(404);
  });
});

describe("POST /api/folders/delete", () => {
  it("removes every document and the folder, in one commit", async () => {
    const ws = workspace("delete");
    const seeded = await seedFolder(ws);
    const before = subjects(ws).length;

    const result = await act(ws, "delete", { path: "a/b" });

    expect(result.status).toBe(200);
    expect(result.documents.map((document) => document.id).sort()).toEqual(
      [seeded.first, seeded.second].sort(),
    );
    expect(ws.exists("data/docs/a/b")).toBe(false);
    expect((await ws.request(`/api/docs/${seeded.first}`)).status).toBe(404);
    expect(subjects(ws).length).toBe(before + 1);
    expect(subjects(ws)[0]).toBe("folder delete: data/docs/a/b (2 documents) by user");
    expect(tracked(ws).filter((path) => path.startsWith("data/docs/a/b/"))).toEqual([]);
    // §9.2: a deleted document's threads become orphaned records. A folder
    // delete is that act over a set, not a second rule that also deletes them.
    expect(ws.exists(`data/threads/${seeded.thread}.md`)).toBe(true);
    expect((await ws.request(`/api/docs/${seeded.thread}`)).status).toBe(200);
    // §7: git preserves history — the deleted document is still readable there.
    expect(ws.git("show", `HEAD~1:data/docs/a/b/mortgage.md`)).toContain("one");
  });

  it("keeps a folder that still holds something the act did not delete", async () => {
    const ws = workspace("delete-extra");
    await createDoc(ws, { type: "note", title: "Note", folder: "mixed", body: "x" });
    writeFileSync(join(ws.root, "data/docs/mixed/diagram.svg"), "<svg/>", "utf8");
    ws.advance(60_000);

    expect((await act(ws, "delete", { path: "mixed" })).status).toBe(200);

    expect(ws.exists("data/docs/mixed/note.md")).toBe(false);
    expect(ws.exists("data/docs/mixed/diagram.svg")).toBe(true);
    expect(ws.exists("data/docs/mixed")).toBe(true);
  });

  it("removes an empty folder and makes no commit", async () => {
    const ws = workspace("delete-empty");
    mkdirSync(join(ws.root, "data/docs/hollow/deeper"), { recursive: true });
    const before = subjects(ws).length;

    const result = await act(ws, "delete", { path: "hollow" });

    expect(result.documents).toEqual([]);
    expect(ws.exists("data/docs/hollow")).toBe(false);
    expect(subjects(ws).length).toBe(before);
  });

  it("refuses the agent with 403, before it reads or writes anything", async () => {
    const ws = workspace("delete-403");
    await createDoc(ws, { type: "note", title: "One", folder: "f", body: "x" });
    ws.advance(60_000);
    const before = subjects(ws).length;

    // Refused whether the folder exists or not: the rule is about who is asking.
    expect((await act(ws, "delete", { path: "f" }, "agent")).status).toBe(403);
    expect((await act(ws, "delete", { path: "nowhere" }, "agent")).status).toBe(403);
    expect(ws.exists("data/docs/f/one.md")).toBe(true);
    expect(subjects(ws).length).toBe(before);
  });

  it("answers 404 for a folder this workspace does not hold", async () => {
    const ws = workspace("delete-404");
    expect((await act(ws, "delete", { path: "nowhere" })).status).toBe(404);
  });
});

describe("a folder act announces itself over SSE", () => {
  it("carries the collection, every document it changed and the tree, in one frame", async () => {
    const ws = workspace("keys");
    const seeded = await seedFolder(ws);
    const frames: string[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => {
      frames.push(keys.map((key) => JSON.stringify(key)));
    });

    await act(ws, "archive", { path: "a/b" });
    unsubscribe();

    expect(frames.length).toBe(1);
    const keys = frames[0] ?? [];
    expect(keys).toContain(JSON.stringify(["docs"]));
    expect(keys).toContain(JSON.stringify(["docs", seeded.first]));
    expect(keys).toContain(JSON.stringify(["docs", seeded.thread]));
    expect(keys).toContain(JSON.stringify(["threads", seeded.thread]));
    // Archiving takes the folder's documents out of every count, so the badge
    // moved and `runMutation` measured it (SERVER-018).
    expect(keys).toContain(JSON.stringify(["tree"]));
  });
});

describe("the folder membership rules", () => {
  it("does not reach a sibling folder whose name shares a prefix", async () => {
    const ws = workspace("prefix");
    const inside = await createDoc(ws, { type: "note", title: "In", folder: "fin", body: "x" });
    const sibling = await createDoc(ws, {
      type: "note",
      title: "Out",
      folder: "finance",
      body: "y",
    });
    ws.advance(60_000);

    const result = await act(ws, "archive", { path: "fin" });

    expect(result.documents.map((document) => document.id)).toEqual([inside.id]);
    expect(await listIds(ws, "folder=finance")).toEqual([sibling.id]);
  });

  it("reaches every level of a subtree", async () => {
    const ws = workspace("subtree");
    const top = await createDoc(ws, { type: "note", title: "Top", folder: "t", body: "x" });
    const deep = await createDoc(ws, {
      type: "note",
      title: "Deep",
      folder: "t/one/two",
      body: "y",
    });
    ws.advance(60_000);

    const result = await act(ws, "archive", { path: "t" });

    expect(result.documents.map((document) => document.id).sort()).toEqual(
      [top.id, deep.id].sort(),
    );
  });
});

describe("a folder act is serialized against document writes", () => {
  it("does not lose a save that landed before it", async () => {
    const ws = workspace("lanes");
    const created = await createDoc(ws, {
      type: "note",
      title: "Note",
      folder: "f",
      body: "before",
    });
    ws.advance(60_000);

    // Both writes go through the same lane set, so the archive reads what the
    // save wrote rather than the bytes it started from.
    const [saved, archived] = await Promise.all([
      ws.put(`/api/docs/${created.id}`, { tags: ["kept"] }),
      act(ws, "archive", { path: "f" }),
    ]);

    expect(saved.status).toBe(200);
    expect(archived.status).toBe(200);
    expect(ws.read("data/docs/f/note.md")).toContain("kept");
    expect(ws.read("data/docs/f/note.md")).toContain("archived");
  });

  it("waits for a held lane instead of writing over it", async () => {
    const ws = workspace("lanes-held");
    const created = await createDoc(ws, {
      type: "note",
      title: "Note",
      folder: "f",
      body: "before",
    });
    ws.advance(60_000);

    // Hold the document's lane by hand, so the interleaving is *decided* rather
    // than timed: the act must not reach its write while this is outstanding.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutex = ws.server.mutex;
    expect(mutex).toBeDefined();
    void mutex?.run(created.id, () => held);

    const acting = act(ws, "archive", { path: "f" });
    // Everything the act does before the write is synchronous once it is past
    // the lanes, so draining the loop is enough: if it were taking no lane, the
    // file would already say `archived`.
    for (let turn = 0; turn < 10; turn += 1) await new Promise(setImmediate);
    expect(ws.read("data/docs/f/note.md")).toContain("status: open");

    release();
    expect((await acting).status).toBe(200);
    expect(ws.read("data/docs/f/note.md")).toContain("status: archived");
  });
});

describe("a folder act is one of SPEC.md §4's acts that commit alone", () => {
  it("lets an open editing session commit first, then commits by itself", async () => {
    const ws = workspace("commits-alone");
    const edited = await createDoc(ws, {
      type: "note",
      title: "Edited",
      folder: "other",
      body: "one",
    });
    await createDoc(ws, { type: "note", title: "Filed", folder: "f", body: "two" });
    ws.advance(60_000);

    // A window wide open, and no clock movement before the act meets it.
    const key = ((await (await ws.request(`/api/docs/${edited.id}`)).json()) as { key: string })
      .key;
    expect((await ws.put(`/api/docs/${edited.id}`, { body: "underway", key })).status).toBe(200);
    const before = subjects(ws).length;

    expect((await act(ws, "archive", { path: "f" })).status).toBe(200);

    // The editing session's commit lands first; the act's stands alone after it,
    // so reverting the act undoes the act and nothing else.
    expect(subjects(ws).length).toBe(before + 1);
    expect(subjects(ws)[0]).toBe("folder archive: data/docs/f (1 document) by user");
    expect(ws.git("show", "--name-only", "--format=", "HEAD").trim()).toBe("data/docs/f/filed.md");
    expect(ws.git("show", "--name-only", "--format=", "HEAD~1")).toContain(
      "data/docs/other/edited.md",
    );
  });

  it("opens no window for a later save to fold into", async () => {
    const ws = workspace("no-window");
    const created = await createDoc(ws, {
      type: "note",
      title: "Filed",
      folder: "f",
      body: "one",
    });
    ws.advance(60_000);

    expect((await act(ws, "archive", { path: "f" })).status).toBe(200);
    const afterAct = subjects(ws).length;

    // No clock movement: an ordinary save straight after the act must make its
    // own commit rather than amend the act's out of existence.
    const key = ((await (await ws.request(`/api/docs/${created.id}`)).json()) as { key: string })
      .key;
    expect((await ws.put(`/api/docs/${created.id}`, { body: "two", key })).status).toBe(200);

    expect(subjects(ws).length).toBe(afterAct + 1);
    expect(subjects(ws)[1]).toBe("folder archive: data/docs/f (1 document) by user");
  });
});

/** The scratch directory a case-only rename uses must never survive the request. */
describe("the temporary name a case-only rename goes through", () => {
  it("is gone by the time the act answers", async () => {
    const ws = workspace("rename-case-temp");
    await createDoc(ws, { type: "note", title: "One", folder: "Case", body: "x" });
    ws.advance(60_000);

    await act(ws, "rename", { from: "Case", to: "case" });

    expect(
      readdirSync(join(ws.root, "data/docs")).filter((name) => name.startsWith(".corpus-rename-")),
    ).toEqual([]);
    expect(existsSync(join(ws.root, "data/docs/case/one.md"))).toBe(true);
  });
});
