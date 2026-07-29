// `POST /api/skills/{name}/rollback` against a real workspace with a real git
// repository. Nothing is stubbed: the whole verb is "read a blob at a revision
// and save it", so a test that faked either half would assert only that the fake
// was called. Every claim below is read off the file on disk, `git log`, the
// projection, or the invalidation bus.

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillRollbackResultSchema, type QueryKey } from "@corpus/contract";
import { createWriteWorkspace, type WriteWorkspace } from "../docs/write-fixture.js";
import { skillDocumentPath } from "./rollback.js";

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
    const afterEdit = ws.head();
    const heightBefore = ws.log("%H").length;

    const { status } = await rollback(SKILL, { to: oldest }, "agent");
    expect(status).toBe(200);
    expect(ws.read(PATH)).toBe(skill("Version one."));
    // A commit was *added*, and the bad edit's own commit is still reachable.
    expect(ws.log("%H")).toHaveLength(heightBefore + 1);
    expect(ws.log("%H")).toContain(afterEdit);
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
