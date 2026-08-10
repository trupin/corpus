// `POST /api/docs/bulk` — SPEC.md §4's "One action, one commit" and §11's
// staged set (SERVER-077, SERVER-087).
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
//
// **A mixed Save is the same act, and the "mixed staged set" suite asserts it
// the same way**: one commit whose files equal `changed`, whatever mix of verbs
// the rows carried (§4, as amended 2026-08-09). Grouping the staged set by verb
// would satisfy every *file* assertion in this file and produce one commit per
// verb, so the commit count is asserted beside the file list every time.

import { chmodSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACTOR_HEADER,
  BulkActionResultSchema,
  type BulkActionOutcome,
  type BulkActionResult,
} from "@corpus/contract";
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
 * A staged set every row of which carries the same act — the shape a
 * single-verb Save has, and what the request looked like before SHARED-032.
 * Written as a helper so the suites about *other* things stay about them; the
 * mixed sets below are spelled out row by row, because there the shape is the
 * point.
 */
const staged = (
  ids: readonly string[],
  action: Record<string, unknown>,
): Record<string, unknown> => ({
  entries: ids.map((id) => ({ id, action })),
});

/** The documents an outcome list names, in the order the act answered in. */
const idsOf = (outcomes: readonly BulkActionOutcome[]): string[] =>
  outcomes.map((outcome) => outcome.id);

