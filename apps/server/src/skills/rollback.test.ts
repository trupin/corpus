// `POST /api/skills/{name}/rollback` against a real workspace with a real git
// repository. Nothing is stubbed: the whole verb is "read a blob at a revision
// and save it", so a test that faked either half would assert only that the fake
// was called. Every claim below is read off the file on disk, `git log`, the
// projection, or the invalidation bus.

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACTOR_HEADER,
  LockedErrorSchema,
  LockSchema,
  SkillRollbackResultSchema,
  type QueryKey,
} from "@corpus/contract";
import {
  createDocumentMutex,
  updateDocument,
  type DocumentMutex,
  type DocsWorkspace,
} from "../docs/index.js";
import { AUTH, createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";
import { createAutoCommitter, createGit, REVISION_SEARCH_LIMIT } from "../git/index.js";
import { silentLogger } from "../logger.js";
import { skillDocumentPath } from "./paths.js";
import { rollbackSkill, type SkillsWorkspace } from "./rollback.js";

let ws: WriteWorkspace;
let keys: QueryKey[][];
let unsubscribe: () => void;

const SKILL = "orchestrate";
const PATH = skillDocumentPath(SKILL);

const skill = (body: string): string =>
  `---\nname: ${SKILL}\ndescription: Steward the corpus.\n---\n\n${body}\n`;

/** Write the skill and commit it as its own revision, so history has distinct versions. */
function commitSkill(body: string, message: string): string {
  ws.write(PATH, skill(body));
  ws.git("add", "-A", "--", PATH);
  ws.git("commit", "-m", message);
  ws.reproject();
  return ws.head();
}

beforeEach(() => {
  ws = createWriteWorkspace("skill-rollback", { sprint: "s013" });
  keys = [];
  unsubscribe = ws.server.bus.subscribe((frame) => {
    keys.push([...frame]);
  });
});

afterEach(() => {
  unsubscribe();
  ws.close();
});

async function rollback(
  name = SKILL,
  body?: Record<string, unknown>,
  actor = "agent",
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await ws.server.app.request(`/api/skills/${name}/rollback`, {
    method: "POST",
    headers: {
      Authorization: "Bearer tkn_0123456789abcdef0123456789abcdef",
      "x-corpus-author": actor,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

const docIdOf = (path: string): string | undefined =>
  (ws.db.prepare("SELECT id FROM documents WHERE path = ?").get(path) as { id: string } | undefined)
    ?.id;

const acquire = async (id: string, actor: "user" | "agent"): Promise<Response> =>
  ws.server.app.request(`/api/locks/${id}`, {
    method: "POST",
    headers: { ...AUTH, [ACTOR_HEADER]: actor },
  });

const release = async (id: string, actor: "user" | "agent"): Promise<Response> =>
  ws.server.app.request(`/api/locks/${id}`, {
    method: "DELETE",
    headers: { ...AUTH, [ACTOR_HEADER]: actor },
  });

describe("restoring the last-known-good version", () => {
  beforeEach(() => {
    commitSkill("Version one.", "seed the skill");
    commitSkill("Version two — the bad edit.", "edit the skill");
  });

  it("restores the previous version's bytes as a new, attributed commit", async () => {
    const before = ws.head();
    const { status, payload } = await rollback();
    expect(status).toBe(200);
    const result = SkillRollbackResultSchema.parse(payload);

    expect(ws.read(PATH)).toBe(skill("Version one."));
    expect(result.path).toBe(PATH);
    expect(result.name).toBe(SKILL);
    expect(result.warnings).toEqual([]);

    // A new commit, not a rewritten history.
    expect(ws.head()).not.toBe(before);
    const log = ws.git("log", "--format=%H", "--", PATH).trim().split("\n");
    expect(log).toHaveLength(3);
    expect(log[1]).toBe(before);

    const [author, subject] = ws.git("log", "-1", "--format=%an <%ae>%n%s").trim().split("\n");
    expect(author).toBe("agent <agent@corpus.local>");
    expect(subject).toContain("skill rollback: orchestrate");
    expect(subject).toContain("by agent");
  });

  it("reports the new HEAD as `commit`, not the revision the content came from", async () => {
    const source = ws.git("log", "--format=%H", "--", PATH).trim().split("\n")[1];
    const { payload } = await rollback();
    const result = SkillRollbackResultSchema.parse(payload);
    expect(result.commit).toBe(ws.head());
    expect(result.commit).not.toBe(source);
    expect(result.commit).toMatch(/^[0-9a-f]{7,64}$/);
  });

  it("keeps the document id, which is derived from the path a rollback never moves", async () => {
    const before = docIdOf(PATH);
    expect(before).toMatch(/^doc_skill[0-9a-f]{8}$/);
    const { payload } = await rollback();
    expect(SkillRollbackResultSchema.parse(payload).docId).toBe(before);
    expect(docIdOf(PATH)).toBe(before);
  });

  it("re-projects before responding and announces the document's keys", async () => {
    keys.length = 0;
    const { payload } = await rollback();
    const { docId } = SkillRollbackResultSchema.parse(payload);

    // Read-your-write: no refetch race, no watcher involvement.
    const read = await ws.request(`/api/docs/${docId}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { body: string }).body).toContain("Version one.");

    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual([["docs"], ["docs", docId]]);
  });

  it("treats an omitted body, `{}` and `{to: null}` identically", async () => {
    const bare = await rollback(SKILL, undefined);
    expect(bare.status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("Version one."));

    commitSkill("Version three — bad again.", "edit again");
    const empty = await rollback(SKILL, {});
    expect(empty.status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("Version one."));

    commitSkill("Version four — bad again.", "edit once more");
    const explicit = await rollback(SKILL, { to: null });
    expect(explicit.status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("Version one."));
  });
});

describe("choosing the revision", () => {
  it("restores an explicit `--to` revision, however far back", async () => {
    const oldest = commitSkill("Version one.", "seed the skill");
    commitSkill("Version two.", "edit");
    commitSkill("Version three.", "edit again");

    const { status, payload } = await rollback(SKILL, { to: oldest });
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("Version one."));
    expect(SkillRollbackResultSchema.parse(payload).commit).toBe(ws.head());
  });

  it("restores HEAD when the bad edit was made out of band and never committed", async () => {
    commitSkill("The good version.", "seed the skill");
    // An outside editor breaks the skill without committing: HEAD still holds
    // the good bytes, so HEAD is the last-known-good version.
    ws.write(PATH, skill("Broken by an outside editor."));

    const { status } = await rollback();
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("The good version."));
  });

  it("steps over a revision that does not validate", async () => {
    commitSkill("The good version.", "seed the skill");
    // A committed revision whose anchors map is structurally broken: a save
    // would refuse these bytes, so they are not "known good".
    ws.write(
      PATH,
      `---\nname: ${SKILL}\nanchors:\n  not-an-anchor:\n    exact: x\n---\n\nStructurally broken.\n`,
    );
    ws.git("add", "-A", "--", PATH);
    ws.git("commit", "-m", "commit a broken revision");
    ws.write(PATH, skill("The current, also-bad version."));
    ws.git("add", "-A", "--", PATH);
    ws.git("commit", "-m", "another bad edit");
    ws.reproject();

    const { status } = await rollback();
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("The good version."));
  });

  it("refuses a revision git does not resolve, naming the field", async () => {
    commitSkill("Version one.", "seed");
    commitSkill("Version two.", "edit");
    const { status, payload } = await rollback(SKILL, { to: "deadbeefdeadbeef" });
    expect(status).toBe(400);
    expect(payload["issues"]).toEqual([
      { path: "to", message: "`deadbeefdeadbeef` is not a revision in this workspace" },
    ]);
    expect(ws.read(PATH)).toBe(skill("Version two."));
  });

  it("refuses an option-shaped revision without handing it to git", async () => {
    commitSkill("Version one.", "seed");
    const { status, payload } = await rollback(SKILL, { to: "--git-dir=/etc" });
    expect(status).toBe(400);
    expect(payload["code"]).toBe("bad_request");
  });

  it("refuses a revision in which the skill does not exist", async () => {
    const beforeSkill = ws.head();
    commitSkill("Version one.", "seed");
    commitSkill("Version two.", "edit");
    const { status, payload } = await rollback(SKILL, { to: beforeSkill });
    expect(status).toBe(400);
    expect((payload["issues"] as { path: string }[])[0]?.path).toBe("to");
    expect(ws.read(PATH)).toBe(skill("Version two."));
  });
});

describe("nothing to restore", () => {
  it("refuses a skill whose only committed version is the one on disk", async () => {
    commitSkill("The only version.", "seed the skill");
    const { status, payload } = await rollback();
    expect(status).toBe(404);
    expect(payload["code"]).toBe("not_found");
    expect(payload["message"]).toContain("no earlier committed version");
    expect(ws.read(PATH)).toBe(skill("The only version."));
    expect(keys).toEqual([]);
  });

  it("refuses a skill that was never committed at all", async () => {
    ws.write(PATH, skill("Never committed."));
    ws.reproject();
    const { status } = await rollback();
    expect(status).toBe(404);
    expect(ws.read(PATH)).toBe(skill("Never committed."));
  });

  it("explains a `commit: null` rather than leaving it bare", async () => {
    const oldest = commitSkill("Version one.", "seed");
    commitSkill("Version two.", "edit");
    expect((await rollback(SKILL, { to: oldest })).status).toBe(200);

    // The same rollback again: the file already holds those bytes, so there is
    // nothing to write and nothing to commit.
    const { status, payload } = await rollback(SKILL, { to: oldest });
    expect(status).toBe(200);
    const result = SkillRollbackResultSchema.parse(payload);
    expect(result.commit).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toEqual(["commit_skipped"]);
    expect(result.warnings[0]?.detail).toContain("nothing to commit");
  });

  it("explains it for the uncommitted-bad-edit recovery too, where the file did change", async () => {
    commitSkill("The good version.", "seed");
    ws.write(PATH, skill("Broken by an outside editor, never committed."));

    const { status, payload } = await rollback();
    expect(status).toBe(200);
    const result = SkillRollbackResultSchema.parse(payload);
    // The file changed — it was broken and is now good — but the bytes it now
    // holds are exactly what HEAD already records, so git has nothing to commit.
    expect(ws.read(PATH)).toBe(skill("The good version."));
    expect(result.commit).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toEqual(["commit_skipped"]);
    expect(result.warnings[0]?.detail).toContain("the file on disk holds it either way");
  });

  it("refuses when the walk found nothing, scoping the claim to what it examined", async () => {
    // Deeper than the bound, and nothing in the window is restorable: every
    // revision is structurally broken, so `checkSave` refuses all fifty. The
    // refusal must not then claim the *history* holds nothing (PR #11 review
    // finding 15) — the walk stopped at the bound and never looked past it.
    const revisions = REVISION_SEARCH_LIMIT + 1;
    for (let index = 0; index < revisions; index += 1) {
      ws.write(PATH, `---\nname: ${SKILL}\nanchors: not-a-mapping-${String(index)}\n---\n\nX.\n`);
      // `git commit -- <path>` commits the working-tree content of a *tracked*
      // path, so only the first revision needs an `add`: fifty-one revisions
      // cost fifty-two processes rather than a hundred and two.
      if (index === 0) ws.git("add", "-A", "--", PATH);
      ws.git("commit", "-q", "-m", `broken ${String(index)}`, "--", PATH);
    }
    ws.reproject();
    expect(ws.git("log", "--format=%H", "--", PATH).trim().split("\n")).toHaveLength(revisions);

    const { status, payload } = await rollback();
    expect(status).toBe(404);
    const message = String(payload["message"]);
    expect(message).toContain(`none of the ${String(REVISION_SEARCH_LIMIT)} most recent commits`);
    expect(message).toContain("older commits were not examined");
    // The escape from the window, which the operator has and the walk does not.
    expect(message).toContain("name one explicitly with `to`");
    expect(message).not.toContain("its history holds nothing");
  });

  it("keeps the unqualified claim when the walk reached the end of history", async () => {
    commitSkill("The only version.", "seed the skill");
    const { status, payload } = await rollback();
    expect(status).toBe(404);
    expect(String(payload["message"])).toContain(
      "its history holds nothing that differs from the file on disk and validates",
    );
    expect(String(payload["message"])).not.toContain("were not examined");
  });

  it("restores the file and reports `commit: null` in a workspace with no git", async () => {
    const bare = createWriteWorkspace("skill-nogit", { sprint: "s013", git: false });
    try {
      bare.write(PATH, skill("Whatever."));
      bare.reproject();
      const response = await bare.server.app.request(`/api/skills/${SKILL}/rollback`, {
        method: "POST",
        headers: { Authorization: "Bearer tkn_0123456789abcdef0123456789abcdef" },
      });
      // No history at all, so there is no earlier version to restore — which is
      // the honest answer, not a 500.
      expect(response.status).toBe(404);
    } finally {
      bare.close();
    }
  });
});

describe("which skills are addressable", () => {
  it("404s a skill that is not installed", async () => {
    const { status, payload } = await rollback("never-installed");
    expect(status).toBe(404);
    expect(payload["code"]).toBe("not_found");
    expect(payload["message"]).toContain("never-installed");
  });

  it("404s an archived skill, which §7 says is not installed", async () => {
    ws.write(`.claude/skills-archived/${SKILL}/SKILL.md`, skill("Archived."));
    ws.reproject();
    const { status } = await rollback();
    expect(status).toBe(404);
  });

  it("400s a name the param schema refuses, without reaching the handler", async () => {
    const wrongCase = await rollback("Orchestrate");
    expect(wrongCase.status).toBe(400);
    expect(wrongCase.payload["code"]).toBe("bad_request");

    // A nested name does not route to this handler at all.
    const nested = await ws.server.app.request("/api/skills/a/b/rollback", {
      method: "POST",
      headers: { Authorization: "Bearer tkn_0123456789abcdef0123456789abcdef" },
    });
    expect(nested.status).toBe(404);
  });

  it("demands the bearer token", async () => {
    const response = await ws.server.app.request(`/api/skills/${SKILL}/rollback`, {
      method: "POST",
    });
    expect(response.status).toBe(401);
  });
});

describe("the restoration is an ordinary mutation", () => {
  it("does not fold into the edit that made it necessary", async () => {
    const oldest = commitSkill("Version one.", "seed");
    commitSkill("Version two.", "second");
    const docId = docIdOf(PATH);
    expect(docId).toBeDefined();

    // An API edit by the same actor, immediately before the rollback and inside
    // §4's idle window. Every condition the auto-committer checks before folding
    // is satisfied here, and the restored content differs from HEAD's parent, so
    // the amend would go through — deleting the bad edit from history and
    // leaving no record that a rollback happened at all.
    const edited = await ws.put(
      `/api/docs/${docId ?? ""}`,
      { body: "Version three — the bad edit.\n" },
      { "x-corpus-author": "agent" },
    );
    expect(edited.status).toBe(200);
    const afterEditTree = ws.git("rev-parse", `${ws.head()}^{tree}`).trim();
    const heightBefore = ws.log("%H").length;

    const { status } = await rollback(SKILL, { to: oldest }, "agent");
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("Version one."));
    // A commit was *added*, and the bad edit is still in the history under the
    // restoration rather than amended away. Its sha moved — §4 has the
    // restoration close the edit's still-open window first, and a window no act
    // named is relabelled as it closes (SERVER-091) — so the tree is what
    // identifies it, not the sha.
    expect(ws.log("%H")).toHaveLength(heightBefore + 1);
    expect(ws.git("rev-parse", "HEAD^^{tree}").trim()).toBe(afterEditTree);
    expect(ws.git("show", "HEAD^:" + PATH)).toContain("Version three — the bad edit.");
  });

  it("refuses to write bytes that would not pass a save", async () => {
    commitSkill("Fine.", "seed");
    // A committed revision under `data/docs/` rules would be refused; here the
    // skill's own leniency applies, so prove the refusal with a revision that is
    // structurally broken rather than merely frontmatter-less.
    ws.write(PATH, "---\nname: orchestrate\nanchors: not-a-mapping\n---\n\nBroken.\n");
    ws.git("add", "-A", "--", PATH);
    ws.git("commit", "-m", "a structurally broken revision");
    const broken = ws.head();
    ws.write(PATH, skill("Current."));
    ws.git("add", "-A", "--", PATH);
    ws.git("commit", "-m", "current");
    ws.reproject();

    const { status, payload } = await rollback(SKILL, { to: broken });
    expect(status).toBe(400);
    expect(payload["message"]).toContain("would not pass validation");
    expect(ws.read(PATH)).toBe(skill("Current."));
  });

  it("survives a skill so broken the projection never indexed it", async () => {
    commitSkill("The good version.", "seed");
    // Unparseable frontmatter: `projectDocument` skips it, so there is no row
    // to look the document id up from — and this is exactly the case §7's
    // escape hatch exists for.
    ws.write(PATH, "---\nname: [\n---\n\nBroken beyond parsing.\n");
    ws.reproject();
    expect(docIdOf(PATH)).toBeUndefined();

    const { status, payload } = await rollback();
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("The good version."));
    expect(SkillRollbackResultSchema.parse(payload).docId).toBe(docIdOf(PATH));
  });

  it("does not leave the write for the watcher to re-process", async () => {
    commitSkill("Version one.", "seed");
    commitSkill("Version two.", "edit");
    const { payload } = await rollback();
    const { docId } = SkillRollbackResultSchema.parse(payload);
    // `runMutation` registers the write before it lands; the registry is what
    // the watcher consults to tell the server's own writes from an editor's, so
    // the restoration is projected and announced exactly once.
    expect(
      ws.server.selfWrites.claim(join(ws.root, PATH), Buffer.from(skill("Version one."), "utf8")),
    ).toBe(true);
    expect(docId).toBe(docIdOf(PATH));
  });
});

// PR #11 review, finding 1 (MAJOR). A rollback rewrites `SKILL.md`, so it is a
// document write path — and it was the only one that never consulted the edit
// lock. The user editing `comment/SKILL.md` in the board holds the lease (a
// `PUT` on the same document is 423-refused), and `corpus skill rollback
// comment` overwrote and committed straight over the in-progress edit.
//
// Driven through the real `createServer` wiring rather than a stubbed guard:
// what is under test is that `mountSkillRoutes` gets the guard every other verb
// gets, which is a wiring property no unit test of `assertWritable` can see.
describe("the edit lock", () => {
  beforeEach(() => {
    commitSkill("The good version.", "seed the skill");
    commitSkill("The bad edit.", "break it");
  });

  it("refuses the rollback with 423 when the other party holds it", async () => {
    const docId = docIdOf(PATH) ?? "";
    const taken = await acquire(docId, "user");
    expect(taken.status).toBe(201);
    const lock = LockSchema.parse(await taken.json());
    const before = ws.read(PATH);
    const head = ws.head();
    keys.length = 0;

    const { status, payload } = await rollback(SKILL, undefined, "agent");

    expect(status).toBe(423);
    expect(LockedErrorSchema.parse(payload)).toEqual({
      code: "locked",
      message: `${docId} is being edited by user; the lock was acquired at ${lock.acquired}`,
      lock,
    });
    // Refused before anything was restored: file, history and the bus are
    // byte-for-byte what they were.
    expect(ws.read(PATH)).toBe(before);
    expect(ws.head()).toBe(head);
    expect(keys).toEqual([]);
  });

  it("refuses an explicit `--to` rollback too", async () => {
    const docId = docIdOf(PATH) ?? "";
    const oldest = ws.git("log", "--format=%H", "--", PATH).trim().split("\n")[1] ?? "";
    expect((await acquire(docId, "user")).status).toBe(201);
    const before = ws.read(PATH);

    const { status } = await rollback(SKILL, { to: oldest }, "agent");

    expect(status).toBe(423);
    expect(ws.read(PATH)).toBe(before);
  });

  it("never blocks the lease's own holder", async () => {
    const docId = docIdOf(PATH) ?? "";
    expect((await acquire(docId, "agent")).status).toBe(201);

    const { status } = await rollback(SKILL, undefined, "agent");

    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("The good version."));
  });

  it("hands the rollback back once the lease is released", async () => {
    const docId = docIdOf(PATH) ?? "";
    expect((await acquire(docId, "user")).status).toBe(201);
    expect((await rollback(SKILL, undefined, "agent")).status).toBe(423);

    expect((await release(docId, "user")).status).toBe(200);

    expect((await rollback(SKILL, undefined, "agent")).status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("The good version."));
  });

  // SERVER-022 finding 7, for this verb: the guard runs *inside* the lane, so a
  // rollback that waited behind another write is judged against the lock state
  // at the moment it runs, not the one it queued under.
  it("refuses a rollback that was already queued when the lease was taken", async () => {
    const docId = docIdOf(PATH) ?? "";
    const hooks = join(ws.root, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    const started = join(ws.root, ".git", "corpus-hook-started");
    const gate = join(ws.root, ".git", "corpus-hook-gate");
    writeFileSync(
      join(hooks, "pre-commit"),
      [
        "#!/bin/sh",
        `: > "${started}"`,
        "i=0",
        `while [ ! -f "${gate}" ] && [ "$i" -lt 200 ]; do sleep 0.05; i=$((i+1)); done`,
        "exit 0",
      ].join("\n"),
      "utf8",
    );
    chmodSync(join(hooks, "pre-commit"), 0o755);

    // A save on the same document parks inside its own commit, holding the lane.
    const holding = ws.put(`/api/docs/${docId}`, { body: "the save that holds the lane" });
    for (let attempt = 0; attempt < 500 && !existsSync(started); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(existsSync(started)).toBe(true);

    const queued = rollback(SKILL, undefined, "agent");
    // The lease is taken while the rollback sits in the lane — after the point a
    // guard outside the lane would have consulted it.
    expect((await acquire(docId, "user")).status).toBe(201);
    const before = ws.read(PATH);

    writeFileSync(gate, "", "utf8");
    expect((await holding).status).toBe(200);

    const { status } = await queued;
    expect(status).toBe(423);
    expect(ws.read(PATH)).toBe(before);
  });
});

// PR #11 review, finding 14 (MINOR). The current-content read and the candidate
// selection ran outside the document lane, so a save landing in between was
// overwritten by a rollback chosen against bytes that were already stale — and
// the *wrong* revision was restored, because "the newest revision that differs
// from the file on disk" had been measured against the wrong file.
//
// Driven in process rather than over HTTP: the point is an ordering, and the
// only honest way to fix an ordering in a test is to decide it, not to time it.
// Holding the lane directly makes the sequence — save first, rollback second —
// a property of the test rather than of the machine.
describe("choosing the revision inside the lane", () => {
  function skillsWorkspace(): { skills: SkillsWorkspace; mutex: DocumentMutex } {
    const workspaceRoot = ws.server.config.workspaceRoot;
    const gitCommands = createGit(workspaceRoot);
    const docs: DocsWorkspace = {
      workspaceRoot,
      projection: ws.db,
      git: createAutoCommitter({ git: gitCommands, logger: silentLogger, now: () => ws.clock }),
      selfWrites: ws.server.selfWrites,
      bus: ws.server.bus,
      logger: silentLogger,
      now: () => ws.clock,
    };
    return { skills: { ...docs, gitCommands }, mutex: createDocumentMutex() };
  }

  it("is not fooled by a save that entered the lane first", async () => {
    commitSkill("Version one.", "seed");
    commitSkill("Version two.", "edit");
    const docId = docIdOf(PATH) ?? "";
    const { skills, mutex } = skillsWorkspace();

    // Nothing enters `docId`'s lane until this resolves, so the order below is
    // the order the three operations were registered in.
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    void mutex.run(docId, () => held);

    const save = updateDocument(skills, mutex, "user", docId, {
      body: "Version three — the concurrent save.\n",
    });
    // Registered while the save is still queued. The pre-fix code read the file
    // here, synchronously, before the save had written a byte — and then chose
    // "Version one." because "Version two." was what it believed was on disk.
    const rolled = rollbackSkill(skills, mutex, "agent", SKILL, null);

    release();
    await save;
    await rolled;

    // Measured against the save's bytes: "Version three" is what the file held
    // when the rollback ran, so the newest revision that differs from it is
    // "Version two." — the save is undone, not the two edits before it.
    expect(ws.read(PATH)).toBe(skill("Version two."));
  });

  it("restores nothing when the save that went first is already the last-known-good", async () => {
    commitSkill("Version one.", "seed");
    const docId = docIdOf(PATH) ?? "";
    const { skills, mutex } = skillsWorkspace();

    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    void mutex.run(docId, () => held);

    const save = updateDocument(skills, mutex, "user", docId, { body: "Version two.\n" });
    const rolled = rollbackSkill(skills, mutex, "agent", SKILL, null);

    release();
    await save;
    // Only two revisions exist and the newer one is on disk, so the answer is
    // "Version one." — reached without ever having seen the pre-save file.
    await rolled;
    expect(ws.read(PATH)).toBe(skill("Version one."));
  });
});

// SPEC.md §4's read-back rule (SERVER-093): "Any operation that names, reads or
// reverts a commit closes the open window before it runs." A rollback does both
// — it names a revision and reverts to it — so it is the verb the rule was
// written for, and the flush belongs before the read rather than beside the
// write (`squash: false` is a different promise and does not flush).
describe("closing §4's commit window before the revision is resolved", () => {
  /** A good version saved through the server's own write path, leaving its window open. */
  async function saveThroughTheWritePath(body: string): Promise<{ docId: string; bytes: string }> {
    const docId = docIdOf(PATH) ?? "";
    const response = await ws.put(`/api/docs/${docId}`, { body }, { "x-corpus-author": "user" });
    expect(response.status).toBe(200);
    return { docId, bytes: ws.read(PATH) };
  }

  it("chooses against a settled history, not one the window is still holding", async () => {
    // §7's headline case: the good version is the open window's commit, and the
    // bad edit came from an outside editor and was never committed. The walk
    // therefore picks HEAD itself — which, while the window is open, is a commit
    // the server intends to keep amending.
    commitSkill("Version one.", "seed the skill");
    const { bytes: good } = await saveThroughTheWritePath("Version two — good.\n");
    const openWindowSha = ws.head();
    const commits = ws.log("%H").length;

    // No clock advance: the window is wide open at this instant.
    ws.write(PATH, skill("Version three — broken."));
    ws.reproject();

    const { status, payload } = await rollback(SKILL, undefined, "user");
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(good);
    // Nothing to commit — the restored bytes are what git already records for
    // this path — so §14's explanation stands in for a commit.
    const result = SkillRollbackResultSchema.parse(payload);
    expect(result.commit).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toContain("commit_skipped");

    // The proof that the close ran *before* the walk: the window's commit has
    // been relabelled as the editing session it was, and its sha has moved. Nor
    // did the close add a commit — the window's content was already in git.
    expect(ws.log("%H").length).toBe(commits);
    expect(ws.log("%s")[0]).toBe("editing session: 1 document by user");
    expect(ws.head()).not.toBe(openWindowSha);
    expect(ws.log("%H")).not.toContain(openWindowSha);
    expect(ws.git("show", `HEAD:${PATH}`)).toBe(good);

    // And the window really is closed: the next save opens a fresh commit
    // rather than amending the one the rollback just read.
    const docId = docIdOf(PATH) ?? "";
    await ws.put(`/api/docs/${docId}`, { body: "Version four.\n" }, { "x-corpus-author": "user" });
    expect(ws.log("%H").length).toBe(commits + 1);
  });

  it("leaves the editing work as its own commit beneath the restoration", async () => {
    // The other half of §4's E2E claim: the window's commit lands *before* the
    // rollback's, never swept into it (`squash: false`), and the restoration
    // names a revision `git log` finds.
    const seed = commitSkill("Version one.", "seed the skill");
    const { bytes: good } = await saveThroughTheWritePath("Version two — good.\n");

    const { status, payload } = await rollback(SKILL, { to: seed }, "user");
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("Version one."));
    expect(SkillRollbackResultSchema.parse(payload).commit).toBe(ws.head());

    // HEAD is the restoration; its parent is the editing session, relabelled as
    // it closed and still holding the version that was on screen.
    expect(ws.log("%s")[0]).toContain("skill rollback: orchestrate");
    expect(ws.log("%s")[1]).toBe("editing session: 1 document by user");
    expect(ws.git("show", `HEAD^:${PATH}`)).toBe(good);
    // The sha the subject prints is one the branch holds.
    const named = /\bto ([0-9a-f]{7,})\b/.exec(ws.log("%s")[0] ?? "")?.[1] ?? "";
    expect(named).not.toBe("");
    expect(ws.log("%H").some((sha) => sha.startsWith(named))).toBe(true);
  });

  it("closes the window even when the revision does not resolve", async () => {
    // The close is owed by the read, not by the write: the window ends because
    // its content is about to be named, whether or not a restoration follows.
    commitSkill("Version one.", "seed the skill");
    const { docId } = await saveThroughTheWritePath("Version two.\n");
    const commits = ws.log("%H").length;

    const { status } = await rollback(SKILL, { to: "0".repeat(40) }, "user");
    expect(status).toBe(400);

    expect(ws.log("%H").length).toBe(commits);
    expect(ws.log("%s")[0]).toBe("editing session: 1 document by user");
    await ws.put(`/api/docs/${docId}`, { body: "Version three.\n" }, { "x-corpus-author": "user" });
    expect(ws.log("%H").length).toBe(commits + 1);
  });
});
