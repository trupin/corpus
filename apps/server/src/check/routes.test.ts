// `POST /api/check` against a real workspace, a real projection and the real
// Hono app — the same fixture the write path's own suites use, because the whole
// claim under test is "this is the validator the write path runs".

import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHECK_REQUEST_XOR_MESSAGE,
  CheckReportSchema,
  contractRoutes,
  type CheckReport,
} from "@corpus/contract";
import {
  createWriteWorkspace,
  createDoc,
  AUTH,
  type WriteWorkspace,
  putDoc,
} from "../docs/write-fixture.js";
import { createThread } from "../threads/thread-fixture.js";

let ws: WriteWorkspace;

const STAMPS = "created: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z";

beforeEach(() => {
  ws = createWriteWorkspace("check", { sprint: "s013" });
});

afterEach(() => {
  ws.close();
});

/** Every response goes through the wire schema — a report the contract cannot serialize is a bug. */
async function check(body: unknown): Promise<{ status: number; report: CheckReport }> {
  const response = await ws.post("/api/check", body);
  const payload: unknown = await response.json();
  if (response.status !== 200) {
    return { status: response.status, report: payload as CheckReport };
  }
  return { status: response.status, report: CheckReportSchema.parse(payload) };
}

const codes = (findings: readonly { code: string }[]): string[] =>
  [...new Set(findings.map((finding) => finding.code))].sort();

describe("POST /api/check — mounting and scope", () => {
  it("is served, and refuses an unauthenticated request", async () => {
    const ok = await ws.post("/api/check", { ids: [] });
    expect(ok.status).toBe(200);

    const anonymous = await ws.server.app.request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(anonymous.status).toBe(401);
  });

  it("treats both empty collections as legal and empty", async () => {
    for (const body of [{ ids: [] }, { documents: [] }]) {
      const { status, report } = await check(body);
      expect(status).toBe(200);
      expect(report).toEqual({ ok: true, errors: [], warnings: [] });
    }
  });
});