/** Each outcome as the pair §11's report is made of: the document and its verb. */
const pairsOf = (outcomes: readonly BulkActionOutcome[]): [string, string][] =>
  outcomes.map((outcome) => [outcome.id, outcome.action]);

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
    const { status, result } = await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );

    // A locked document is a per-document outcome, never a verdict on the
    // request (§11): seventeen still archive.
    expect(status).toBe(200);
    expect(idsOf(result.changed)).toHaveLength(17);
    // Every outcome names what was done to it — carried per document because a
    // Save carries a mix, so no report has to be paired back to its request.
    expect(new Set(result.changed.map((outcome) => outcome.action))).toEqual(new Set(["archive"]));
    expect(idsOf(result.alreadyInState)).toEqual([]);
    expect(
      result.refused.map((entry) => [entry.id, entry.action, entry.reason, entry.lock?.holder]),
    ).toEqual(locked.map((doc) => [doc.id, "archive", "locked", "agent"]));

    // One commit. Not seventeen.
    expect(ws.log("%H")).toHaveLength(commitsBefore + 1);
    expect(result.commit).toBe(ws.head());

    // The assertion the route exists for, read from git rather than from the
    // server: every document `changed` names has its file here. Asserted as an
    // equality because this particular act can produce nothing else — plain
    // notes, no §6 cascade, no §7 folder move.
    expect(filesIn(result.commit ?? "")).toEqual(idsOf(result.changed).map(pathOf).sort());

    // And the three refused documents left nothing in it — `git log` never
    // records an effect the caller was told did not happen.
    for (const doc of locked) {
      expect(filesIn(result.commit ?? "")).not.toContain(doc.path);
      expect(ws.read(doc.path)).not.toContain("status: archived");
    }
    for (const { id } of result.changed) {
      expect(ws.read(pathOf(id))).toContain("status: archived");
    }
  });

  it("names the action and every document it changed in the commit message", async () => {
    const docs = await seed(3);
    const { result } = await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );

    expect(ws.git("log", "-1", "--format=%s").trim()).toBe("bulk archive: 3 documents by user");
    const body = ws.git("log", "-1", "--format=%b");
    for (const { id } of result.changed) expect(body).toContain(`Corpus-Doc: ${id}`);
    expect(body).toContain("Corpus-Actor: user");
    // Authored by the acting party like any other mutation (§4).
    expect(ws.git("log", "-1", "--format=%an").trim()).toBe("user");
  });

  it("makes no commit at all when the act changes nothing", async () => {
    const docs = await seed(2);
    await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );

    const head = ws.head();
    const commits = ws.log("%H").length;
    const { result } = await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );

    expect(idsOf(result.changed)).toEqual([]);
    expect(idsOf(result.alreadyInState)).toEqual(docs.map((doc) => doc.id));
    expect(result.commit).toBeNull();
    // No empty commit object: the history did not move.
    expect(ws.head()).toBe(head);
    expect(ws.log("%H")).toHaveLength(commits);
    expect(ws.git("status", "--porcelain").trim()).toBe("");
  });

  it("counts a document already in the requested state out of the commit", async () => {
    const [open, archived] = await seed(2);
    await ws.post(`/api/docs/${archived?.id ?? ""}/archive`, {});

    const { result } = await bulk(
      staged([open?.id ?? "", archived?.id ?? ""], { action: "archive" }),
    );

    expect(idsOf(result.changed)).toEqual([open?.id]);
    expect(idsOf(result.alreadyInState)).toEqual([archived?.id]);
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
    const { result } = await bulk(staged([id], { action: "archive" }));

    expect(result.commit).not.toBe(sessionCommit);
    expect(ws.log("%H")).toHaveLength(commits + 1);
    expect(ws.git("rev-parse", "HEAD^").trim()).toBe(sessionCommit);
    // The session's own commit still says what it said.
    expect(ws.git("log", "-1", "--format=%s", sessionCommit).trim()).toContain("doc edit:");
  });

  it("takes no later save into itself", async () => {
    const [doc] = await seed(1);
    const id = doc?.id ?? "";

    const { result } = await bulk(staged([id], { action: "tag", add: ["q3"] }));
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
    const archived = await bulk(staged(ids, { action: "archive" }));
    expect(idsOf(archived.result.changed)).toEqual(ids);

    const restored = await bulk(staged(ids, { action: "unarchive" }));
    expect(idsOf(restored.result.changed)).toEqual(ids);
    expect(filesIn(restored.result.commit ?? "")).toEqual(docs.map((doc) => doc.path).sort());
    for (const doc of docs) expect(ws.read(doc.path)).toContain("status: open");
  });

  it("resolves and reopens threads, and refuses a document that is not one", async () => {
    const [parent] = await seed(1);
    const first = await createThread(ws, { parent: parent?.id ?? null, body: "one" });
    const second = await createThread(ws, { parent: parent?.id ?? null, body: "two" });

    const resolved = await bulk(
      staged([first.id, second.id, parent?.id ?? ""], { action: "resolve" }),
    );
    expect(idsOf(resolved.result.changed)).toEqual([first.id, second.id]);
    expect(resolved.result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
      [parent?.id, "not-applicable"],
    ]);
    expect(filesIn(resolved.result.commit ?? "")).toEqual(
      [`data/threads/${first.id}.md`, `data/threads/${second.id}.md`].sort(),
    );
    expect(ws.read(`data/threads/${first.id}.md`)).toContain("status: resolved");

    const reopened = await bulk(staged([first.id, second.id], { action: "reopen" }));
    expect(idsOf(reopened.result.changed)).toEqual([first.id, second.id]);
    expect(ws.read(`data/threads/${second.id}.md`)).toContain("status: open");
  });

  it("moves a whole selection into one folder", async () => {
    const docs = await seed(3);
    const { result } = await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "move", folder: "finance" },
      ),
    );

    expect(idsOf(result.changed)).toEqual(docs.map((doc) => doc.id));
    for (const doc of docs) expect(pathOf(doc.id)).toMatch(/^data\/docs\/finance\//);
    // One commit carrying both sides of every rename.
    expect(filesIn(result.commit ?? "")).toEqual(
      [...docs.map((doc) => doc.path), ...docs.map((doc) => pathOf(doc.id))].sort(),
    );
    // Ids never change, so nothing that referenced them had to be rewritten.
    expect(idsOf(result.changed)).toEqual(docs.map((doc) => doc.id));
  });

  it("refuses a folder that names nothing for the whole request, before any write", async () => {
    const docs = await seed(2);
    const head = ws.head();
    const { status } = await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "move", folder: "../escape" },
      ),
    );
    expect(status).toBe(400);
    expect(ws.head()).toBe(head);
  });

  it("tags as a delta — adding and removing, never replacing", async () => {
    const first = await createDoc(ws, { type: "note", title: "A", tags: ["keep", "drop"] });
    const second = await createDoc(ws, { type: "note", title: "B", tags: ["keep"] });
    const third = await createDoc(ws, { type: "note", title: "C", tags: ["other"] });

    const { result } = await bulk(
      staged([first.id, second.id, third.id], { action: "tag", add: ["q3"], remove: ["drop"] }),
    );

    expect(idsOf(result.changed)).toEqual([first.id, second.id, third.id]);
    // Each document keeps its own set; only the named tags moved.
    expect(ws.read(first.path)).toContain("tags:");
    expect(tagsOf(first.path)).toEqual(["keep", "q3"]);
    expect(tagsOf(second.path)).toEqual(["keep", "q3"]);
    expect(tagsOf(third.path)).toEqual(["other", "q3"]);

    // Adding a tag a document already carries is a no-op for it, not a failure.
    const again = await bulk(staged([first.id, second.id], { action: "tag", add: ["q3"] }));
    expect(idsOf(again.result.changed)).toEqual([]);
    expect(idsOf(again.result.alreadyInState)).toEqual([first.id, second.id]);
    expect(again.result.commit).toBeNull();
  });

  it("records review as a committed act that is not an edit", async () => {
    const [doc] = await seed(1);
    const path = doc?.path ?? "";
    const updatedBefore = /^updated: (.+)$/m.exec(ws.read(path))?.[1];

    ws.advance(60_000);
    const { result } = await bulk(staged([doc?.id ?? ""], { action: "review" }));

    expect(idsOf(result.changed)).toEqual([doc?.id]);
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

    const { result } = await bulk(staged([anchored.id, parent?.id ?? ""], { action: "delete" }));

    expect(idsOf(result.changed)).toEqual([anchored.id, parent?.id]);
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
    expect(idsOf(result.changed)).toContain(anchored.id);
    expect(ws.exists(`data/threads/${standalone.id}.md`)).toBe(true);
  });

  it("still reports a thread whose own deletion was refused as a surviving orphan", async () => {
    // The other half of the filter: only a thread this act actually deleted
    // stops being an orphan. One that was refused did survive.
    const [parent] = await seed(1);
    const thread = await createThread(ws, { parent: parent?.id ?? null, body: "kept" });
    await acquireLock(thread.id, "agent");

    const { result } = await bulk(staged([thread.id, parent?.id ?? ""], { action: "delete" }));

    expect(idsOf(result.changed)).toEqual([parent?.id]);
    expect(result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
      [thread.id, "locked"],
    ]);
    expect(result.orphanedThreadIds).toEqual([thread.id]);
    expect(ws.exists(`data/threads/${thread.id}.md`)).toBe(true);
  });

  it("archives a skill by moving its folder, not by flipping `status`", async () => {
    const { outer } = seedSkills();

    const archived = await bulk(staged([outer], { action: "archive" }));

    expect(idsOf(archived.result.changed)).toEqual([outer]);
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

    const restored = await bulk(staged([outer], { action: "unarchive" }));

    expect(idsOf(restored.result.changed)).toEqual([outer]);
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

    const { result } = await bulk(staged([outer], { action: "archive" }));

    // The act moved it, in this commit, and the move disabled it: the
    // `skills-archived` root is what `status: archived` means for a skill.
    const files = filesIn(result.commit ?? "");
    expect(files).toContain(".claude/skills/demo/nested/SKILL.md");
    expect(files).toContain(".claude/skills-archived/demo/nested/SKILL.md");
    expect(ws.exists(".claude/skills/demo/nested/SKILL.md")).toBe(false);
    expect(statusAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe("archived");

    // Its id came through the move: the act stamps the id of every document it
    // carries, not only the one it was asked about (SERVER-078, SPEC.md §5).
    expect(idAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe(nested);

    // And the three parts name it nowhere — they partition the **requested**
    // ids, and it was never among them. That the file it wrote is in the commit
    // changes nothing about the partition: the file was already there, carried
    // by the move, which is the exception this test exists to pin.
    const named = [
      ...idsOf(result.changed),
      ...result.alreadyInState,
      ...result.refused.map((entry) => entry.id),
    ];
    expect(named).toEqual([outer]);
    expect(named).not.toContain(nested);
  });

  // CONTRACT-047 / SERVER-088: the same planners, so the same report. What the
  // bulk act adds is the exclusion — a carried document whose **own** archive or
  // unarchive landed in the same act is answered for by that `changed` entry,
  // and the entry says the folder moved.
  it("names a carried skill in warnings, and drops the name once its own row moves it", async () => {
    const { outer, nested } = seedSkills();

    const archived = await bulk(staged([outer], { action: "archive" }));

    expect(archived.result.warnings.map((warning) => warning.code)).toEqual(["carried_skill"]);
    expect(archived.result.warnings[0]?.detail).toBe(
      `${nested} (.claude/skills-archived/demo/nested/SKILL.md) was carried by this skill ` +
        `folder move and is now disabled; this act did not archive it in its own right ` +
        `(SPEC.md §7)`,
    );
    // Still not a fourth part of the result (PR #37): the three parts partition
    // the requested ids, and the warning is a report *about* the act.
    expect(idsOf(archived.result.changed)).toEqual([outer]);

    ws.advance(60_000);
    const restored = await bulk(staged([outer, nested], { action: "unarchive" }));

    // The move carried it exactly as before — and its own `unarchive` landed, so
    // `changed` already says it is enabled and there is nothing left to warn
    // about.
    expect(restored.result.warnings).toEqual([]);
    expect(pairsOf(restored.result.changed)).toEqual([
      [outer, "unarchive"],
      [nested, "unarchive"],
    ]);
    expect(pathOf(nested)).toBe(".claude/skills/demo/nested/SKILL.md");
  });

  /**
   * PR #41. **Being named is not being told.** The exclusion is not "the ids the
   * request named" — that premise only holds for a row that lands in `changed`
   * carrying the very verb that moved the folder. Each row below is answered
   * for in the result, and not one of those answers says the act disabled the
   * skill; the previous rule made all three silent.
   *
   * Driven through the real route, so the fix has to be in the act rather than
   * in whatever a unit call to `carriedWarnings` is handed.
   */
  describe("a named row that does not explain the move is still owed the warning", () => {
    const carriedDetail = (nested: string): string =>
      `${nested} (.claude/skills-archived/demo/nested/SKILL.md) was carried by this skill ` +
      `folder move and is now disabled; this act did not archive it in its own right ` +
      `(SPEC.md §7)`;

    it("warns about a carried skill whose own row was refused", async () => {
      const { outer, nested } = seedSkills();

      const { result } = await bulk({
        entries: [
          { id: outer, action: { action: "archive" } },
          { id: nested, action: { action: "resolve" } },
        ],
      });

      expect(pairsOf(result.changed)).toEqual([[outer, "archive"]]);
      expect(result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
        [nested, "not-applicable"],
      ]);
      // The commit moved its file, so §7 disabled it — while the only thing the
      // result says about it is that `resolve` does not apply to a skill.
      expect(filesIn(result.commit ?? "")).toContain(
        ".claude/skills-archived/demo/nested/SKILL.md",
      );
      expect(pathOf(nested)).toBe(".claude/skills-archived/demo/nested/SKILL.md");
      expect(result.warnings.map((warning) => warning.code)).toEqual(["carried_skill"]);
      expect(result.warnings[0]?.detail).toBe(carriedDetail(nested));
    });

    it("warns about a carried skill whose own row was already in the state it asked for", async () => {
      const { outer, nested } = seedSkills();
      // One unarchive of the already-enabled nested skill writes `status: open`
      // and its id into the file — which is what makes the identical row below a
      // genuine no-op rather than a write.
      expect(idsOf((await bulk(staged([nested], { action: "unarchive" }))).result.changed)).toEqual(
        [nested],
      );
      ws.advance(60_000);

      const { result } = await bulk({
        entries: [
          { id: nested, action: { action: "unarchive" } },
          { id: outer, action: { action: "archive" } },
        ],
      });

      // The response says, in as many words, that the nested skill is already
      // enabled — and the act it is reporting turned it off.
      expect(result.alreadyInState).toEqual([{ id: nested, action: "unarchive" }]);
      expect(pairsOf(result.changed)).toEqual([[outer, "archive"]]);
      expect(pathOf(nested)).toBe(".claude/skills-archived/demo/nested/SKILL.md");
      expect(result.warnings.map((warning) => warning.code)).toEqual(["carried_skill"]);
      expect(result.warnings[0]?.detail).toBe(carriedDetail(nested));
    });

    it("warns about a carried skill answered for under a different verb", async () => {
      const { outer, nested } = seedSkills();

      const { result } = await bulk({
        entries: [
          { id: outer, action: { action: "archive" } },
          { id: nested, action: { action: "tag", add: ["reference"] } },
        ],
      });

      // A `changed` entry, and the letter of the old rule was satisfied by it —
      // but `tag` is not what moved the folder, so nothing here explains the
      // document being disabled.
      expect(pairsOf(result.changed)).toEqual([
        [outer, "archive"],
        [nested, "tag"],
      ]);
      expect(pathOf(nested)).toBe(".claude/skills-archived/demo/nested/SKILL.md");
      expect(result.warnings.map((warning) => warning.code)).toEqual(["carried_skill"]);
      expect(result.warnings[0]?.detail).toBe(carriedDetail(nested));
    });
  });

  it("reports the reconciliation an unarchive performed on a carried skill", async () => {
    const { outer, nested } = seedSkills();

    // Archived on its own, which writes `status: archived` into its file, then
    // the outer skill archived and unarchived over the top of it.
    expect((await bulk(staged([nested], { action: "archive" }))).result.warnings).toEqual([]);
    ws.advance(60_000);
    expect((await bulk(staged([outer], { action: "archive" }))).result.warnings).toEqual([]);
    ws.advance(60_000);

    const { result } = await bulk(staged([outer], { action: "unarchive" }));

    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "carried_skill",
      "carried_reconciliation",
    ]);
    expect(result.warnings[1]?.detail).toBe(
      `${nested} (.claude/skills/demo/nested/SKILL.md) still said \`status: archived\` under ` +
        `the enabled skills root, so its status was reconciled to \`open\``,
    );
    expect(statusAt(".claude/skills/demo/nested/SKILL.md")).toBe("open");
    expect(idsOf(result.changed)).toEqual([outer]);
  });

  it("says nothing about carried documents when no skill folder moved", async () => {
    // The silence that keeps the channel worth reading: an ordinary act carries
    // nothing, so it says nothing.
    const docs = await seed(2);

    const { result } = await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );

    expect(result.warnings).toEqual([]);
    expect(idsOf(result.changed)).toEqual(docs.map((doc) => doc.id));
  });

  it("archives an outer skill and the nested one it carries, in either order", async () => {
    // Both halves of SERVER-078's order dependence, on the route that made it
    // visible. Naming the outer one first used to refuse the nested one
    // `not-found` — a document whose file was moved, and thereby disabled, in
    // the very commit the caller was told did not touch it. Naming the nested
    // one first used to wedge the outer one out of ever being archived again.
    for (const order of ["outer-first", "nested-first"] as const) {
      const { outer, nested } = seedSkills();
      const ids = order === "outer-first" ? [outer, nested] : [nested, outer];

      const { result } = await bulk(staged(ids, { action: "archive" }));

      expect(result.refused).toEqual([]);
      expect(idsOf(result.changed)).toEqual(ids);
      expect(pathOf(outer)).toBe(".claude/skills-archived/demo/SKILL.md");
      expect(pathOf(nested)).toBe(".claude/skills-archived/demo/nested/SKILL.md");
      expect(ws.exists(".claude/skills/demo")).toBe(false);

      // Everything `changed` names has a file in the one commit — the invariant
      // this suite is about — including the nested skill, now that the act can
      // find it.
      const files = filesIn(result.commit ?? "");
      for (const { id } of result.changed) expect(files).toContain(pathOf(id));

      ws.advance(60_000);
      await bulk(staged([outer, nested], { action: "unarchive" }));
      ws.advance(60_000);
    }
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

    const { result } = await bulk(staged([first.id, second.id], { action: "delete" }));

    expect(idsOf(result.changed)).toEqual([first.id, second.id]);
    // The parent is a §6 cascade, not a document the act acted on: it stays out
    // of `changed` (which partitions the *requested* ids) and travels in the
    // same commit, once, with both entries gone — the second plan read the file
    // the first one wrote.
    expect(idsOf(result.changed)).not.toContain(parent?.id);
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
      staged(
        docs.map((doc) => doc.id),
        { action: "delete" },
      ),
      asAgent,
    );

    expect(status).toBe(403);
    expect((result as unknown as { code: string }).code).toBe("forbidden");
    // Nothing read, nothing written, nothing committed (§9.2).
    expect(ws.head()).toBe(head);
    for (const doc of docs) expect(ws.exists(doc.path)).toBe(true);
  });
});

