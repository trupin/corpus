// `POST /api/docs/bulk` — SPEC.md §4's "One action, one commit" and §11's
// actions on a selection (SERVER-077).
//
// Everything load-bearing here is asserted against **real git output**, never
// against the server's own bookkeeping: the whole point of the route is that
// every document `changed` names has a file in that one commit, and a test that
// compared the response to itself would pass over a loop of the single-document
// write path — the one failure mode this route exists to prevent, and the one
// that looks like it works.
//
// That invariant is **containment, not set equality**, and the two suites below
// pin the difference: the commit legitimately carries files for documents the
// act never named — §6's cascade parent, and the nested `SKILL.md` a §7 folder
// move disables — because the result's three parts partition the *requested*
// ids and those documents are not among them. The equality assertions here are
// therefore made only where no such file can exist.

import { chmodSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER, BulkActionResultSchema, type BulkActionResult } from "@corpus/contract";
import { createThread } from "../threads/thread-fixture.js";
import { AUTH, createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

const asAgent: Record<string, string> = { [ACTOR_HEADER]: "agent" };

beforeEach(() => {
  ws = createWriteWorkspace("bulk", { sprint: "s024" });
});

afterEach(() => {
  ws.close();
});

/**
 * The act, parsed through the contract's own response schema — so a shape that
 * drifted from `BulkActionResult` fails here rather than in a client.
 */
const bulk = async (
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; result: BulkActionResult }> => {
  const response = await ws.post("/api/docs/bulk", body, headers);
  const payload: unknown = await response.json();
  if (response.status !== 200) {
    return { status: response.status, result: payload as BulkActionResult };
  }
  return { status: response.status, result: BulkActionResultSchema.parse(payload) };
};

/**
 * The files a commit contains, from git itself. `--no-renames` on purpose: a
 * move is one document at two paths, and rename detection would hide the old
 * one — the question here is which bytes the commit touched.
 */
const filesIn = (sha: string): string[] =>
  ws
    .git("show", "--name-only", "--no-renames", "--format=", sha)
    .split("\n")
    .filter((line) => line !== "")
    .sort();

const pathOf = (id: string): string =>
  (ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(id) as { path: string }).path;

const acquireLock = async (id: string, actor: "user" | "agent"): Promise<void> => {
  const response = await ws.server.app.request(`/api/locks/${id}`, {
    method: "POST",
    headers: { ...AUTH, [ACTOR_HEADER]: actor },
  });
  expect(response.status).toBe(201);
};

const idAt = (path: string): string =>
  (ws.db.prepare("SELECT id FROM documents WHERE path = ?").get(path) as { id: string }).id;

const statusAt = (path: string): string =>
  (ws.db.prepare("SELECT status FROM documents WHERE path = ?").get(path) as { status: string })
    .status;

const skillSource = (name: string): string =>
  ["---", `name: ${name}`, `description: The ${name} skill.`, "---", "", `# ${name}`, ""].join(
    "\n",
  );

/**
 * A real skill folder — `SKILL.md`, a sibling, **and a nested skill**, which
 * `skillDocumentsUnder` documents as a supported shape and which is what makes a
 * §7 folder move carry a document the act never named.
 */
function seedSkills(): { outer: string; nested: string } {
  ws.write(".claude/skills/demo/SKILL.md", skillSource("demo"));
  ws.write(".claude/skills/demo/reference.md", "# Reference\n\nDetails.\n");
  ws.write(".claude/skills/demo/nested/SKILL.md", skillSource("nested"));
  ws.git("add", "-A", "--", ".claude");
  ws.git("commit", "-m", "seed the skills");
  ws.reproject();
  return {
    outer: idAt(".claude/skills/demo/SKILL.md"),
    nested: idAt(".claude/skills/demo/nested/SKILL.md"),
  };
}

const seed = async (count: number, prefix = "Note"): Promise<{ id: string; path: string }[]> => {
  const docs: { id: string; path: string }[] = [];
  for (let index = 0; index < count; index += 1) {
    const created = await createDoc(ws, { type: "note", title: `${prefix} ${String(index)}` });
    docs.push({ id: created.id, path: created.path });
  }
  return docs;
};

describe("one act, one commit", () => {
  it("archives twenty documents as one commit whose files are exactly `changed`", async () => {
    const docs = await seed(20);
    const locked = docs.slice(0, 3);
    for (const doc of locked) await acquireLock(doc.id, "agent");

    const commitsBefore = ws.log("%H").length;
    const { status, result } = await bulk({
      ids: docs.map((doc) => doc.id),
      action: { action: "archive" },
    });

    // A locked document is a per-document outcome, never a verdict on the
    // request (§11): seventeen still archive.
    expect(status).toBe(200);
    expect(result.action).toBe("archive");
    expect(result.changed).toHaveLength(17);
    expect(result.alreadyInState).toEqual([]);
    expect(result.refused.map((entry) => [entry.id, entry.reason, entry.lock?.holder])).toEqual(
      locked.map((doc) => [doc.id, "locked", "agent"]),
    );

    // One commit. Not seventeen.
    expect(ws.log("%H")).toHaveLength(commitsBefore + 1);
    expect(result.commit).toBe(ws.head());

    // The assertion the route exists for, read from git rather than from the
    // server: every document `changed` names has its file here. Asserted as an
    // equality because this particular act can produce nothing else — plain
    // notes, no §6 cascade, no §7 folder move.
    expect(filesIn(result.commit ?? "")).toEqual(result.changed.map(pathOf).sort());

    // And the three refused documents left nothing in it — `git log` never
    // records an effect the caller was told did not happen.
    for (const doc of locked) {
      expect(filesIn(result.commit ?? "")).not.toContain(doc.path);
      expect(ws.read(doc.path)).not.toContain("status: archived");
    }
    for (const id of result.changed) {
      expect(ws.read(pathOf(id))).toContain("status: archived");
    }
  });

  it("names the action and every document it changed in the commit message", async () => {
    const docs = await seed(3);
    const { result } = await bulk({
      ids: docs.map((doc) => doc.id),
      action: { action: "archive" },
    });

    expect(ws.git("log", "-1", "--format=%s").trim()).toBe("bulk archive: 3 documents by user");
    const body = ws.git("log", "-1", "--format=%b");
    for (const id of result.changed) expect(body).toContain(`Corpus-Doc: ${id}`);
    expect(body).toContain("Corpus-Actor: user");
    // Authored by the acting party like any other mutation (§4).
    expect(ws.git("log", "-1", "--format=%an").trim()).toBe("user");
  });

  it("makes no commit at all when the act changes nothing", async () => {
    const docs = await seed(2);
    await bulk({ ids: docs.map((doc) => doc.id), action: { action: "archive" } });

    const head = ws.head();
    const commits = ws.log("%H").length;
    const { result } = await bulk({
      ids: docs.map((doc) => doc.id),
      action: { action: "archive" },
    });

    expect(result.changed).toEqual([]);
    expect(result.alreadyInState).toEqual(docs.map((doc) => doc.id));
    expect(result.commit).toBeNull();
    // No empty commit object: the history did not move.
    expect(ws.head()).toBe(head);
    expect(ws.log("%H")).toHaveLength(commits);
    expect(ws.git("status", "--porcelain").trim()).toBe("");
  });

  it("counts a document already in the requested state out of the commit", async () => {
    const [open, archived] = await seed(2);
    await ws.post(`/api/docs/${archived?.id ?? ""}/archive`, {});

    const { result } = await bulk({
      ids: [open?.id ?? "", archived?.id ?? ""],
      action: { action: "archive" },
    });

    expect(result.changed).toEqual([open?.id]);
    expect(result.alreadyInState).toEqual([archived?.id]);
    expect(filesIn(result.commit ?? "")).toEqual([open?.path]);
  });
});

describe("the bulk commit stands alone in both directions (§4)", () => {
  it("does not fold into the editing session that preceded it", async () => {
    const [doc] = await seed(1);
    const id = doc?.id ?? "";

    const edited = await ws.put(`/api/docs/${id}`, { body: "the user's first draft" });
    expect(edited.status).toBe(200);
    const sessionCommit = ws.head();
    const commits = ws.log("%H").length;

    // No clock movement at all: the same author, the same document, well inside
    // §4's 30 s squash window — exactly the situation an ordinary save folds in.
    const { result } = await bulk({ ids: [id], action: { action: "archive" } });

    expect(result.commit).not.toBe(sessionCommit);
    expect(ws.log("%H")).toHaveLength(commits + 1);
    expect(ws.git("rev-parse", "HEAD^").trim()).toBe(sessionCommit);
    // The session's own commit still says what it said.
    expect(ws.git("log", "-1", "--format=%s", sessionCommit).trim()).toContain("doc edit:");
  });

  it("takes no later save into itself", async () => {
    const [doc] = await seed(1);
    const id = doc?.id ?? "";

    const { result } = await bulk({ ids: [id], action: { action: "tag", add: ["q3"] } });
    const bulkCommit = result.commit ?? "";
    const commits = ws.log("%H").length;
    const bulkTree = ws.git("rev-parse", `${bulkCommit}^{tree}`).trim();

    const saved = await ws.put(`/api/docs/${id}`, { body: "typed right after the act" });
    expect(saved.status).toBe(200);

    expect(ws.head()).not.toBe(bulkCommit);
    expect(ws.log("%H")).toHaveLength(commits + 1);
    expect(ws.git("rev-parse", "HEAD^").trim()).toBe(bulkCommit);
    // Still byte-for-byte the act it recorded: nothing was amended into it.
    expect(ws.git("rev-parse", `${bulkCommit}^{tree}`).trim()).toBe(bulkTree);
    expect(ws.git("log", "-1", "--format=%s", bulkCommit).trim()).toBe(
      "bulk tag: 1 document by user",
    );
  });

  it("still folds two ordinary saves of one document, which is what §4 squashes", async () => {
    // The guard against fixing the two directions above by disabling squashing.
    const [doc] = await seed(1);
    const id = doc?.id ?? "";
    await ws.put(`/api/docs/${id}`, { body: "first" });
    const commits = ws.log("%H").length;
    await ws.put(`/api/docs/${id}`, { body: "second" });
    expect(ws.log("%H")).toHaveLength(commits);
  });
});

describe("the eight acts", () => {
  it("archives and unarchives", async () => {
    const docs = await seed(2);
    const ids = docs.map((doc) => doc.id);
    const archived = await bulk({ ids, action: { action: "archive" } });
    expect(archived.result.changed).toEqual(ids);

    const restored = await bulk({ ids, action: { action: "unarchive" } });
    expect(restored.result.changed).toEqual(ids);
    expect(filesIn(restored.result.commit ?? "")).toEqual(docs.map((doc) => doc.path).sort());
    for (const doc of docs) expect(ws.read(doc.path)).toContain("status: open");
  });

  it("resolves and reopens threads, and refuses a document that is not one", async () => {
    const [parent] = await seed(1);
    const first = await createThread(ws, { parent: parent?.id ?? null, body: "one" });
    const second = await createThread(ws, { parent: parent?.id ?? null, body: "two" });

    const resolved = await bulk({
      ids: [first.id, second.id, parent?.id ?? ""],
      action: { action: "resolve" },
    });
    expect(resolved.result.changed).toEqual([first.id, second.id]);
    expect(resolved.result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
      [parent?.id, "not-applicable"],
    ]);
    expect(filesIn(resolved.result.commit ?? "")).toEqual(
      [`data/threads/${first.id}.md`, `data/threads/${second.id}.md`].sort(),
    );
    expect(ws.read(`data/threads/${first.id}.md`)).toContain("status: resolved");

    const reopened = await bulk({ ids: [first.id, second.id], action: { action: "reopen" } });
    expect(reopened.result.changed).toEqual([first.id, second.id]);
    expect(ws.read(`data/threads/${second.id}.md`)).toContain("status: open");
  });

  it("moves a whole selection into one folder", async () => {
    const docs = await seed(3);
    const { result } = await bulk({
      ids: docs.map((doc) => doc.id),
      action: { action: "move", folder: "finance" },
    });

    expect(result.changed).toEqual(docs.map((doc) => doc.id));
    for (const doc of docs) expect(pathOf(doc.id)).toMatch(/^data\/docs\/finance\//);
    // One commit carrying both sides of every rename.
    expect(filesIn(result.commit ?? "")).toEqual(
      [...docs.map((doc) => doc.path), ...docs.map((doc) => pathOf(doc.id))].sort(),
    );
    // Ids never change, so nothing that referenced them had to be rewritten.
    expect(result.changed).toEqual(docs.map((doc) => doc.id));
  });

  it("refuses a folder that names nothing for the whole request, before any write", async () => {
    const docs = await seed(2);
    const head = ws.head();
    const { status } = await bulk({
      ids: docs.map((doc) => doc.id),
      action: { action: "move", folder: "../escape" },
    });
    expect(status).toBe(400);
    expect(ws.head()).toBe(head);
  });

  it("tags as a delta — adding and removing, never replacing", async () => {
    const first = await createDoc(ws, { type: "note", title: "A", tags: ["keep", "drop"] });
    const second = await createDoc(ws, { type: "note", title: "B", tags: ["keep"] });
    const third = await createDoc(ws, { type: "note", title: "C", tags: ["other"] });

    const { result } = await bulk({
      ids: [first.id, second.id, third.id],
      action: { action: "tag", add: ["q3"], remove: ["drop"] },
    });

    expect(result.changed).toEqual([first.id, second.id, third.id]);
    // Each document keeps its own set; only the named tags moved.
    expect(ws.read(first.path)).toContain("tags:");
    expect(tagsOf(first.path)).toEqual(["keep", "q3"]);
    expect(tagsOf(second.path)).toEqual(["keep", "q3"]);
    expect(tagsOf(third.path)).toEqual(["other", "q3"]);

    // Adding a tag a document already carries is a no-op for it, not a failure.
    const again = await bulk({
      ids: [first.id, second.id],
      action: { action: "tag", add: ["q3"] },
    });
    expect(again.result.changed).toEqual([]);
    expect(again.result.alreadyInState).toEqual([first.id, second.id]);
    expect(again.result.commit).toBeNull();
  });

  it("records review as a committed act that is not an edit", async () => {
    const [doc] = await seed(1);
    const path = doc?.path ?? "";
    const updatedBefore = /^updated: (.+)$/m.exec(ws.read(path))?.[1];

    ws.advance(60_000);
    const { result } = await bulk({ ids: [doc?.id ?? ""], action: { action: "review" } });

    expect(result.changed).toEqual([doc?.id]);
    expect(ws.read(path)).toContain("reviewed: 2026-07-27T09:01:00Z");
    // SPEC.md §5: staleness runs from `max(updated, reviewed)`, so a review that
    // stamped `updated` would reset the clock it exists to confirm.
    expect(/^updated: (.+)$/m.exec(ws.read(path))?.[1]).toBe(updatedBefore);
  });

  it("deletes, cascading anchors and reporting orphaned threads", async () => {
    const [parent] = await seed(1);
    const parentPath = parent?.path ?? "";
    const anchored = await createThread(ws, {
      parent: parent?.id ?? null,
      selector: { exact: "Note 0", prefix: "", suffix: "" },
      body: "about the title",
    });
    const standalone = await createThread(ws, { parent: parent?.id ?? null, body: "no anchor" });
    expect(ws.read(parentPath)).toContain(anchored.anchorId ?? "");

    const { result } = await bulk({
      ids: [anchored.id, parent?.id ?? ""],
      action: { action: "delete" },
    });

    expect(result.changed).toEqual([anchored.id, parent?.id]);
    // §6: no highlight is left pointing at an empty conversation, and the
    // parent's rewrite is in the *same* commit as the deletion.
    expect(filesIn(result.commit ?? "")).toEqual(
      [`data/threads/${anchored.id}.md`, parentPath].sort(),
    );
    expect(ws.exists(`data/threads/${anchored.id}.md`)).toBe(false);
    expect(ws.exists(parentPath)).toBe(false);
    // The standalone thread survives as an orphaned record, and is reported —
    // and it is the *only* one. `planDelete` answers from the projection, which
    // does not move until `finishMutation` runs after the whole loop, so the
    // parent's plan still sees the row of the thread this same act deleted one
    // iteration earlier. Reporting it here would name it as deleted and as a
    // surviving orphan whose caches to drop, and §11's confirm counts exactly
    // this number.
    expect(result.orphanedThreadIds).toEqual([standalone.id]);
    expect(result.orphanedThreadIds).not.toContain(anchored.id);
    expect(result.changed).toContain(anchored.id);
    expect(ws.exists(`data/threads/${standalone.id}.md`)).toBe(true);
  });

  it("still reports a thread whose own deletion was refused as a surviving orphan", async () => {
    // The other half of the filter: only a thread this act actually deleted
    // stops being an orphan. One that was refused did survive.
    const [parent] = await seed(1);
    const thread = await createThread(ws, { parent: parent?.id ?? null, body: "kept" });
    await acquireLock(thread.id, "agent");

    const { result } = await bulk({
      ids: [thread.id, parent?.id ?? ""],
      action: { action: "delete" },
    });

    expect(result.changed).toEqual([parent?.id]);
    expect(result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
      [thread.id, "locked"],
    ]);
    expect(result.orphanedThreadIds).toEqual([thread.id]);
    expect(ws.exists(`data/threads/${thread.id}.md`)).toBe(true);
  });

  it("archives a skill by moving its folder, not by flipping `status`", async () => {
    const { outer } = seedSkills();

    const archived = await bulk({ ids: [outer], action: { action: "archive" } });

    expect(archived.result.changed).toEqual([outer]);
    // SPEC.md §7: what *disables* a skill is where its folder lives. A bulk
    // branch that wrote `status: archived` and nothing else would satisfy every
    // other assertion in this suite and leave the skill enabled — which is the
    // whole reason `planSetArchived` is extracted rather than reimplemented.
    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo/reference.md")).toBe(true);
    expect(ws.exists(".claude/skills/demo")).toBe(false);
    expect(pathOf(outer)).toBe(".claude/skills-archived/demo/SKILL.md");
    // The id survives the move because the act stamps it into the file — a
    // synthesized id is a function of the path (§7).
    expect(ws.read(".claude/skills-archived/demo/SKILL.md")).toContain(`id: ${outer}`);
    expect(filesIn(archived.result.commit ?? "")).toContain(
      ".claude/skills-archived/demo/SKILL.md",
    );

    const restored = await bulk({ ids: [outer], action: { action: "unarchive" } });

    expect(restored.result.changed).toEqual([outer]);
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo")).toBe(false);
    expect(pathOf(outer)).toBe(".claude/skills/demo/SKILL.md");
  });

  it("carries a nested skill the act never named, and names it in none of the three parts", async () => {
    // The second of the two documented exceptions to "every file in the commit
    // names a `changed` document" (the first being §6's cascade parent).
    // `skillDocumentsUnder` supports a skill folder that nests another skill, and
    // archiving the outer one relocates — and therefore disables — the inner one.
    const { outer, nested } = seedSkills();

    const { result } = await bulk({ ids: [outer], action: { action: "archive" } });

    // The act moved it, in this commit, and the move disabled it: the
    // `skills-archived` root is what `status: archived` means for a skill.
    const files = filesIn(result.commit ?? "");
    expect(files).toContain(".claude/skills/demo/nested/SKILL.md");
    expect(files).toContain(".claude/skills-archived/demo/nested/SKILL.md");
    expect(ws.exists(".claude/skills/demo/nested/SKILL.md")).toBe(false);
    expect(statusAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe("archived");

    // And the three parts name it nowhere, under either id it has held — they
    // partition the **requested** ids, and it was never among them.
    const named = [
      ...result.changed,
      ...result.alreadyInState,
      ...result.refused.map((entry) => entry.id),
    ];
    expect(named).toEqual([outer]);
    expect(named).not.toContain(nested);
    expect(named).not.toContain(idAt(".claude/skills-archived/demo/nested/SKILL.md"));
  });

  it("cascades two threads of one parent into one rewrite of that parent", async () => {
    const [parent] = await seed(1);
    const parentPath = parent?.path ?? "";
    const first = await createThread(ws, {
      parent: parent?.id ?? null,
      selector: { exact: "Note", prefix: "", suffix: " 0" },
      body: "one",
    });
    const second = await createThread(ws, {
      parent: parent?.id ?? null,
      selector: { exact: "0", prefix: "Note ", suffix: "" },
      body: "two",
    });
    expect(anchorCountOf(parentPath)).toBe(2);

    const { result } = await bulk({ ids: [first.id, second.id], action: { action: "delete" } });

    expect(result.changed).toEqual([first.id, second.id]);
    // The parent is a §6 cascade, not a document the act acted on: it stays out
    // of `changed` (which partitions the *requested* ids) and travels in the
    // same commit, once, with both entries gone — the second plan read the file
    // the first one wrote.
    expect(result.changed).not.toContain(parent?.id);
    expect(filesIn(result.commit ?? "")).toEqual(
      [`data/threads/${first.id}.md`, `data/threads/${second.id}.md`, parentPath].sort(),
    );
    expect(anchorCountOf(parentPath)).toBe(0);
    expect(ws.exists(parentPath)).toBe(true);
  });

  it("refuses a bulk delete by the agent for the whole request, before any write", async () => {
    const docs = await seed(3);
    const head = ws.head();

    const { status, result } = await bulk(
      { ids: docs.map((doc) => doc.id), action: { action: "delete" } },
      asAgent,
    );

    expect(status).toBe(403);
    expect((result as unknown as { code: string }).code).toBe("forbidden");
    // Nothing read, nothing written, nothing committed (§9.2).
    expect(ws.head()).toBe(head);
    for (const doc of docs) expect(ws.exists(doc.path)).toBe(true);
  });
});

describe("per-document outcomes", () => {
  it("reports an unknown id as `not-found` and applies the rest", async () => {
    const docs = await seed(2);
    const { status, result } = await bulk({
      ids: [docs[0]?.id ?? "", "doc_deadbeef", docs[1]?.id ?? ""],
      action: { action: "archive" },
    });

    // Not a 404 for the request: the other documents are not the caller's
    // mistake (§11).
    expect(status).toBe(200);
    expect(result.changed).toEqual([docs[0]?.id, docs[1]?.id]);
    expect(result.refused).toEqual([
      {
        id: "doc_deadbeef",
        reason: "not-found",
        message: "no document with id doc_deadbeef",
        lock: null,
      },
    ]);
    expect(filesIn(result.commit ?? "")).toEqual(docs.map((doc) => doc.path).sort());
  });

  it("partitions the request: every id appears exactly once", async () => {
    const docs = await seed(3);
    await ws.post(`/api/docs/${docs[1]?.id ?? ""}/archive`, {});
    await acquireLock(docs[2]?.id ?? "", "agent");

    const ids = docs.map((doc) => doc.id);
    const { result } = await bulk({ ids, action: { action: "archive" } });

    const named = [
      ...result.changed,
      ...result.alreadyInState,
      ...result.refused.map((entry) => entry.id),
    ];
    expect(named.sort()).toEqual([...ids].sort());
  });

  it("collapses an id repeated inside one request", async () => {
    const [doc] = await seed(1);
    const id = doc?.id ?? "";
    const { result } = await bulk({ ids: [id, id, id], action: { action: "archive" } });

    expect(result.changed).toEqual([id]);
    expect(filesIn(result.commit ?? "")).toEqual([doc?.path]);
  });

  it("refuses an empty selection", async () => {
    const { status } = await bulk({ ids: [], action: { action: "archive" } });
    expect(status).toBe(400);
  });

  it("reports a document whose write failed, leaving nothing of it in the commit", async () => {
    const [inbox] = await seed(1);
    const vault = await createDoc(ws, { type: "note", title: "Sealed", folder: "vault" });
    // The destination directory is made unwritable, so the atomic write's temp
    // file cannot be created — the one failure `write-failed` is about.
    chmodSync(join(ws.root, "data", "docs", "vault"), 0o500);
    try {
      const { status, result } = await bulk({
        ids: [inbox?.id ?? "", vault.id],
        action: { action: "tag", add: ["q3"] },
      });

      expect(status).toBe(200);
      expect(result.changed).toEqual([inbox?.id]);
      expect(result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
        [vault.id, "write-failed"],
      ]);
      // "Nothing about this document reached the commit."
      expect(filesIn(result.commit ?? "")).toEqual([inbox?.path]);
      expect(ws.read(vault.path)).not.toContain("q3");
    } finally {
      chmodSync(join(ws.root, "data", "docs", "vault"), 0o700);
    }
  });

  it("refuses a deletion whose parent is locked, and says the parent is the locked one", async () => {
    const [parent] = await seed(1);
    const parentId = parent?.id ?? "";
    const anchored = await createThread(ws, {
      parent: parentId,
      selector: { exact: "Note 0", prefix: "", suffix: "" },
      body: "about the title",
    });
    // The lock that can refuse the cascade is the one on the file being
    // rewritten — the parent's (sprint-006 Adjudication 1).
    await acquireLock(parentId, "agent");
    const head = ws.head();

    const { status, result } = await bulk({ ids: [anchored.id], action: { action: "delete" } });

    expect(status).toBe(200);
    expect(result.changed).toEqual([]);
    expect(result.commit).toBeNull();
    expect(ws.head()).toBe(head);
    expect(ws.exists(`data/threads/${anchored.id}.md`)).toBe(true);

    // The row is filed under the thread's id — the three parts partition the
    // requested ids, and the parent was not requested — but everything in it
    // that names a document names the **parent**, which is the document that is
    // locked and the lock a person has to clear. Clearing the thread's own lock
    // would change nothing.
    const refusal = result.refused[0];
    expect(refusal?.id).toBe(anchored.id);
    expect(refusal?.reason).toBe("locked");
    expect(refusal?.lock?.docId).toBe(parentId);
    expect(refusal?.lock?.holder).toBe("agent");
    expect(refusal?.message).toContain(parentId);
    expect(refusal?.message).toContain("the lock to clear is");
  });

  it("reports a filename collision as a write that could not happen", async () => {
    const first = await createDoc(ws, { type: "note", title: "Budget", folder: "inbox" });
    const second = await createDoc(ws, { type: "note", title: "Budget", folder: "plans" });

    const { result } = await bulk({
      ids: [first.id, second.id],
      action: { action: "move", folder: "finance" },
    });

    expect(result.changed).toEqual([first.id]);
    // Not `not-applicable`: that reason's published meaning is "the corpus
    // changed between selecting and acting", i.e. refresh the board — when the
    // board is perfectly current and the remedy is to rename a document.
    expect(result.refused.map((entry) => [entry.id, entry.reason, entry.lock])).toEqual([
      [second.id, "write-failed", null],
    ]);
    // And the message says which name is taken, which is what §11's third part
    // means by carrying the specifics.
    expect(result.refused[0]?.message).toContain("data/docs/finance/budget.md");
    // "Nothing about this document reached the commit."
    expect(filesIn(result.commit ?? "")).toEqual(
      [first.path, "data/docs/finance/budget.md"].sort(),
    );
    expect(ws.exists(second.path)).toBe(true);
  });

  it("reports a skill archived into an occupied folder the same way", async () => {
    const { outer } = seedSkills();
    // A folder already sitting on the archived side, so the move would merge two
    // skill folders and silently overwrite files.
    ws.write(".claude/skills-archived/demo/SKILL.md", skillSource("impostor"));
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the collision");
    const head = ws.head();

    const { result } = await bulk({ ids: [outer], action: { action: "archive" } });

    expect(result.changed).toEqual([]);
    expect(result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
      [outer, "write-failed"],
    ]);
    expect(result.refused[0]?.message).toContain(".claude/skills-archived/demo");
    expect(result.commit).toBeNull();
    expect(ws.head()).toBe(head);
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
  });
});

