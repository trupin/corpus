import { DocSchema, UpdateDocResponseSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { SQUASH_IDLE_MS } from "../git/index.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const ANCHOR = "anc_r4te0001";
const QUOTE = "The rate is fixed for five years.";
const BODY = ["Intro paragraph.", "", QUOTE, "", "Closing paragraph."].join("\n");

const ANCHORED_DOC = [
  "---",
  "id: doc_mortgage",
  "type: note",
  "title: Mortgage options",
  "created: 2026-07-01T00:00:00Z",
  "updated: 2026-07-01T00:00:00Z",
  "tags: []",
  "status: open",
  "anchors:",
  `  ${ANCHOR}:`,
  `    exact: ${JSON.stringify(QUOTE)}`,
  `    prefix: ${JSON.stringify("Intro paragraph.\n\n")}`,
  `    suffix: ${JSON.stringify("\n\nClosing paragraph.")}`,
  "due: null",
  "reviewed: null",
  "evergreen: false",
  "---",
  "",
  BODY,
  "",
].join("\n");

const THREAD_DOC = [
  "---",
  "id: th_rate0001",
  "type: thread",
  "title: About the rate",
  "created: 2026-07-01T00:00:00Z",
  "updated: 2026-07-01T00:00:00Z",
  "tags: []",
  "status: open",
  "anchors: {}",
  "due: null",
  "reviewed: null",
  "evergreen: false",
  "parent: doc_mortgage",
  `anchor: ${ANCHOR}`,
  "agent: none",
  "---",
  "",
  "## user · 2026-07-01T00:00:00Z",
  "",
  "Is this right?",
  "",
].join("\n");

/** A workspace holding the anchored document, its thread, and both committed. */
function anchored(name: string): WriteWorkspace {
  ws = createWriteWorkspace(name);
  ws.write("data/docs/inbox/mortgage.md", ANCHORED_DOC);
  ws.write("data/threads/th_rate0001.md", THREAD_DOC);
  ws.git("add", "-A", "--", "data");
  ws.git("commit", "-m", "seed the anchored document");
  ws.reproject();
  return ws;
}

/** The exact source lines of the `anchors:` block, for byte-identity assertions. */
const anchorsBlock = (text: string): string =>
  text.slice(text.indexOf("anchors:"), text.indexOf("due:"));

describe("PUT /api/docs/{id}", () => {
  it("writes a body edit, stamps updated, and reports an empty anchor report", async () => {
    ws = createWriteWorkspace("update-body");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Plain", body: "before" });
    const before = parseDocument(ws.read(created.path)).data["updated"];

    ws.advance(60_000);
    const response = await ws.put(`/api/docs/${created.id}`, { body: "after the edit" });
    expect(response.status).toBe(200);
    const payload = UpdateDocResponseSchema.parse(await response.json());

    expect(payload.anchors).toEqual({ remapped: [], orphaned: [] });
    expect(payload.doc.body).toBe("after the edit");
    const parsed = parseDocument(ws.read(created.path));
    expect(parsed.body).toBe("after the edit");
    expect(String(parsed.data["updated"]) > String(before)).toBe(true);
    expect(parsed.data["created"]).toBe(payload.doc.frontmatter.created);

    const row = ws.db
      .prepare("SELECT body_excerpt FROM documents WHERE id = ?")
      .get(created.id) as { body_excerpt: string };
    expect(row.body_excerpt).toBe("after the edit");
  });

  it("remaps an anchor when the edit lands above it, in the same commit as the body", async () => {
    anchored("update-above");
    const head = ws.head();

    const response = await ws.put("/api/docs/doc_mortgage", {
      body: ["A new opening paragraph.", "", BODY].join("\n"),
    });
    expect(response.status).toBe(200);
    const payload = UpdateDocResponseSchema.parse(await response.json());
    expect(payload.anchors.remapped).toEqual([ANCHOR]);
    expect(payload.anchors.orphaned).toEqual([]);

    const file = ws.read("data/docs/inbox/mortgage.md");
    const anchors = parseDocument(file).data["anchors"] as Record<
      string,
      { exact: string; prefix: string }
    >;
    expect(anchors[ANCHOR]?.exact).toBe(QUOTE);
    expect(file).toContain("A new opening paragraph.");

    // One commit, holding both the body change and the anchors change (§6).
    const commits = ws.git("log", "--format=%H", `${head}..HEAD`).trim().split("\n");
    expect(commits).toHaveLength(1);
    expect(ws.git("show", "--stat", "--format=", "HEAD").trim()).toContain(
      "data/docs/inbox/mortgage.md",
    );
    // Both halves of the save are inside that one commit's diff.
    const diff = ws.git("show", "HEAD");
    expect(diff).toContain("A new opening paragraph.");
    expect(diff).toContain("prefix:");
  });

  it("rewrites exact when the edit lands inside the anchored range", async () => {
    anchored("update-inside");

    const edited = BODY.replace(QUOTE, "The rate is fixed for seven whole years.");
    const response = await ws.put("/api/docs/doc_mortgage", { body: edited });
    const payload = UpdateDocResponseSchema.parse(await response.json());
    expect(payload.anchors.remapped).toEqual([ANCHOR]);

    const anchors = parseDocument(ws.read("data/docs/inbox/mortgage.md")).data["anchors"] as Record<
      string,
      { exact: string }
    >;
    expect(anchors[ANCHOR]?.exact).toContain("seven whole years");

    const read = await ws.request("/api/docs/doc_mortgage");
    const doc = DocSchema.parse(await read.json());
    expect(doc.anchors[0]?.orphaned).toBe(false);
    expect(doc.anchors[0]?.range).not.toBeNull();
  });

  it("orphans the anchor when its text is deleted, keeping the selector byte-identical", async () => {
    anchored("update-delete");
    const before = anchorsBlock(ws.read("data/docs/inbox/mortgage.md"));

    const response = await ws.put("/api/docs/doc_mortgage", {
      body: ["Intro paragraph.", "", "Closing paragraph."].join("\n"),
    });
    const payload = UpdateDocResponseSchema.parse(await response.json());
    expect(payload.anchors.orphaned).toEqual([ANCHOR]);
    expect(payload.anchors.remapped).toEqual([]);

    expect(anchorsBlock(ws.read("data/docs/inbox/mortgage.md"))).toBe(before);
    // The thread file is untouched and still listed.
    expect(ws.read("data/threads/th_rate0001.md")).toBe(THREAD_DOC);
    const row = ws.db.prepare("SELECT id FROM threads WHERE id = 'th_rate0001'").get();
    expect(row).toBeDefined();
  });

  it("reconciles against the on-disk body, not a client-supplied one", async () => {
    anchored("update-out-of-band");
    const outOfBand = `${ANCHORED_DOC}\nAn out-of-band paragraph.\n`;
    ws.write("data/docs/inbox/mortgage.md", outOfBand);

    const response = await ws.put("/api/docs/doc_mortgage", {
      title: "Mortgage options, revised",
    });
    expect(response.status).toBe(200);

    const file = ws.read("data/docs/inbox/mortgage.md");
    expect(file).toContain("An out-of-band paragraph.");
    expect(parseDocument(file).data["title"]).toBe("Mortgage options, revised");
  });

  it("treats a reviewed-only patch as a review, not an edit", async () => {
    anchored("update-reviewed");
    const before = parseDocument(ws.read("data/docs/inbox/mortgage.md")).data["updated"];

    ws.advance(120_000);
    const response = await ws.put("/api/docs/doc_mortgage", {
      reviewed: "2026-07-27T09:02:00Z",
    });
    expect(response.status).toBe(200);

    const parsed = parseDocument(ws.read("data/docs/inbox/mortgage.md"));
    expect(parsed.data["reviewed"]).toBe("2026-07-27T09:02:00Z");
    expect(parsed.data["updated"]).toBe(before);
  });

  it("writes, commits and announces nothing for a no-op save", async () => {
    anchored("update-noop");
    const head = ws.head();
    const before = ws.read("data/docs/inbox/mortgage.md");
    const frames: unknown[] = [];
    const off = ws.server.bus.subscribe((keys) => frames.push(keys));

    const onDisk = parseDocument(before).body;
    for (const body of [{}, { title: "Mortgage options", body: onDisk, evergreen: false }]) {
      const response = await ws.put("/api/docs/doc_mortgage", body);
      expect(response.status).toBe(200);
      const payload = UpdateDocResponseSchema.parse(await response.json());
      expect(payload.anchors).toEqual({ remapped: [], orphaned: [] });
    }

    off();
    expect(ws.read("data/docs/inbox/mortgage.md")).toBe(before);
    expect(ws.head()).toBe(head);
    expect(frames).toEqual([]);
  });

  // Wall-clock concurrency tests: ~3s alone, and full-suite parallelism can push
  // them past vitest's 5s default. The generous timeout tolerates load; the
  // assertions still catch serialization regressions (SERVER-023's adjudicated
  // pattern for load-sensitive tests).
  it("serializes concurrent saves and chains them correctly", { timeout: 20_000 }, async () => {
    anchored("update-concurrent");

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        ws.put("/api/docs/doc_mortgage", { tags: [`marker-${index}`] }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));

    const parsed = parseDocument(ws.read("data/docs/inbox/mortgage.md"));
    expect(parsed.data["id"]).toBe("doc_mortgage");
    expect(Array.isArray(parsed.data["tags"])).toBe(true);
    // The anchor never detached: every save reconciled against the previous
    // save's on-disk result rather than a stale snapshot.
    const anchors = parsed.data["anchors"] as Record<string, { exact: string }>;
    expect(anchors[ANCHOR]?.exact).toBe(QUOTE);
    expect(ws.git("status", "--porcelain").includes(".tmp-")).toBe(false);
  });

  it(
    "appends markers from ten parallel body saves without losing one",
    { timeout: 20_000 },
    async () => {
      ws = createWriteWorkspace("update-parallel-body");
      ws.reproject();
      const created = await createDoc(ws, { type: "note", title: "Parallel", body: "start" });

      // Read-modify-write per request, serialized by the per-document mutex: each
      // save sees the previous one's bytes on disk.
      for (let index = 0; index < 10; index += 1) {
        const current = parseDocument(ws.read(created.path)).body;
        await ws.put(`/api/docs/${created.id}`, { body: `${current}\nmarker-${index}` });
      }
      const body = parseDocument(ws.read(created.path)).body;
      for (let index = 0; index < 10; index += 1) {
        expect(body).toContain(`marker-${index}`);
      }
    },
  );

  it("404s an unknown id and 400s a malformed one", async () => {
    ws = createWriteWorkspace("update-ids");
    ws.reproject();

    const missing = await ws.put("/api/docs/doc_zzzzzzzz", { body: "x" });
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { code: string }).toMatchObject({ code: "not_found" });

    const malformed = await ws.put("/api/docs/not-an-id", { body: "x" });
    expect(malformed.status).toBe(400);
    const body = (await malformed.json()) as { code: string; issues: unknown[] };
    expect(body.code).toBe("bad_request");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("rejects an invalid status and an invalid due date with issues", async () => {
    ws = createWriteWorkspace("update-invalid");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Invalid" });

    for (const patch of [{ status: "nonsense" }, { due: "not-a-date" }]) {
      const response = await ws.put(`/api/docs/${created.id}`, patch);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { code: string; issues: unknown[] };
      expect(body.code).toBe("bad_request");
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });
});

// SERVER-039 (wave-3 audit FIX 5). `PUT` writes frontmatter and nothing else,
// so `status: open` on an archived skill reported success while the folder sat
// in `.claude/skills-archived/` — disabled, invisible to Claude Code, still
// holding its name. `corpus doc edit` refused it (CLI-017); the UI's frontmatter
// form and `curl` did not, and the server is the sole writer.
describe("PUT /api/docs/{id} — leaving `archived` is the unarchive route's job", () => {
  const SKILL = ["---", "name: demo", "description: A demo skill.", "---", "", "Do it.", ""].join(
    "\n",
  );

  /** An archived skill: real folder, moved by the real route. */
  async function archivedSkill(prefix: string): Promise<string> {
    ws = createWriteWorkspace(prefix);
    ws.write(".claude/skills/demo/SKILL.md", SKILL);
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skill");
    ws.reproject();
    const row = ws.db.prepare("SELECT id FROM documents WHERE type = 'skill'").get() as {
      id: string;
    };
    const archived = await ws.post(`/api/docs/${row.id}/archive`, {});
    expect(archived.status).toBe(200);
    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
    return row.id;
  }

  const issues = async (response: Response): Promise<{ path: string; message: string }[]> =>
    ((await response.json()) as { issues: { path: string; message: string }[] }).issues;

  it("refuses the status that would leave the document half-restored, and writes nothing", async () => {
    const skillId = await archivedSkill("update-unarchive-put");
    const before = ws.head();

    const response = await ws.put(`/api/docs/${skillId}`, { status: "open" });
    expect(response.status).toBe(400);
    const [issue] = await issues(response);
    expect(issue?.path).toBe("body.status");
    expect(issue?.message).toContain(`/api/docs/${skillId}/unarchive`);

    // Nothing moved: not the file, not the folder, not the history.
    expect(ws.read(".claude/skills-archived/demo/SKILL.md")).toContain("status: archived");
    expect(ws.exists(".claude/skills/demo")).toBe(false);
    expect(ws.head()).toBe(before);
  });

  it("refuses every status that is not `archived`, not only `open`", async () => {
    const skillId = await archivedSkill("update-unarchive-resolved");
    const response = await ws.put(`/api/docs/${skillId}`, { status: "resolved" });
    expect(response.status).toBe(400);
    expect((await issues(response))[0]?.message).toContain("is archived");
  });

  it("leaves the archive route working, in both directions", async () => {
    const skillId = await archivedSkill("update-unarchive-route");

    const restored = await ws.post(`/api/docs/${skillId}/unarchive`, {});
    expect(restored.status).toBe(200);
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
    expect(ws.read(".claude/skills/demo/SKILL.md")).toContain("status: open");

    const rearchived = await ws.post(`/api/docs/${skillId}/archive`, {});
    expect(rearchived.status).toBe(200);
    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
  });

  it("still lets a PUT archive a document, and lets an archived one be edited", async () => {
    ws = createWriteWorkspace("update-archive-put");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Retiring" });

    // Into `archived` is unchanged: for a note it is exactly what the archive
    // route does, and it is the path SERVER-018's `mayChangeTree` is about.
    const archived = await ws.put(`/api/docs/${created.id}`, { status: "archived" });
    expect(archived.status).toBe(200);
    expect(parseDocument(ws.read(created.path)).data["status"]).toBe("archived");

    // Re-sending the same status is a no-op, not a refusal — it is what an
    // autosave of an untouched frontmatter form does.
    const again = await ws.put(`/api/docs/${created.id}`, { status: "archived" });
    expect(again.status).toBe(200);

    // And an archived document stays editable in every other respect.
    const edited = await ws.put(`/api/docs/${created.id}`, {
      title: "Retired",
      body: "Still writable.",
    });
    expect(edited.status).toBe(200);
    expect(ws.read(created.path)).toContain("Still writable.");
    expect(parseDocument(ws.read(created.path)).data["status"]).toBe("archived");
  });

  it("refuses on the projected status of a skill whose frontmatter disagrees", async () => {
    // A `SKILL.md` under `.claude/skills-archived/` is projected `archived`
    // whatever its own frontmatter says (SPEC.md §7), and that row is what the
    // client saw before it sent the patch.
    ws = createWriteWorkspace("update-unarchive-row");
    ws.write(".claude/skills-archived/demo/SKILL.md", SKILL);
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed an archived skill");
    ws.reproject();
    const row = ws.db.prepare("SELECT id, status FROM documents WHERE type = 'skill'").get() as {
      id: string;
      status: string;
    };
    expect(row.status).toBe("archived");

    const response = await ws.put(`/api/docs/${row.id}`, { status: "resolved" });
    expect(response.status).toBe(400);
    expect((await issues(response))[0]?.path).toBe("body.status");
  });
});

describe("squash-on-idle, through the API", () => {
  it("folds two rapid saves into one commit and starts a fresh one past the window", async () => {
    ws = createWriteWorkspace("squash-http");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Session", body: "start" });
    const afterCreate = ws.head();

    ws.advance(100);
    await ws.put(`/api/docs/${created.id}`, { body: "edit one" });
    ws.advance(100);
    await ws.put(`/api/docs/${created.id}`, { body: "edit one\nedit two" });

    // Sprint-005 Open Conflict 5's adjudication: a create followed by an edit
    // inside the idle window **folds** — "create the document, type into it" is
    // one editing session by SPEC.md §4's own framing. So all three saves are
    // one commit.
    expect(ws.head()).not.toBe(afterCreate);
    expect(ws.git("log", "--format=%s", `${afterCreate}~1..HEAD`).trim().split("\n")).toHaveLength(
      1,
    );
    // …and it is labelled by the last verb folded into it, not the first: a
    // subject frozen at the session's opening save would describe content the
    // session has since rewritten (SERVER-005 eval, "Notes for the record" 1).
    expect(ws.log("%s")[0]).toContain("doc edit: Session");
    expect(ws.git("show", `HEAD:${created.path}`)).toContain("edit two");

    ws.advance(SQUASH_IDLE_MS);
    await ws.put(`/api/docs/${created.id}`, { body: "a later session" });
    const subjects = ws.log("%s");
    // The newest window is still open, so it still carries its last verb; the
    // one that went quiet closed as the new save landed and says what it was —
    // §4's "a window that closes with no act to name says so" (SERVER-091).
    expect(subjects[0]).toContain("doc edit: Session");
    expect(subjects[1]).toBe("editing session: 1 document by user");
    expect(subjects[2]).toContain("seed the workspace");
  });

  it("does not fold across actors", async () => {
    ws = createWriteWorkspace("squash-http-actors");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Two hands", body: "start" });

    ws.advance(100);
    await ws.put(`/api/docs/${created.id}`, { body: "by the user" }, { "x-corpus-author": "user" });
    ws.advance(100);
    await ws.put(
      `/api/docs/${created.id}`,
      { body: "by the agent" },
      { "x-corpus-author": "agent" },
    );

    const authors = ws.log("%an");
    expect(authors[0]).toBe("agent");
    expect(authors[1]).toBe("user");
  });
});