describe("a mixed staged set is one act (SPEC.md §4, SHARED-032)", () => {
  it("archives three and resolves two in one commit whose files are exactly `changed`", async () => {
    const docs = await seed(3);
    const first = await createThread(ws, { parent: null, body: "one" });
    const second = await createThread(ws, { parent: null, body: "two" });
    const commitsBefore = ws.log("%H").length;

    const { status, result } = await bulk({
      entries: [
        ...docs.map((doc) => ({ id: doc.id, action: { action: "archive" } })),
        { id: first.id, action: { action: "resolve" } },
        { id: second.id, action: { action: "resolve" } },
      ],
    });

    expect(status).toBe(200);
    // Each row answered with **its own** verb — the report reads on its own.
    expect(pairsOf(result.changed)).toEqual([
      ...docs.map((doc) => [doc.id, "archive"]),
      [first.id, "resolve"],
      [second.id, "resolve"],
    ]);
    expect(result.refused).toEqual([]);

    // **One** commit for the act, not one per verb — the whole of §4's
    // amendment. A server that grouped by verb would write the same five files
    // and land two commits here.
    expect(ws.log("%H")).toHaveLength(commitsBefore + 1);
    expect(result.commit).toBe(ws.head());
    expect(filesIn(result.commit ?? "")).toEqual(idsOf(result.changed).map(pathOf).sort());

    // And both verbs actually happened, read off the files.
    for (const doc of docs) expect(ws.read(pathOf(doc.id))).toContain("status: archived");
    expect(ws.read(`data/threads/${first.id}.md`)).toContain("status: resolved");
    expect(ws.read(`data/threads/${second.id}.md`)).toContain("status: resolved");
  });

  it("names every verb it carried, with a count each, in the one commit subject", async () => {
    const docs = await seed(3);
    const thread = await createThread(ws, { parent: null, body: "one" });

    const { result } = await bulk({
      entries: [
        { id: docs[0]?.id ?? "", action: { action: "archive" } },
        { id: thread.id, action: { action: "resolve" } },
        { id: docs[1]?.id ?? "", action: { action: "tag", add: ["q3"] } },
        { id: docs[2]?.id ?? "", action: { action: "archive" } },
      ],
    });

    // Verbs in the contract's own order, not the rows' — two Saves carrying the
    // same mix produce the same subject, so the history stays diffable.
    expect(ws.git("log", "-1", "--format=%s").trim()).toBe(
      "bulk archive 2, resolve 1, tag 1: 4 documents by user",
    );
    const body = ws.git("log", "-1", "--format=%b");
    for (const { id } of result.changed) expect(body).toContain(`Corpus-Doc: ${id}`);
  });

  it("keeps a lock and an unknown id per-document while the other verbs go through", async () => {
    const docs = await seed(3);
    const thread = await createThread(ws, { parent: null, body: "one" });
    await acquireLock(docs[1]?.id ?? "", "agent");

    const { status, result } = await bulk({
      entries: [
        { id: docs[0]?.id ?? "", action: { action: "archive" } },
        { id: docs[1]?.id ?? "", action: { action: "tag", add: ["q3"] } },
        { id: "doc_deadbeef", action: { action: "resolve" } },
        { id: thread.id, action: { action: "resolve" } },
        { id: docs[2]?.id ?? "", action: { action: "review" } },
      ],
    });

    // §11: never refuse the whole set because of one document — and every
    // refusal says which act it was refusing, which is the only way a mixed
    // report can be read without the request beside it.
    expect(status).toBe(200);
    expect(pairsOf(result.changed)).toEqual([
      [docs[0]?.id, "archive"],
      [thread.id, "resolve"],
      [docs[2]?.id, "review"],
    ]);
    expect(result.refused.map((entry) => [entry.id, entry.action, entry.reason])).toEqual([
      [docs[1]?.id, "tag", "locked"],
      ["doc_deadbeef", "resolve", "not-found"],
    ]);
    expect(result.refused[0]?.lock?.holder).toBe("agent");
    // The refused rows left nothing in the commit.
    expect(filesIn(result.commit ?? "")).toEqual(idsOf(result.changed).map(pathOf).sort());
    expect(ws.read(docs[1]?.path ?? "")).not.toContain("q3");
  });

  it("refuses the whole Save when the agent stages a delete on one row of five", async () => {
    // A staged set is not a way to smuggle a delete past §9.2: the refusal is
    // the request's, and the other four rows are not applied "as far as they
    // could be".
    const docs = await seed(4);
    const doomed = await seed(1, "Doomed");
    const head = ws.head();

    const { status, result } = await bulk(
      {
        entries: [
          { id: docs[0]?.id ?? "", action: { action: "archive" } },
          { id: docs[1]?.id ?? "", action: { action: "tag", add: ["q3"] } },
          { id: doomed[0]?.id ?? "", action: { action: "delete" } },
          { id: docs[2]?.id ?? "", action: { action: "review" } },
          { id: docs[3]?.id ?? "", action: { action: "archive" } },
        ],
      },
      asAgent,
    );

    expect(status).toBe(403);
    expect((result as unknown as { code: string }).code).toBe("forbidden");
    expect(ws.head()).toBe(head);
    for (const doc of [...docs, ...doomed]) {
      expect(ws.exists(doc.path)).toBe(true);
      expect(ws.read(doc.path)).not.toContain("status: archived");
      expect(ws.read(doc.path)).not.toContain("q3");
    }
  });

  it("holds the lanes of both planners' carried documents in one act", async () => {
    // A mixed set touches more planners, so the lane union is larger rather
    // than different in kind: §7's folder move reaches a nested skill, §6's
    // cascade reaches a deleted thread's parent, and both land in this one
    // commit beside the rows that asked for them.
    const { outer, nested } = seedSkills();
    const [parent] = await seed(1);
    const parentPath = parent?.path ?? "";
    const anchored = await createThread(ws, {
      parent: parent?.id ?? null,
      selector: { exact: "Note 0", prefix: "", suffix: "" },
      body: "about the title",
    });
    expect(anchorCountOf(parentPath)).toBe(1);
    const commitsBefore = ws.log("%H").length;

    const { result } = await bulk({
      entries: [
        { id: outer, action: { action: "archive" } },
        { id: anchored.id, action: { action: "delete" } },
      ],
    });

    expect(pairsOf(result.changed)).toEqual([
      [outer, "archive"],
      [anchored.id, "delete"],
    ]);
    expect(ws.log("%H")).toHaveLength(commitsBefore + 1);

    const files = filesIn(result.commit ?? "");
    // The two rows themselves…
    expect(files).toContain(".claude/skills-archived/demo/SKILL.md");
    expect(files).toContain(`data/threads/${anchored.id}.md`);
    // …and the two documents the planners reached without being asked: the
    // nested skill the folder move disabled, and the cascade parent.
    expect(files).toContain(".claude/skills-archived/demo/nested/SKILL.md");
    expect(files).toContain(parentPath);
    expect(idAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe(nested);
    expect(anchorCountOf(parentPath)).toBe(0);

    // Neither carried document is in any of the three parts: they partition the
    // requested ids, and neither was requested.
    const named = [
      ...idsOf(result.changed),
      ...idsOf(result.alreadyInState),
      ...result.refused.map((entry) => entry.id),
    ];
    expect(named).toEqual([outer, anchored.id]);
  });

  it("re-measures the tree when any one row could have moved it", async () => {
    // `TREE_MOVING_ACTIONS` is asked **per row** (SERVER-087). The tree-moving
    // row is deliberately last: an implementation that asked the request, or
    // the first row, would answer `tag` and leave the folder badge stale.
    const [tagged, moved] = await seed(2);
    const frames: string[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => {
      frames.push(keys.map((key) => JSON.stringify(key)));
    });

    const { result } = await bulk({
      entries: [
        { id: tagged?.id ?? "", action: { action: "tag", add: ["q3"] } },
        { id: moved?.id ?? "", action: { action: "move", folder: "finance" } },
      ],
    });
    unsubscribe();

    expect(idsOf(result.changed)).toEqual([tagged?.id, moved?.id]);
    expect(frames).toHaveLength(1);
    const keys = frames[0] ?? [];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('["tree"]');
    expect(pathOf(moved?.id ?? "")).toMatch(/^data\/docs\/finance\//);
  });

  it("says nothing about the tree when no row could have moved it", async () => {
    // The other half: measuring is gated, and a Save of tags and reviews must
    // not announce a key nothing changed (SERVER-018's invariant, per row).
    const [tagged, reviewed] = await seed(2);
    const frames: string[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => {
      frames.push(keys.map((key) => JSON.stringify(key)));
    });

    await bulk({
      entries: [
        { id: tagged?.id ?? "", action: { action: "tag", add: ["q3"] } },
        { id: reviewed?.id ?? "", action: { action: "review" } },
      ],
    });
    unsubscribe();

    expect(frames).toHaveLength(1);
    expect(frames[0] ?? []).not.toContain('["tree"]');
  });

  it("sends two rows to two different folders in one act", async () => {
    const docs = await seed(2);

    const { result } = await bulk({
      entries: [
        { id: docs[0]?.id ?? "", action: { action: "move", folder: "finance" } },
        { id: docs[1]?.id ?? "", action: { action: "move", folder: "housing" } },
      ],
    });

    expect(idsOf(result.changed)).toEqual(docs.map((doc) => doc.id));
    expect(pathOf(docs[0]?.id ?? "")).toMatch(/^data\/docs\/finance\//);
    expect(pathOf(docs[1]?.id ?? "")).toMatch(/^data\/docs\/housing\//);
    expect(filesIn(result.commit ?? "")).toEqual(
      [...docs.map((doc) => doc.path), ...docs.map((doc) => pathOf(doc.id))].sort(),
    );
  });

  it("refuses a folder that names nothing for the whole request, even beside good rows", async () => {
    const docs = await seed(2);
    const head = ws.head();

    const { status } = await bulk({
      entries: [
        { id: docs[0]?.id ?? "", action: { action: "archive" } },
        { id: docs[1]?.id ?? "", action: { action: "move", folder: "../escape" } },
      ],
    });

    // A folder that could never be written to is the request's fault, not one
    // document's — and it is refused before anything is written.
    expect(status).toBe(400);
    expect(ws.head()).toBe(head);
    expect(ws.read(docs[0]?.path ?? "")).not.toContain("status: archived");
  });
});

describe("per-document outcomes", () => {
  it("reports an unknown id as `not-found` and applies the rest", async () => {
    const docs = await seed(2);
    const { status, result } = await bulk(
      staged([docs[0]?.id ?? "", "doc_deadbeef", docs[1]?.id ?? ""], { action: "archive" }),
    );

    // Not a 404 for the request: the other documents are not the caller's
    // mistake (§11).
    expect(status).toBe(200);
    expect(idsOf(result.changed)).toEqual([docs[0]?.id, docs[1]?.id]);
    expect(result.refused).toEqual([
      {
        id: "doc_deadbeef",
        action: "archive",
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
    const { result } = await bulk(staged(ids, { action: "archive" }));

    const named = [
      ...idsOf(result.changed),
      ...idsOf(result.alreadyInState),
      ...result.refused.map((entry) => entry.id),
    ];
    expect(named.sort()).toEqual([...ids].sort());
  });

  it("refuses an id staged twice for the whole request, before any write", async () => {
    // CONTRACT-048 tightened this deliberately: an `ids` **set** carried no
    // information in a repeat, but a staged **row** carries a verb that may
    // contradict its twin, so last-write-wins would be a silent choice about
    // someone's documents. Refused by the contract's own validator, which is
    // why nothing in `bulk.ts` re-derives it.
    const [doc] = await seed(1);
    const id = doc?.id ?? "";
    const head = ws.head();

    const same = await bulk(staged([id, id], { action: "archive" }));
    expect(same.status).toBe(400);

    const different = await bulk({
      entries: [
        { id, action: { action: "archive" } },
        { id, action: { action: "review" } },
      ],
    });
    expect(different.status).toBe(400);

    expect(ws.head()).toBe(head);
    expect(ws.read(doc?.path ?? "")).not.toContain("status: archived");
  });

  it("refuses an empty selection", async () => {
    const { status } = await bulk(staged([], { action: "archive" }));
    expect(status).toBe(400);
  });

  it("reports a document whose write failed, leaving nothing of it in the commit", async () => {
    const [inbox] = await seed(1);
    const vault = await createDoc(ws, { type: "note", title: "Sealed", folder: "vault" });
    // The destination directory is made unwritable, so the atomic write's temp
    // file cannot be created — the one failure `write-failed` is about.
    chmodSync(join(ws.root, "data", "docs", "vault"), 0o500);
    try {
      const { status, result } = await bulk(
        staged([inbox?.id ?? "", vault.id], { action: "tag", add: ["q3"] }),
      );

      expect(status).toBe(200);
      expect(idsOf(result.changed)).toEqual([inbox?.id]);
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

    const { status, result } = await bulk(staged([anchored.id], { action: "delete" }));

    expect(status).toBe(200);
    expect(idsOf(result.changed)).toEqual([]);
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

    const { result } = await bulk(
      staged([first.id, second.id], { action: "move", folder: "finance" }),
    );

    expect(idsOf(result.changed)).toEqual([first.id]);
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

    const { result } = await bulk(staged([outer], { action: "archive" }));

    expect(idsOf(result.changed)).toEqual([]);
    expect(result.refused.map((entry) => [entry.id, entry.reason])).toEqual([
      [outer, "write-failed"],
    ]);
    expect(result.refused[0]?.message).toContain(".claude/skills-archived/demo");
    expect(result.commit).toBeNull();
    expect(ws.head()).toBe(head);
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
  });

  it("refuses a skill whose folder move would rewrite a locked nested skill", async () => {
    // The act writes a carried skill's file — it stamps the id the move would
    // otherwise re-mint — so a lease on that skill refuses this document's share
    // of the act, exactly as a cascade parent's does (PR #38, finding 3).
    const { outer, nested } = seedSkills();
    await acquireLock(nested, "agent");
    const head = ws.head();

    const { result } = await bulk(staged([outer], { action: "archive" }), {
      [ACTOR_HEADER]: "user",
    });

    expect(idsOf(result.changed)).toEqual([]);
    expect(result.refused.map((entry) => [entry.id, entry.reason])).toEqual([[outer, "locked"]]);
    // The row is filed under the requested id, and every id *in* it is the
    // locked one — the same correction SERVER-077's review made for a cascade
    // parent, now shared by both.
    expect(result.refused[0]?.message).toContain(`the lock to clear is ${nested}'s`);
    expect(result.refused[0]?.lock?.docId).toBe(nested);
    expect(result.commit).toBeNull();
    expect(ws.head()).toBe(head);
    expect(ws.exists(".claude/skills/demo/nested/SKILL.md")).toBe(true);
  });
});

describe("the projection and the bus see one act", () => {
  it("re-projects every changed document and announces the keys once", async () => {
    const docs = await seed(4);
    const frames: string[][] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => {
      frames.push(keys.map((key) => JSON.stringify(key)));
    });

    const { result } = await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );
    unsubscribe();

    // One frame for the act, not one per document.
    expect(frames).toHaveLength(1);
    const keys = frames[0] ?? [];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('["docs"]');
    expect(keys).toContain('["tree"]');
    for (const { id } of result.changed) expect(keys).toContain(`["docs","${id}"]`);

    // Read-your-write: the rows are current before the response was written.
    for (const { id } of result.changed) {
      const row = ws.db.prepare("SELECT status FROM documents WHERE id = ?").get(id) as {
        status: string;
      };
      expect(row.status).toBe("archived");
    }
  });

  it("says nothing at all when the act changed nothing", async () => {
    const docs = await seed(1);
    await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );

    const frames: unknown[] = [];
    const unsubscribe = ws.server.bus.subscribe((keys) => frames.push(keys));
    await bulk(
      staged(
        docs.map((doc) => doc.id),
        { action: "archive" },
      ),
    );
    unsubscribe();

    expect(frames).toEqual([]);
  });
});

describe("§11's whole-result-set entry", () => {
  /** Four notes tagged `finance`, and one that is not. */
  const seedTagged = async (): Promise<{ id: string; path: string }[]> => {
    const docs: { id: string; path: string }[] = [];
    for (const title of ["Q1", "Q2", "Q3", "Q4"]) {
      const created = await createDoc(ws, { type: "note", title, tags: ["finance"] });
      docs.push({ id: created.id, path: created.path });
    }
    await createDoc(ws, { type: "note", title: "Unrelated" });
    return docs;
  };

  it("acts on everything the query matches except the ids staged by hand", async () => {
    const tagged = await seedTagged();
    const byHand = tagged[0];
    const commitsBefore = ws.log("%H").length;

    const { status, result } = await bulk({
      entries: [{ id: byHand?.id ?? "", action: { action: "review" } }],
      wholeResultSet: { query: { tag: "finance" }, action: { action: "archive" } },
    });

    expect(status).toBe(200);
    // The hand-staged row keeps the verb the person chose — the exclusion is
    // what makes a precedence rule unnecessary — and the other three come back
    // named by ids that appear nowhere in the request.
    // Enumerated rows first, in request order; the query's own matches follow
    // in a stable order of their own (by id — nothing in §11 asks for more, and
    // the board renders in its column's order regardless).
    expect(pairsOf(result.changed)[0]).toEqual([byHand?.id, "review"]);
    expect(pairsOf(result.changed).slice(1).sort()).toEqual(
      tagged
        .slice(1)
        .map((doc) => [doc.id, "archive"])
        .sort(),
    );
    expect(ws.read(byHand?.path ?? "")).not.toContain("status: archived");
    expect(ws.read(byHand?.path ?? "")).toContain("reviewed:");
    for (const doc of tagged.slice(1)) {
      expect(ws.read(doc.path)).toContain("status: archived");
    }
    // Still one act: one commit, whose files are exactly `changed`.
    expect(ws.log("%H")).toHaveLength(commitsBefore + 1);
    expect(filesIn(result.commit ?? "")).toEqual(idsOf(result.changed).map(pathOf).sort());
  });

  it("re-evaluates what the query matches when the Save runs", async () => {
    // §11: "the count is re-evaluated when the Save runs … the corpus can change
    // between staging and saving". A document tagged after a board would have
    // counted is in the act; one that left the result set is not.
    const tagged = await seedTagged();
    const late = await createDoc(ws, { type: "note", title: "Late", tags: ["finance"] });
    await bulk(staged([tagged[0]?.id ?? ""], { action: "archive" }));

    const { result } = await bulk({
      entries: [],
      wholeResultSet: { query: { tag: "finance" }, action: { action: "archive" } },
    });

    // The late arrival is acted on; the one already archived left the default
    // result set entirely, so it is not even reported as already-in-state —
    // the query, not the caller, decides what the entry covers.
    expect(idsOf(result.changed)).toContain(late.id);
    expect(idsOf(result.changed)).not.toContain(tagged[0]?.id);
    expect(idsOf(result.alreadyInState)).toEqual([]);
    expect(idsOf(result.changed)).toHaveLength(4);
  });

  it("ignores the paging keys: `limit` says what a column shows, not what it matches", async () => {
    const tagged = await seedTagged();

    const { result } = await bulk({
      entries: [],
      wholeResultSet: {
        query: { tag: "finance", limit: 1, sort: "title" },
        action: { action: "tag", add: ["q3"] },
      },
    });

    // "All 412 matching", not the one on screen.
    expect(idsOf(result.changed).sort()).toEqual(tagged.map((doc) => doc.id).sort());
  });

  it("reports rows the act does not apply to exactly as an enumerated row would", async () => {
    const [note] = await seed(1);
    const thread = await createThread(ws, { parent: null, body: "one" });

    const { result } = await bulk({
      entries: [],
      wholeResultSet: { query: { type: "note,thread" }, action: { action: "resolve" } },
    });

    expect(pairsOf(result.changed)).toEqual([[thread.id, "resolve"]]);
    expect(result.refused.map((entry) => [entry.id, entry.action, entry.reason])).toEqual([
      [note?.id, "resolve", "not-applicable"],
    ]);
  });

  it("matches by full text, through the same statement the collection query runs", async () => {
    await createDoc(ws, { type: "note", title: "Mortgage", body: "the rate resets in June" });
    await createDoc(ws, { type: "note", title: "Recipe", body: "flour and water" });

    const { result } = await bulk({
      entries: [],
      wholeResultSet: { query: { q: "mortgage" }, action: { action: "tag", add: ["q3"] } },
    });

    expect(result.changed).toHaveLength(1);
    expect(tagsOf(pathOf(idsOf(result.changed)[0] ?? ""))).toEqual(["q3"]);
  });

  it("changes nothing, and commits nothing, when the query matches nothing", async () => {
    await seed(2);
    const head = ws.head();

    const { status, result } = await bulk({
      entries: [],
      wholeResultSet: { query: { tag: "nobody-has-this" }, action: { action: "archive" } },
    });

    // Not a `400`: the request was well formed, and "the corpus can change
    // between staging and saving" is the case this is.
    expect(status).toBe(200);
    expect(result.changed).toEqual([]);
    expect(result.commit).toBeNull();
    expect(ws.head()).toBe(head);
  });

  it("refuses an unrecognised key for the whole request, before any write", async () => {
    const docs = await seed(2);
    const head = ws.head();

    const { status, result } = await bulk({
      entries: [{ id: docs[0]?.id ?? "", action: { action: "archive" } }],
      wholeResultSet: { query: { colour: "blue" }, action: { action: "archive" } },
    });

    // A stored view degrades on an unknown key; a Save cannot, because this
    // query decides what gets written (CONTRACT-048 decision 2).
    expect(status).toBe(400);
    const error = result as unknown as { code: string; issues: { path: string }[] };
    expect(error.code).toBe("bad_request");
    expect(error.issues.map((issue) => issue.path)).toEqual(["wholeResultSet.query.colour"]);
    expect(ws.head()).toBe(head);
    expect(ws.read(docs[0]?.path ?? "")).not.toContain("status: archived");
  });

  it("refuses a value the collection grammar does not accept", async () => {
    await seed(1);
    const head = ws.head();

    const { status, result } = await bulk({
      entries: [],
      wholeResultSet: { query: { status: "half-done" }, action: { action: "archive" } },
    });

    expect(status).toBe(400);
    expect(
      (result as unknown as { issues: { path: string }[] }).issues.map((issue) => issue.path),
    ).toEqual(["wholeResultSet.query.status"]);
    expect(ws.head()).toBe(head);
  });

  it("cannot spell `delete`, and the refusal is the request's", async () => {
    // §11: "all 412 matching" is not a set anyone read before confirming. The
    // contract makes it a type error for a typed client and a `400` on the wire.
    const docs = await seed(1);
    const head = ws.head();

    const { status } = await bulk({
      entries: [],
      wholeResultSet: { query: { type: "note" }, action: { action: "delete" } },
    });

    expect(status).toBe(400);
    expect(ws.head()).toBe(head);
    expect(ws.exists(docs[0]?.path ?? "")).toBe(true);
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
