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
} from "../docs/write-fixture.js";

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

    const saved = await ws.put(`/api/docs/${row.id}`, { body: "Do the other thing.\n" });
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
