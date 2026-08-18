import { DocSchema, UpdateDocResponseSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { SQUASH_IDLE_MS } from "../git/index.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace, putDoc } from "./write-fixture.js";

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
    const response = await putDoc(ws, created.id, { body: "after the edit" });
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

    const response = await putDoc(ws, "doc_mortgage", {
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
    const response = await putDoc(ws, "doc_mortgage", { body: edited });
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

    const response = await putDoc(ws, "doc_mortgage", {
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

    const response = await putDoc(ws, "doc_mortgage", {
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
    const response = await putDoc(ws, "doc_mortgage", {
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
      const response = await putDoc(ws, "doc_mortgage", body);
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
        putDoc(ws, "doc_mortgage", { tags: [`marker-${index}`] }),
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
        await putDoc(ws, created.id, { body: `${current}\nmarker-${index}` });
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

    // A well-formed key on a document that does not exist: SPEC.md §7's key
    // question never arises, so the answer is the 404 and never a 409.
    const missing = await ws.put("/api/docs/doc_zzzzzzzz", { body: "x", key: "0".repeat(64) });
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { code: string }).toMatchObject({ code: "not_found" });

    const malformed = await ws.put("/api/docs/not-an-id", { body: "x", key: "0".repeat(64) });
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
      const response = await putDoc(ws, created.id, patch);
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

    const response = await putDoc(ws, skillId, { status: "open" });
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
    const response = await putDoc(ws, skillId, { status: "resolved" });
    expect(response.status).toBe(400);
    expect((await issues(response))[0]?.message).toContain("is archived");
  });

  it("leaves the archive route working, in both directions", async () => {
    const skillId = await archivedSkill("update-unarchive-route");

    const restored = await ws.post(`/api/docs/${skillId}/unarchive`, {});
    expect(restored.status).toBe(200);
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
    // The route restores `resolved` (SPEC.md §5, SERVER-108) — which is also
    // why `PUT` refuses *every* status above rather than only `open`: the one
    // door that leaves `archived` is this one, and it decides where to land.
    expect(ws.read(".claude/skills/demo/SKILL.md")).toContain("status: resolved");

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
    const archived = await putDoc(ws, created.id, { status: "archived" });
    expect(archived.status).toBe(200);
    expect(parseDocument(ws.read(created.path)).data["status"]).toBe("archived");

    // Re-sending the same status is a no-op, not a refusal — it is what an
    // autosave of an untouched frontmatter form does.
    const again = await putDoc(ws, created.id, { status: "archived" });
    expect(again.status).toBe(200);

    // And an archived document stays editable in every other respect.
    const edited = await putDoc(ws, created.id, {
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

    const response = await putDoc(ws, row.id, { status: "resolved" });
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
    await putDoc(ws, created.id, { body: "edit one" });
    ws.advance(100);
    await putDoc(ws, created.id, { body: "edit one\nedit two" });

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
    await putDoc(ws, created.id, { body: "a later session" });
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
    await putDoc(ws, created.id, { body: "by the user" }, { "x-corpus-author": "user" });
    ws.advance(100);
    await putDoc(ws, created.id, { body: "by the agent" }, { "x-corpus-author": "agent" });

    const authors = ws.log("%an");
    expect(authors[0]).toBe("agent");
    expect(authors[1]).toBe("user");
  });
});

// SPEC.md §7, its own example: "A write that names its own delta does **not**
// need one — adding a tag … Those say what they change, so they **merge with
// whatever else happened** rather than overwriting it."
//
// That sentence was true of `POST /api/docs/bulk`'s `tag` act and false here
// (SERVER-102, found by PR #43's review), because the single-document route
// offered only `tags` — the whole set. A caller that meant to add one tag had to
// read the list, merge it and send the result, and two such callers lose a tag.
// Every case below issues **both writes before awaiting either**: the point is
// the concurrency, not the arithmetic.
describe("PUT /api/docs/{id} — a tag delta merges rather than overwrites", () => {
  const tagged = async (id: string): Promise<string[]> => {
    const response = await ws.request(`/api/docs/${id}`);
    const doc = (await response.json()) as { frontmatter: { tags: string[] } };
    return doc.frontmatter.tags;
  };

  it("keeps both tags when two writers add one each at the same time", async () => {
    ws = createWriteWorkspace("tag-delta-race");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Estate", body: "one\n" });

    const [first, second] = await Promise.all([
      putDoc(ws, created.id, { addTags: ["alpha"] }),
      putDoc(ws, created.id, { addTags: ["beta"] }),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect([...(await tagged(created.id))].sort()).toEqual(["alpha", "beta"]);
    // And on disk, which is the source of truth §5 names — not only in the row.
    expect(ws.read(created.path)).toContain("alpha");
    expect(ws.read(created.path)).toContain("beta");
  });

  // The same two writers, spelling the same intent the only way this route used
  // to allow. It still loses a tag, which is why the delta had to exist: the fix
  // is a wire shape, and this case is what proves that rather than a guard.
  it("loses one when the same two writers each send a whole set they computed", async () => {
    ws = createWriteWorkspace("tag-set-race");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Estate", body: "one\n" });

    // Both read the same list — the read-then-write every client-side merge is.
    const before = await tagged(created.id);
    await Promise.all([
      putDoc(ws, created.id, { tags: [...before, "alpha"] }),
      putDoc(ws, created.id, { tags: [...before, "beta"] }),
    ]);

    expect(await tagged(created.id)).toHaveLength(1);
  });

  it("merges a removal against the file too, not against what the caller last read", async () => {
    ws = createWriteWorkspace("tag-delta-remove");
    ws.reproject();
    const created = await createDoc(ws, {
      type: "note",
      title: "Estate",
      body: "one\n",
      tags: ["draft", "housing"],
    });

    await Promise.all([
      putDoc(ws, created.id, { removeTags: ["draft"] }),
      putDoc(ws, created.id, { addTags: ["reviewed-2026"] }),
    ]);

    expect([...(await tagged(created.id))].sort()).toEqual(["housing", "reviewed-2026"]);
  });

  it("resolves a tag named in both lists as a removal, exactly as the bulk act does", async () => {
    ws = createWriteWorkspace("tag-delta-both");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Estate", tags: ["a"] });

    await putDoc(ws, created.id, { addTags: ["b"], removeTags: ["b", "a"] });

    expect(await tagged(created.id)).toEqual([]);
  });

  it("writes nothing when the delta asks for what the document already carries", async () => {
    ws = createWriteWorkspace("tag-delta-noop");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Estate", tags: ["housing"] });
    ws.advance(SQUASH_IDLE_MS);
    const head = ws.head();

    const response = await putDoc(ws, created.id, {
      addTags: ["housing"],
      removeTags: ["absent"],
    });

    expect(response.status).toBe(200);
    // No commit, so no `updated` re-stamp either: §7's no-op, not a save.
    expect(ws.head()).toBe(head);
  });

  it("needs no key — it is the write §7 holds up as the canonical keyless one", async () => {
    ws = createWriteWorkspace("tag-delta-keyless");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Estate", body: "one\n" });

    const response = await ws.put(`/api/docs/${created.id}`, { addTags: ["housing"] });

    expect(response.status).toBe(200);
    expect(await tagged(created.id)).toEqual(["housing"]);
  });

  it("refuses a request that both states the set and changes it", async () => {
    ws = createWriteWorkspace("tag-delta-contradiction");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Estate", tags: ["a"] });

    const response = await ws.put(`/api/docs/${created.id}`, {
      tags: ["a", "b"],
      addTags: ["c"],
    });

    expect(response.status).toBe(400);
    // Nothing was written: a refusal is never a half-applied edit.
    expect(await tagged(created.id)).toEqual(["a"]);
  });
});

/**
 * SERVER-123's regression, found by PR #49's third review.
 *
 * The Claude Code frontmatter requirement rode `frontmatter-invalid`, which
 * blocks a save — so the release made every hand-authored `.claude/agents/*.md`
 * that had never carried a `description` unwritable by every verb at once. That
 * is not a hypothetical state: SERVER-123 measured that such a file produces no
 * listing and no warning, so nothing has ever told its author to add one, and
 * `docs/workspace-template.md` documents that directory as where a user drops
 * personas. The only repair was a flag the error text does not name and the
 * board editor cannot express.
 *
 * These are the four surfaces the review named, against the file in the state a
 * workspace holds it in today.
 */
describe("a hand-authored profile keeps working after the requirement lands", () => {
  const PROFILE = ["---", "name: reviewer", "---", "", "You review changes.", ""].join("\n");

  /** The file as it exists on disk in a workspace upgraded past the release. */
  function handAuthored(name: string, frontmatter = "name: reviewer"): WriteWorkspace {
    ws = createWriteWorkspace(name);
    ws.write(".claude/agents/reviewer.md", PROFILE.replace("name: reviewer", frontmatter));
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed a hand-authored profile");
    ws.reproject();
    return ws;
  }

  const profileId = (): string =>
    (
      ws.db
        .prepare("SELECT id FROM documents WHERE path = ?")
        .get(".claude/agents/reviewer.md") as {
        id: string;
      }
    ).id;

  it("is still editable through the board editor's save", async () => {
    handAuthored("profile-editable");
    const id = profileId();

    const response = await putDoc(ws, id, { body: "You review changes, sharply." });

    expect(response.status).toBe(200);
    expect(parseDocument(ws.read(".claude/agents/reviewer.md")).body).toBe(
      "You review changes, sharply.",
    );
  });

  it("is still archivable", async () => {
    handAuthored("profile-archivable");

    const response = await ws.post(`/api/docs/${profileId()}/archive`, {});

    expect(response.status).toBe(200);
  });

  it("is still reachable by a bulk act", async () => {
    handAuthored("profile-bulk");

    const response = await ws.post("/api/docs/bulk", {
      entries: [{ id: profileId(), action: { action: "archive" } }],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ refused: [] });
  });

  // §7:399's promise is the point of SERVER-123 and survives the fix untouched:
  // the save stopped refusing the finding, not producing it.
  it("is still reported by `corpus doc check`", async () => {
    handAuthored("profile-still-reported");

    const response = await ws.post("/api/check", { ids: [profileId()] });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      errors: [{ code: "frontmatter-invalid", path: ".claude/agents/reviewer.md" }],
    });
  });

  // The repair the error text should have named, through the one route that can
  // write these fields. It must not be refused by the `name` fault standing
  // beside it — which is why the guard below judges only what a patch *adds*.
  it("accepts the repair even while another field is still faulty", async () => {
    handAuthored("profile-repair", "description: Reviews changes.");
    const id = profileId();

    const response = await ws.put(`/api/docs/${id}`, {
      extra: { name: "reviewer" },
    });

    expect(response.status).toBe(200);
    const parsed = parseDocument(ws.read(".claude/agents/reviewer.md"));
    expect(parsed.data["name"]).toBe("reviewer");
    const checked = await ws.post("/api/check", { ids: [id] });
    expect(await checked.json()).toMatchObject({ ok: true, errors: [] });
  });

  // What the save path no longer refuses, this route still does — because these
  // are the caller's own values, exactly as on create. One file at two addresses
  // is the second divergence SERVER-123 closed, and it stays closed.
  it("refuses a patch that would give a good profile a second address", async () => {
    ws = createWriteWorkspace("profile-name-divergence");
    ws.reproject();
    const created = await createDoc(ws, { type: "agent-def", title: "Archivist" });

    const response = await ws.put(`/api/docs/${created.id}`, {
      extra: { name: "numbers" },
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { issues: { path: string; message: string }[] };
    expect(payload.issues.map((issue) => issue.path)).toEqual(["body.extra.name"]);
    expect(payload.issues[0]?.message).toContain("@archivist");
    expect(parseDocument(ws.read(created.path)).data["name"]).toBe("archivist");
  });

  // The case review 3's guard could not see, because it compared issue sets
  // keyed on the field name: `name` was faulty before *and* after, so nothing
  // looked introduced and the write manufactured the second divergence — one
  // file loadable by Claude Code as `numbers` and resolved by Corpus as
  // `@reviewer`. The comparison is per-field values now, so the fault the patch
  // writes is refused whatever the field carried before.
  it("refuses a patch that trades one fault on a field for a different one", async () => {
    handAuthored("profile-refault-name", "description: Reviews changes.");
    const id = profileId();

    const response = await ws.put(`/api/docs/${id}`, { extra: { name: "numbers" } });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { issues: { path: string; message: string }[] };
    expect(payload.issues.map((issue) => issue.path)).toEqual(["body.extra.name"]);
    expect(payload.issues[0]?.message).toContain("@reviewer");
    // Nothing was written: the file still carries no `name` at all, and the
    // check still reports the one fault it had before the request.
    expect(parseDocument(ws.read(".claude/agents/reviewer.md")).data["name"]).toBeUndefined();
    const checked = await ws.post("/api/check", { ids: [id] });
    expect(await checked.json()).toMatchObject({
      ok: false,
      errors: [{ detail: expect.stringContaining("name: missing") as string }],
    });
  });

  // The same trade in the other direction: a `name` that is already wrong may
  // not be swapped for a differently wrong one.
  it("refuses a patch that replaces a wrong name with another wrong name", async () => {
    handAuthored("profile-rename-wrong", "name: numbers\ndescription: Reviews changes.");

    const response = await ws.put(`/api/docs/${profileId()}`, { extra: { name: "digits" } });

    expect(response.status).toBe(400);
    expect(parseDocument(ws.read(".claude/agents/reviewer.md")).data["name"]).toBe("numbers");
  });

  // Requirement the narrowness exists for, in its hardest form: the field being
  // repaired is not the faulty one, and the faulty one is left standing.
  it("accepts a description repair on a profile whose name stays wrong", async () => {
    handAuthored("profile-describe-wrong-name", "name: numbers");
    const id = profileId();

    const response = await ws.put(`/api/docs/${id}`, {
      extra: { description: "Reviews changes, sharply." },
    });

    expect(response.status).toBe(200);
    const parsed = parseDocument(ws.read(".claude/agents/reviewer.md")).data;
    expect(parsed["description"]).toBe("Reviews changes, sharply.");
    expect(parsed["name"]).toBe("numbers");
    const checked = await ws.post("/api/check", { ids: [id] });
    expect(await checked.json()).toMatchObject({
      ok: false,
      errors: [{ detail: expect.stringContaining("is not the filename") as string }],
    });
  });

  // Why the comparison is on values and not on the keys the patch names: the
  // board's autosave re-sends `extra` wholesale, so a document whose stored
  // `name` is wrong must not have every save refused for echoing its own bytes.
  it("accepts a save that echoes a faulty field back unchanged", async () => {
    handAuthored("profile-echo-fault", "name: numbers\ndescription: Reviews changes.");

    const response = await ws.put(`/api/docs/${profileId()}`, {
      extra: { name: "numbers", description: "Reviews changes." },
    });

    expect(response.status).toBe(200);
    expect(parseDocument(ws.read(".claude/agents/reviewer.md")).data["name"]).toBe("numbers");
  });

  it("refuses a patch that would blank a description the file had", async () => {
    ws = createWriteWorkspace("profile-blank-description");
    ws.reproject();
    const created = await createDoc(ws, { type: "agent-def", title: "Archivist" });

    const response = await ws.put(`/api/docs/${created.id}`, {
      extra: { description: "   " },
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { issues: { path: string }[] };
    expect(payload.issues.map((issue) => issue.path)).toEqual(["body.extra.description"]);
  });
});