describe("the XOR is the schema's, not the handler's", () => {
  it("refuses both keys, neither key and an unknown key with one top-level issue", async () => {
    for (const body of [{ ids: [], documents: [] }, {}, { foo: 1 }]) {
      const response = await ws.post("/api/check", body);
      expect(response.status).toBe(400);
      const payload = (await response.json()) as { issues: { path: string; message: string }[] };
      expect(payload.issues).toEqual([{ path: "json", message: CHECK_REQUEST_XOR_MESSAGE }]);
    }
  });

  /**
   * The refusal above proves the *response*; this proves the **handler never
   * ran**. The same shipped route definition is mounted on a bare app with a
   * counting handler, so the count is the number of times a handler for this
   * route was entered — zero for each malformed body, one for a well-formed one.
   */
  it("never enters the handler for a malformed request", async () => {
    let entered = 0;
    const probe = new OpenAPIHono();
    probe.openapi(contractRoutes.checkDocuments, (c) => {
      entered += 1;
      return c.json({ ok: true, errors: [], warnings: [] }, 200);
    });
    const post = async (body: unknown): Promise<Response> =>
      probe.request("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    for (const body of [{ ids: [], documents: [] }, {}, { foo: 1 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(entered).toBe(0);

    expect((await post({ ids: [] })).status).toBe(200);
    expect(entered).toBe(1);
  });
});

describe("the {ids} branch", () => {
  it("reads the real file at the real path, on every call", async () => {
    const created = await createDoc(ws, {
      type: "note",
      title: "Anchored",
      body: "The quick brown fox.",
    });

    const clean = await check({ ids: [created.id] });
    expect(clean.report).toEqual({ ok: true, errors: [], warnings: [] });

    // Out of band, without a restart: the next check must see the new bytes.
    ws.write(
      created.path,
      `---\nid: ${created.id}\ntype: note\ntitle: Anchored\n${STAMPS}\n---\n\nSee [[doc_nowhere]].\n`,
    );
    const after = await check({ ids: [created.id] });
    expect(after.status).toBe(200);
    expect(codes(after.report.warnings)).toEqual(["ref-unresolved"]);
    expect(after.report.warnings[0]?.path).toBe(created.path);
    expect(after.report.warnings[0]?.docId).toBe(created.id);
    expect(after.report.ok).toBe(true);
  });

  it("is silent about ids that name no document", async () => {
    const { status, report } = await check({ ids: ["doc_zzzzzz"] });
    expect(status).toBe(200);
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("does not manufacture a duplicate-id finding out of a repeated id", async () => {
    const created = await createDoc(ws, { type: "note", title: "Once", body: "Body." });
    const { report } = await check({ ids: [created.id, created.id, created.id] });
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("reports a row whose file vanished instead of throwing", async () => {
    const created = await createDoc(ws, { type: "note", title: "Gone", body: "Body." });
    ws.git("rm", "-q", "--", created.path);
    const { status, report } = await check({ ids: [created.id] });
    expect(status).toBe(200);
    expect(codes(report.errors)).toEqual(["frontmatter-unparseable"]);
    expect(report.errors[0]?.path).toBe(created.path);
    expect(report.ok).toBe(false);
  });
});

describe("the {documents} branch", () => {
  it("validates content that is not on disk, and creates nothing", async () => {
    const before = ws.git("status", "--porcelain");
    const { status, report } = await check({
      documents: [{ path: "data/docs/nope.md", content: "---\nbad: [\n---\n" }],
    });
    expect(status).toBe(200);
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.path).toBe("data/docs/nope.md");
    expect(codes(report.errors)).toEqual(["frontmatter-unparseable"]);
    expect(ws.exists("data/docs/nope.md")).toBe(false);
    expect(ws.git("status", "--porcelain")).toBe(before);
  });

  it("judges `[[refs]]` against the workspace, not only against the submitted set", async () => {
    const target = await createDoc(ws, { type: "note", title: "Target", body: "I exist." });
    const { report } = await check({
      documents: [
        {
          path: "data/docs/staged.md",
          content: `---\nid: doc_staged\ntype: note\ntitle: Staged\n${STAMPS}\n---\n\nSee [[${target.id}]] and [[doc_nobody]].\n`,
        },
      ],
    });
    expect(codes(report.warnings)).toEqual(["ref-unresolved"]);
    expect(report.warnings[0]?.detail).toContain("doc_nobody");
    expect(report.ok).toBe(true);
  });
});

describe("the whole-corpus rules are not filtered to what a save may block on", () => {
  it("reports duplicate-id, which the save path deliberately never blocks on", async () => {
    const shared = `---\nid: doc_dupe01\ntype: note\ntitle: Dupe\n${STAMPS}\n---\n\nBody.\n`;
    const { report } = await check({
      documents: [
        { path: "data/docs/one.md", content: shared },
        { path: "data/docs/two.md", content: shared },
      ],
    });
    expect(codes(report.errors)).toEqual(["duplicate-id"]);
    expect(report.ok).toBe(false);
  });

  it("reports an anchor no thread claims, which a single-file save cannot judge", async () => {
    // No thread exists anywhere — not in the request and not in the projection —
    // so the live-corpus seam has nothing to say and the error stands.
    const created = await createDoc(ws, {
      type: "note",
      title: "Anchored",
      body: "The quick brown fox.",
    });
    ws.write(
      created.path,
      `---\nid: ${created.id}\ntype: note\ntitle: Anchored\n${STAMPS}\nanchors:\n  anc_aaaaaa:\n    exact: quick brown\n---\n\nThe quick brown fox.\n`,
    );
    const { report } = await check({ ids: [created.id] });
    expect(codes(report.errors)).toEqual(["anchor-unused"]);
  });
});

/**
 * SERVER-066. The reported bug: an agent closed a fence on the same line as the
 * content, `turns.ts` (which excludes fenced regions from turn-delimiter
 * scanning, deliberately) stopped seeing every heading after it, and a person's
 * reply vanished into the agent's turn with no error anywhere. This is the
 * "anywhere".
 */
describe("an unterminated fenced code block", () => {
  const SWALLOWING_THREAD = [
    "## agent · 2026-01-01T00:00:00Z",
    "",
    "Here is the snippet:",
    "",
    "```",
    "const x = 1;```",
    "",
    "## user · 2026-01-01T00:01:00Z",
    "",
    "Actually, no.",
    "",
  ].join("\n");

  it("is reported on the wire, at error severity, naming the file line it opened on", async () => {
    const content = `---\nid: th_fence1\ntype: thread\ntitle: Fenced\nparent: doc_nobody\nstatus: open\n${STAMPS}\n---\n\n${SWALLOWING_THREAD}`;
    const { report } = await check({
      documents: [{ path: "data/threads/th_fence1.md", content }],
    });

    const finding = report.errors.find((f) => f.code === "unterminated-fence");
    expect(finding?.severity).toBe("error");
    expect(finding?.docId).toBe("th_fence1");
    expect(finding?.path).toBe("data/threads/th_fence1.md");
    // The line an editor's gutter shows, derived from the submitted bytes rather
    // than counted by hand.
    const expected = content.split("\n").findIndex((line) => line === "```") + 1;
    expect(finding?.detail).toContain(`opened at line ${expected}`);
    // The consequence a thread suffers, spelled out where a person will read it.
    expect(finding?.detail).toContain("turn heading");
    expect(report.ok).toBe(false);
  });

  it("is an error the write path nonetheless accepted — the check is the only gate", async () => {
    // The document is created through the real API. That it exists at all is the
    // point: `unterminated-fence` is out of `LOCAL_CHECK_CODES` on purpose, so a
    // save is never refused for it and a person is told about it here instead.
    const created = await createDoc(ws, {
      type: "note",
      title: "Fenced",
      body: "Here is the snippet:\n\n```\nconst x = 1;```",
    });
    expect(created.warnings).toEqual([]);

    const { report } = await check({ ids: [created.id] });
    expect(codes(report.errors)).toEqual(["unterminated-fence"]);
    // An ordinary document loses no turns, and the finding does not pretend it does.
    expect(report.errors[0]?.detail).not.toContain("turn heading");
  });

  it("says nothing about a fence that closes on its own line", async () => {
    const created = await createDoc(ws, {
      type: "note",
      title: "Closed",
      body: "Here is the snippet:\n\n```\nconst x = 1;\n```\n",
    });
    const { report } = await check({ ids: [created.id] });
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });
});

/**
 * SERVER-019 FAIL-1 (sprint-013 evaluation): `anchor-unused` is a cross-document
 * rule and was answered from the submitted set alone, so every subset request —
 * `corpus doc check <id>` and *every* `--staged` run, which is a subset by
 * construction — reported an error for the most ordinary document in the
 * product: one that has been commented on. Adjudication 6 makes that a bug by
 * definition ("a document the system would accept on write must not fail
 * `doc check`").
 */
describe("anchor-unused is answered against the live corpus, unioned with the request", () => {
  /** The evaluator's fixture: a real document with a real anchored thread. */
  async function anchoredDocument(): Promise<{
    id: string;
    path: string;
    threadId: string;
    anchorId: string;
  }> {
    const created = await createDoc(ws, {
      type: "note",
      title: "Anchored subject",
      body: "The quick brown fox jumps over the lazy dog.",
    });
    const thread = await createThread(ws, {
      parent: created.id,
      title: "About the fox",
      body: "why brown?",
      selector: { exact: "quick brown fox" },
    });
    expect(thread.anchorId).not.toBeNull();
    return {
      id: created.id,
      path: created.path,
      threadId: thread.id,
      anchorId: thread.anchorId ?? "",
    };
  }

  it("accepts a document by id whose thread the request never names", async () => {
    const subject = await anchoredDocument();

    // The write path accepts this document…
    const saved = await putDoc(ws, subject.id, {
      body: "The quick brown fox jumps over the lazy dog. Accepted by the write path.\n",
    });
    expect(saved.status).toBe(200);

    // …so the check must too, whether or not the thread is in the request.
    const alone = await check({ ids: [subject.id] });
    expect(alone.report).toEqual({ ok: true, errors: [], warnings: [] });

    const together = await check({ ids: [subject.id, subject.threadId] });
    expect(together.report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("accepts the same document through the `--staged` pair form", async () => {
    const subject = await anchoredDocument();
    const { report } = await check({
      documents: [{ path: subject.path, content: ws.read(subject.path) }],
    });
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("reports a genuinely unused anchor in a subset and in a whole-workspace request", async () => {
    const subject = await anchoredDocument();
    const dangling = await createDoc(ws, { type: "note", title: "Dangling", body: "Lazy dog." });
    ws.write(
      dangling.path,
      `---\nid: ${dangling.id}\ntype: note\ntitle: Dangling\n${STAMPS}\nanchors:\n  anc_ffffff:\n    exact: Lazy dog\n---\n\nLazy dog.\n`,
    );
    ws.reproject();

    const subset = await check({ ids: [dangling.id] });
    expect(codes(subset.report.errors)).toEqual(["anchor-unused"]);
    expect(subset.report.errors[0]?.detail).toContain("anc_ffffff");
    expect(subset.report.ok).toBe(false);

    // The same drift in the whole-workspace run, and the anchored document
    // beside it still contributes nothing: the union changed neither answer.
    const allIds = (ws.db.prepare("SELECT id FROM documents").all() as { id: string }[]).map(
      (row) => row.id,
    );
    expect(allIds).toContain(subject.id);
    expect(allIds).toContain(subject.threadId);
    const whole = await check({ ids: allIds });
    expect(codes(whole.report.errors)).toEqual(["anchor-unused"]);
    expect(whole.report.errors).toHaveLength(1);
    expect(whole.report.errors[0]?.docId).toBe(dangling.id);
  });

  it("accepts staged pairs whose thread exists only in the request", async () => {
    // The init-time staged check: neither file is on disk and neither is in the
    // projection, so the submitted set is the whole corpus there is.
    const parent = `---\nid: doc_staged1\ntype: note\ntitle: Staged\n${STAMPS}\nanchors:\n  anc_bbbbbb:\n    exact: quick brown\n---\n\nThe quick brown fox.\n`;
    const thread = `---\nid: th_staged1\ntype: thread\ntitle: Thread\nparent: doc_staged1\nanchor: anc_bbbbbb\nstatus: open\n${STAMPS}\n---\n\n**user** · 2026-01-01T00:00:00Z\n\nHi.\n`;
    const { report } = await check({
      documents: [
        { path: "data/docs/staged.md", content: parent },
        { path: "data/threads/th_staged1.md", content: thread },
      ],
    });
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("catches an anchor the staged edit itself orphaned", async () => {
    // The thread is in the request and its staged bytes no longer claim the
    // anchor: the submitted set is authoritative for what it contains, so the
    // projection's row must not vouch for the anchor.
    const subject = await anchoredDocument();
    const threadPath = `data/threads/${subject.threadId}.md`;
    const { report } = await check({
      documents: [
        { path: subject.path, content: ws.read(subject.path) },
        {
          path: threadPath,
          content: ws
            .read(threadPath)
            .replace(new RegExp(`^anchor: ${subject.anchorId}\n`, "m"), ""),
        },
      ],
    });
    expect(codes(report.errors)).toEqual(["anchor-unused"]);
    expect(report.errors[0]?.detail).toContain(subject.anchorId);
    expect(report.ok).toBe(false);
  });
});

describe("`ok` and the severity split", () => {
  it("is `errors.length === 0`, and warnings never flip it", async () => {
    const created = await createDoc(ws, { type: "note", title: "Warned", body: "Body." });
    ws.write(
      created.path,
      `---\nid: ${created.id}\ntype: note\ntitle: Warned\n${STAMPS}\n---\n\nSee [[doc_nobody]].\n`,
    );
    const warned = await check({ ids: [created.id] });
    expect(warned.report.warnings.length).toBeGreaterThan(0);
    expect(warned.report.errors).toEqual([]);
    expect(warned.report.ok).toBe(true);

    const drifted = await check({
      documents: [{ path: "data/docs/broken.md", content: "---\nbad: [\n---\n" }],
    });
    expect(drifted.report.ok).toBe(drifted.report.errors.length === 0);
    expect(drifted.report.ok).toBe(false);
  });

  it("keeps both §14 carve-outs in `warnings` and out of `errors`", async () => {
    const created = await createDoc(ws, {
      type: "note",
      title: "Both",
      body: "The quick brown fox.",
    });
    // An orphaned anchor claimed by a real thread, plus an unresolved ref.
    ws.write(
      created.path,
      `---\nid: ${created.id}\ntype: note\ntitle: Both\n${STAMPS}\nanchors:\n  anc_aaaaaa:\n    exact: text that is not present\n---\n\nSee [[doc_nobody]].\n`,
    );
    ws.write(
      "data/threads/th_aaaaaa.md",
      `---\nid: th_aaaaaa\ntype: thread\ntitle: Thread\nparent: ${created.id}\nanchor: anc_aaaaaa\nstatus: open\n${STAMPS}\n---\n\n**user** · 2026-01-01T00:00:00Z\n\nHi.\n`,
    );
    ws.reproject();

    const { report } = await check({ ids: [created.id, "th_aaaaaa"] });
    expect(codes(report.warnings)).toEqual(["anchor-unresolved", "ref-unresolved"]);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe("§7's skill-frontmatter leniency (Adjudication 6)", () => {
  const HAND_WRITTEN =
    "---\nname: hand-written\ndescription: A skill Claude Code wrote.\n---\n\nDo the thing.\n";

  it("passes a hand-written SKILL.md carrying only name/description", async () => {
    ws.write(".claude/skills/hand-written/SKILL.md", HAND_WRITTEN);
    ws.reproject();
    const row = ws.db
      .prepare("SELECT id FROM documents WHERE path = ?")
      .get(".claude/skills/hand-written/SKILL.md") as { id: string };

    const { report } = await check({ ids: [row.id] });
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("agrees with the write path: what a save accepts, a check accepts", async () => {
    // The save path is the authority; this asserts the two answers, not a copy
    // of the rule. Editing the skill through `PUT /api/docs/{id}` must succeed…
    ws.write(".claude/skills/hand-written/SKILL.md", HAND_WRITTEN);
    ws.reproject();
    const row = ws.db
      .prepare("SELECT id FROM documents WHERE path = ?")
      .get(".claude/skills/hand-written/SKILL.md") as { id: string };

    const saved = await putDoc(ws, row.id, { body: "Do the other thing.\n" });
    expect(saved.status).toBe(200);

    // …and so must checking it afterwards.
    const { report } = await check({ ids: [row.id] });
    expect(report.ok).toBe(true);
  });

  it("still reports the same file's structural problems", async () => {
    ws.write(
      ".claude/skills/broken/SKILL.md",
      "---\nname: broken\nanchors:\n  not-an-anchor-id:\n    exact: x\n---\n\nBody.\n",
    );
    const { report } = await check({
      documents: [
        {
          path: ".claude/skills/broken/SKILL.md",
          content: "---\nname: broken\nanchors:\n  not-an-anchor-id:\n    exact: x\n---\n\nBody.\n",
        },
      ],
    });
    expect(codes(report.errors)).toEqual(["anchor-malformed"]);
  });

  it("does not extend the leniency to documents under `data/`", async () => {
    const { report } = await check({
      documents: [
        {
          path: "data/docs/no-frontmatter.md",
          content: "---\nname: not a corpus document\n---\n\nBody.\n",
        },
      ],
    });
    expect(codes(report.errors)).toEqual(["frontmatter-invalid"]);
    expect(report.ok).toBe(false);
  });
});

// SPEC.md §7: "Corpus's frontmatter fields … coexist with Claude Code's
// (`name`, `description`) in the same YAML block; `corpus doc check` validates
// both sets." Pre-fix it validated neither of Claude Code's, in none of the
// four combinations — the state AGENT-034 measured against a real session, where
// only both-present is loaded (SERVER-123).
describe("§7's other half: Claude Code's frontmatter", () => {
  const profile = (frontmatter: string): string => `---\n${frontmatter}---\n\nYou research.\n`;
  const NAME = "name: researcher\n";
  const DESCRIPTION = "description: Reach for this when a claim needs its source.\n";

  const checkProfile = async (
    frontmatter: string,
    path = ".claude/agents/researcher.md",
  ): Promise<CheckReport> => {
    const content = profile(frontmatter);
    ws.write(path, content);
    const { report } = await check({ documents: [{ path, content }] });
    return report;
  };

  const messages = (report: CheckReport): string => report.errors.map((f) => f.detail).join("\n");

  it("reports an agent-def carrying neither field", async () => {
    const report = await checkProfile("");
    expect(codes(report.errors)).toEqual(["frontmatter-invalid"]);
    expect(report.errors).toHaveLength(2);
    expect(messages(report)).toContain("name:");
    expect(messages(report)).toContain("description:");
    expect(report.ok).toBe(false);
  });

  it("reports one carrying only `description`", async () => {
    const report = await checkProfile(DESCRIPTION);
    expect(report.errors.map((f) => f.detail.split(":")[0])).toEqual(["name"]);
    expect(report.ok).toBe(false);
  });

  it("reports one carrying only `name`", async () => {
    const report = await checkProfile(NAME);
    expect(report.errors.map((f) => f.detail.split(":")[0])).toEqual(["description"]);
    expect(report.ok).toBe(false);
  });

  it("passes one carrying both, with no Corpus frontmatter at all", async () => {
    const report = await checkProfile(`${NAME}${DESCRIPTION}`);
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  // Not merely "a field is absent": the finding says what the absence costs.
  it("names the field and what it costs", async () => {
    const report = await checkProfile(NAME);
    expect(report.errors[0]?.detail).toContain("Claude Code loads a subagent only when");
    expect(report.errors[0]?.path).toBe(".claude/agents/researcher.md");
  });

  // The second divergence: Claude Code lists it as `numbers`, Corpus resolves
  // it as `@bareprofile`, and nothing anywhere said so.
  it("reports a `name` that disagrees with the filename, naming both addresses", async () => {
    const report = await checkProfile(
      `name: numbers\n${DESCRIPTION}`,
      ".claude/agents/bareprofile.md",
    );
    expect(codes(report.errors)).toEqual(["frontmatter-invalid"]);
    expect(report.errors[0]?.detail).toContain("`numbers`");
    expect(report.errors[0]?.detail).toContain("@bareprofile");
    expect(report.ok).toBe(false);
  });

  // The waiver and the requirement are two halves of one statement and must not
  // contradict: §5's canonical block stays waived under exactly the roots where
  // Claude Code's block is required.
  it("still waives §5's canonical block on the same file", async () => {
    const report = await checkProfile(`${NAME}${DESCRIPTION}`);
    expect(report.errors).toEqual([]);
    // …and a full Corpus block beside them is equally fine.
    const both = await checkProfile(
      `${NAME}${DESCRIPTION}id: doc_agent01\ntype: agent-def\ntitle: Researcher\n${STAMPS}\n`,
    );
    expect(both.errors).toEqual([]);
  });

  it("asks nothing of a hand-written SKILL.md, which the write path never leaves incomplete", async () => {
    const path = ".claude/skills/hand-written/SKILL.md";
    const content = "---\nname: hand-written\n---\n\nDo the thing.\n";
    ws.write(path, content);
    const { report } = await check({ documents: [{ path, content }] });
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("asks nothing of a `type: agent-def` document under data/docs", async () => {
    const path = "data/docs/inbox/about-personas.md";
    const content = `---\nid: doc_about01\ntype: agent-def\ntitle: About Personas\n${STAMPS}\n---\n\nProse.\n`;
    ws.write(path, content);
    const { report } = await check({ documents: [{ path, content }] });
    expect(report).toEqual({ ok: true, errors: [], warnings: [] });
  });

  // Sprint-013 Adjudication 6, in both directions: the create route supplies
  // what the check demands, and the check accepts what the create wrote.
  it("agrees with the create route, including its zero-form shape", async () => {
    for (const extra of [
      undefined,
      { description: "Reach for this when a claim needs its source." },
    ]) {
      const created = await createDoc(ws, {
        type: "agent-def",
        title: extra === undefined ? "Researcher" : "Sourcer",
        ...(extra === undefined ? {} : { extra }),
      });

      const { report } = await check({ ids: [created.id] });
      expect(report, created.path).toEqual({ ok: true, errors: [], warnings: [] });
    }
  });
});

describe("a drifted corpus", () => {
  it("is a 200 carrying the findings, never a throw", async () => {
    const shared = `---\nid: doc_dupe01\ntype: note\ntitle: Dupe\n${STAMPS}\n---\n\nBody.\n`;
    ws.write("data/docs/one.md", shared);
    ws.write("data/docs/two.md", shared);
    ws.reproject();

    const response = await ws.post("/api/check", {
      documents: [
        { path: "data/docs/one.md", content: shared },
        { path: "data/docs/two.md", content: shared },
        { path: "data/docs/three.md", content: "---\nbad: [\n---\n" },
      ],
    });
    expect(response.status).toBe(200);
    const report = CheckReportSchema.parse(await response.json());
    expect(report.ok).toBe(false);
    expect(codes(report.errors)).toEqual(["duplicate-id", "frontmatter-unparseable"]);
  });
});

describe("authentication", () => {
  it("demands the bearer token", async () => {
    const response = await ws.server.app.request("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("accepts it", async () => {
    const response = await ws.server.app.request("/api/check", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    expect(response.status).toBe(200);
  });
});