describe("the projection and the bus see one act", () => {
  it("re-projects every changed document and announces the keys once", async () => {
    const docs = await seed(4);
    const frames: string[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => {
      frames.push(keys.map((key) => JSON.stringify(key)));
    });

    const { result } = await bulk({
      ids: docs.map((doc) => doc.id),
      action: { action: "archive" },
    });
    unsubscribe();

    // One frame for the act, not one per document.
    expect(frames).toHaveLength(1);
    const keys = frames[0] ?? [];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('["docs"]');
    expect(keys).toContain('["tree"]');
    for (const id of result.changed) expect(keys).toContain(`["docs","${id}"]`);

    // Read-your-write: the rows are current before the response was written.
    for (const id of result.changed) {
      const row = ws.db.prepare("SELECT status FROM documents WHERE id = ?").get(id) as {
        status: string;
      };
      expect(row.status).toBe("archived");
    }
  });

  it("says nothing at all when the act changed nothing", async () => {
    const docs = await seed(1);
    await bulk({ ids: docs.map((doc) => doc.id), action: { action: "archive" } });

    const frames: unknown[] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => frames.push(keys));
    await bulk({ ids: docs.map((doc) => doc.id), action: { action: "archive" } });
    unsubscribe();

    expect(frames).toEqual([]);
  });
});

/** How many anchor entries a document's frontmatter carries, read off the file. */
const anchorCountOf = (path: string): number => (ws.read(path).match(/^ {4}exact:/gm) ?? []).length;

/** A document's `tags`, read off the file rather than the projection. */
function tagsOf(path: string): string[] {
  const block = /^tags:\s*(\[[^\]]*\]|(?:\n\s+-\s.*)+)/m.exec(ws.read(path))?.[1] ?? "[]";
  if (block.startsWith("[")) {
    return block
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter((entry) => entry !== "");
}
