import { DocMutationResponseSchema, DocSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { MENTION_TYPE, resolveMentionTarget } from "../threads/mentions.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const start = (name: string): WriteWorkspace => {
  ws = createWriteWorkspace(name);
  ws.reproject();
  return ws;
};

const templateDoc = (forType: string, body: string, extra = ""): string =>
  [
    "---",
    "id: doc_tmplnote",
    "type: template",
    "title: Note template",
    "created: 2026-07-01T00:00:00Z",
    "updated: 2026-07-01T00:00:00Z",
    "tags: []",
    "status: open",
    "anchors: {}",
    "due: null",
    "reviewed: null",
    "evergreen: false",
    `for: ${forType}`,
    ...(extra === "" ? [] : [extra]),
    "---",
    "",
    body,
    "",
  ].join("\n");

describe("POST /api/docs", () => {
  it("lands a minimal create in the inbox with a stamped frontmatter block", async () => {
    start("create-minimal");

    const response = await ws.post("/api/docs", { type: "note", title: "Mortgage options" });
    expect(response.status).toBe(201);
    const payload = await response.json();
    const { doc, warnings } = DocMutationResponseSchema.parse(payload);

    expect(doc.path).toBe("data/docs/inbox/mortgage-options.md");
    expect(doc.frontmatter.id).toMatch(/^doc_[a-z2-7]{8}$/);
    expect(doc.frontmatter).toMatchObject({
      type: "note",
      title: "Mortgage options",
      tags: [],
      status: "open",
      anchors: {},
      due: null,
      reviewed: null,
      evergreen: false,
      origin: null,
    });
    expect(doc.frontmatter.created).toBe(doc.frontmatter.updated);
    // TEST-45's clean half: a mutation with nothing wrong still declares the
    // field, as an empty array rather than by omitting it.
    expect(warnings).toEqual([]);

    const parsed = parseDocument(ws.read(doc.path), doc.path);
    expect(parsed.data["id"]).toBe(doc.frontmatter.id);
    expect(parsed.data["status"]).toBe("open");
    expect(parsed.data["anchors"]).toEqual({});
  });

  it("defaults the folder to inbox and accepts both folder spellings", async () => {
    start("create-folders");

    const inbox = await createDoc(ws, { type: "note", title: "Alpha" });
    const bare = await createDoc(ws, { type: "note", title: "Beta", folder: "finance" });
    const full = await createDoc(ws, {
      type: "note",
      title: "Gamma",
      folder: "data/docs/finance",
    });

    expect(inbox.path).toBe("data/docs/inbox/alpha.md");
    expect(bare.path).toBe("data/docs/finance/beta.md");
    expect(full.path).toBe("data/docs/finance/gamma.md");
  });

  // The pre-fill rule has its own suite in `templates.test.ts`; this case holds
  // the create path's end of it — a template contributes its body, and the
  // frontmatter block is the request plus the server defaults (SPEC.md §9.2).
  it("pre-fills the body from the matching template, and only the body", async () => {
    start("create-template");
    ws.write(
      "data/docs/templates/note.md",
      templateDoc("note", "## Considerations\n\nWhat matters here.", "column: research"),
    );
    ws.reproject();

    const created = await createDoc(ws, { type: "note", title: "Prefilled" });
    const file = ws.read(created.path);
    expect(file).toContain("## Considerations");
    expect(file).toContain("What matters here.");

    const parsed = parseDocument(file, created.path);
    expect(parsed.data["column"]).toBeUndefined();
    // The server's own identity fields are never the template's.
    expect(parsed.data["id"]).toBe(created.id);
    expect(parsed.data["title"]).toBe("Prefilled");
    expect(parsed.data["type"]).toBe("note");
    expect(parsed.data["for"]).toBeUndefined();
  });

  it("prefers an explicit body, and a missing template is not an error", async () => {
    start("create-body");
    ws.write("data/docs/templates/note.md", templateDoc("note", "TEMPLATE BODY"));
    ws.reproject();

    const explicit = await createDoc(ws, {
      type: "note",
      title: "Explicit",
      body: "Only my words.",
    });
    expect(ws.read(explicit.path)).toContain("Only my words.");
    expect(ws.read(explicit.path)).not.toContain("TEMPLATE BODY");

    const viewResponse = await ws.post("/api/docs", { type: "view", title: "No template" });
    expect(viewResponse.status).toBe(201);
    const view = DocMutationResponseSchema.parse(await viewResponse.json()).doc;
    expect(view.body).toBe("");
  });

  it("selects templates deterministically and refuses the self-referential loop", async () => {
    start("create-template-order");
    ws.write("data/docs/templates/b-second.md", templateDoc("note", "SECOND"));
    ws.write(
      "data/docs/templates/a-first.md",
      templateDoc("note", "FIRST").replace("id: doc_tmplnote", "id: doc_tmplfrst"),
    );
    ws.write(
      "data/docs/templates/aa-archived.md",
      templateDoc("note", "ARCHIVED")
        .replace("id: doc_tmplnote", "id: doc_tmplarch")
        .replace("status: open", "status: archived"),
    );
    ws.write(
      "data/docs/templates/meta.md",
      templateDoc("template", "META").replace("id: doc_tmplnote", "id: doc_tmplmeta"),
    );
    ws.reproject();

    for (const title of ["One", "Two", "Three"]) {
      const created = await createDoc(ws, { type: "note", title });
      expect(ws.read(created.path)).toContain("FIRST");
      expect(ws.read(created.path)).not.toContain("ARCHIVED");
    }

    const template = await createDoc(ws, { type: "template", title: "New template" });
    expect(ws.read(template.path)).not.toContain("META");
  });

  it("dedupes slug collisions instead of overwriting", async () => {
    start("create-collision");

    const first = await createDoc(ws, { type: "note", title: "Mortgage options", body: "one" });
    const second = await createDoc(ws, { type: "note", title: "Mortgage options", body: "two" });
    const third = await createDoc(ws, { type: "note", title: "Mortgage options", body: "three" });

    expect([first.path, second.path, third.path]).toEqual([
      "data/docs/inbox/mortgage-options.md",
      "data/docs/inbox/mortgage-options-2.md",
      "data/docs/inbox/mortgage-options-3.md",
    ]);
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(ws.read(first.path)).toContain("one");

    const counted = ws.db
      .prepare("SELECT COUNT(*) AS n FROM documents WHERE title = 'Mortgage options'")
      .get() as { n: number };
    expect(counted.n).toBe(3);
  });

  it("produces a usable filename for pathological titles", async () => {
    start("create-titles");
    const titles = ["🎉🎉🎉", "x".repeat(400), "!!!???...", "é́́"];

    const created = [];
    for (const title of titles) {
      created.push(await createDoc(ws, { type: "note", title }));
    }

    const names = created.map((doc) => doc.path.split("/").at(-1) ?? "");
    for (const name of names) {
      expect(name.length).toBeGreaterThan(3);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(ws.exists(`data/docs/inbox/${name}`)).toBe(true);
    }
    expect(new Set(names).size).toBe(titles.length);
    expect(new Set(created.map((doc) => doc.id)).size).toBe(titles.length);
  });

  it("refuses path traversal in folder before writing anything", async () => {
    start("create-traversal");
    const before = ws.git("status", "--porcelain");
    const head = ws.head();

    for (const folder of ["../..", "/etc", "data/docs/../../.."]) {
      const response = await ws.post("/api/docs", { type: "note", title: "Escape", folder });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { code: string; issues: unknown[] };
      expect(body.code).toBe("bad_request");
      expect(body.issues.length).toBeGreaterThan(0);
    }

    expect(ws.git("status", "--porcelain")).toBe(before);
    expect(ws.head()).toBe(head);
    expect(ws.exists("data/docs/inbox")).toBe(true);
  });

  // SERVER-037. Pre-fix, each of these folders was accepted: the file was
  // written, auto-committed, and then the read-back answered
  // `404 no document with id doc_…` because the projection skips the path — a
  // document in the audit trail that no read surface can ever show.
  it("refuses a folder the projection would never index, before writing anything", async () => {
    start("create-unindexable-folder");
    const before = ws.git("status", "--porcelain");
    const head = ws.head();

    for (const folder of [".claude/skills", ".foo", "notes/.hidden/x", "node_modules"]) {
      const response = await ws.post("/api/docs", { type: "note", title: "Invisible", folder });
      expect(response.status, folder).toBe(400);
      const body = (await response.json()) as {
        code: string;
        issues: { path: string; message: string }[];
      };
      expect(body.code, folder).toBe("bad_request");
      expect(
        body.issues.map((issue) => issue.path),
        folder,
      ).toContain("folder");
    }

    // Nothing written, nothing committed, nothing indexed: the refusal happens
    // at validation, ahead of the write pipeline, so there is nothing to undo.
    expect(ws.git("status", "--porcelain")).toBe(before);
    expect(ws.head()).toBe(head);
    expect(ws.exists("data/docs/.claude")).toBe(false);
    expect(ws.exists("data/docs/node_modules")).toBe(false);
    expect(ws.exists("data/docs/notes")).toBe(false);
    expect(
      ws.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE title = ?").get("Invisible"),
    ).toEqual({ n: 0 });
  });

  // The other half of SERVER-037: a dot that does not *lead* a segment is an
  // ordinary character, and a folder carrying one must still walk the whole
  // write → commit → project → read round trip.
  it("accepts folders that merely resemble the refused shapes, end to end", async () => {
    start("create-dotted-folders");

    for (const folder of ["my.notes", "v1.2", "notes/2026.07", "a.b/c.d", "finance/2026"]) {
      const created = await createDoc(ws, { type: "note", title: "Legal", folder });
      expect(created.path.startsWith(`data/docs/${folder}/`), folder).toBe(true);
      expect(ws.exists(created.path), folder).toBe(true);

      const row = ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(created.id) as
        { path: string } | undefined;
      expect(row?.path, folder).toBe(created.path);

      const response = await ws.request(`/api/docs/${created.id}`);
      expect(response.status, folder).toBe(200);
      expect(DocSchema.parse(await response.json()).frontmatter.id, folder).toBe(created.id);
      expect(
        ws.log("%s").some((subject) => subject.includes(created.id)),
        folder,
      ).toBe(true);
    }
  });

  // SERVER-122. Pre-fix every one of these landed under `data/docs/` — a
  // persona filed in the user's inbox, looking like a note. The assertions are
  // on the **path**: "creation succeeded" passes against the bug.
  describe("SPEC.md §7's agent-def root", () => {
    it("files an agent-def in .claude/agents/ when no folder is named", async () => {
      start("create-agent-def-default");

      const created = await createDoc(ws, {
        type: "agent-def",
        title: "Researcher",
        body: "You research.",
      });

      expect(created.path).toBe(".claude/agents/researcher.md");
      expect(ws.exists(".claude/agents/researcher.md")).toBe(true);
      expect(ws.exists("data/docs/inbox/researcher.md")).toBe(false);

      // Projected under the root's own type, and readable in the same breath
      // (§9.1's read-your-write): no watcher, no polling.
      const row = ws.db.prepare("SELECT path, type FROM documents WHERE id = ?").get(created.id);
      expect(row).toEqual({ path: ".claude/agents/researcher.md", type: "agent-def" });

      const read = await ws.request(`/api/docs/${created.id}`);
      expect(read.status).toBe(200);
      expect(DocSchema.parse(await read.json()).path).toBe(".claude/agents/researcher.md");

      // The write went through the one pipeline, so it is in the audit trail.
      expect(ws.log("%s").some((subject) => subject.includes(created.id))).toBe(true);
      expect(ws.git("status", "--porcelain")).toBe("");
    });

    it("accepts the root named outright, and refuses a type it does not hold", async () => {
      start("create-agent-def-named");

      const named = await createDoc(ws, {
        type: "agent-def",
        title: "Summarizer",
        folder: ".claude/agents",
      });
      expect(named.path).toBe(".claude/agents/summarizer.md");

      const mismatched = await ws.post("/api/docs", {
        type: "note",
        title: "Not a persona",
        folder: ".claude/agents",
      });
      expect(mismatched.status).toBe(400);
      const body = (await mismatched.json()) as {
        code: string;
        issues: { path: string }[];
      };
      expect(body.code).toBe("bad_request");
      expect(body.issues.map((issue) => issue.path)).toContain("folder");
      expect(ws.exists(".claude/agents/not-a-persona.md")).toBe(false);
    });

    // §10: "creating a new skill or subagent document instantly makes it
    // autocompletable — there is no separate registry". `resolveMentionTarget`
    // is the lookup both `@<name>` (§8) and a designation (§7) make, so this is
    // the same answer the mention parser and the designate route would give.
    it("resolves as @<name> and designates, the same as a hand-authored one", async () => {
      start("create-agent-def-mention");

      const created = await createDoc(ws, { type: "agent-def", title: "Researcher" });

      const target = resolveMentionTarget(ws.db, MENTION_TYPE, "researcher");
      expect(target).toEqual({ name: "researcher", docId: created.id, status: "open" });
      // Case-insensitively, and by title too — nothing about this document is a
      // special case of the mention index.
      expect(resolveMentionTarget(ws.db, MENTION_TYPE, "Researcher")?.docId).toBe(created.id);

      const thread = await ws.post("/api/threads", {
        title: "Planning",
        body: "Kick-off.",
        requestsAgent: false,
      });
      expect(thread.status).toBe(201);
      const threadId = ((await thread.json()) as { thread: { id: string } }).thread.id;

      const designated = await ws.post(`/api/threads/${threadId}/resident`, {
        name: "researcher",
      });
      expect(designated.status).toBe(200);
      expect(JSON.stringify(await designated.json())).toContain(created.id);
    });

    // In this root the filename is the address, so `-2` would hand back a
    // persona nobody asked for while `@researcher` went on meaning the older
    // document. Under `data/docs/` the dedupe is unchanged (see the suite above).
    it("refuses a name already taken instead of deduping it", async () => {
      start("create-agent-def-collision");

      const first = await createDoc(ws, { type: "agent-def", title: "Researcher" });
      expect(first.path).toBe(".claude/agents/researcher.md");

      const head = ws.head();
      const again = await ws.post("/api/docs", { type: "agent-def", title: "Researcher" });
      expect(again.status).toBe(400);
      const body = (await again.json()) as { code: string; issues: { path: string }[] };
      expect(body.code).toBe("bad_request");
      expect(body.issues.map((issue) => issue.path)).toContain("title");

      expect(ws.exists(".claude/agents/researcher-2.md")).toBe(false);
      expect(ws.head()).toBe(head);
      expect(ws.git("status", "--porcelain")).toBe("");
    });

    // The escape hatch: `type: agent-def` under `data/docs/` is a document
    // *about* a persona, which `invocableName` already contemplates for skills
    // — and it is what every document misfiled before this issue is. Nothing
    // moves them, and it stays a document in every way: created, projected under
    // the type it declares, readable and writable.
    //
    // What it is **not** is addressable (SERVER-125). It used to resolve by its
    // title, which made it a persona on every surface except the one that
    // matters — Claude Code loads nothing from here, and `claudeCodeFields`
    // writes it no `name`/`description` to be loaded by. A document about a
    // thing is not the thing.
    it("keeps an explicitly foldered agent-def under data/docs, addressable by nothing", async () => {
      start("create-agent-def-misfiled");

      const misfiled = await createDoc(ws, {
        type: "agent-def",
        title: "Legacy",
        folder: "inbox",
      });
      expect(misfiled.path).toBe("data/docs/inbox/legacy.md");

      const row = ws.db.prepare("SELECT type FROM documents WHERE id = ?").get(misfiled.id);
      expect(row).toEqual({ type: "agent-def" });
      expect(resolveMentionTarget(ws.db, MENTION_TYPE, "Legacy")).toBeNull();
      expect(resolveMentionTarget(ws.db, MENTION_TYPE, "legacy")).toBeNull();
    });

    // §5's canonical block is *waived* under this root, never absent: the file
    // carries a minted `doc_*` id like every other created document — a
    // synthetic, path-derived one would change the moment the file was renamed
    // — and Claude Code's own discovery keys ride in beside it, which is what
    // §7 means by "the two sets coexist in the same YAML block".
    it("stamps a real id and carries Claude Code's keys beside the core block", async () => {
      start("create-agent-def-frontmatter");

      const created = await createDoc(ws, {
        type: "agent-def",
        title: "Researcher",
        body: "You research.",
        extra: { name: "researcher", description: "Digs through the corpus." },
      });

      expect(created.path).toBe(".claude/agents/researcher.md");
      expect(created.id).toMatch(/^doc_[a-z2-7]{8}$/);
      const parsed = parseDocument(ws.read(created.path), created.path);
      expect(parsed.data["id"]).toBe(created.id);
      expect(parsed.data["type"]).toBe("agent-def");
      expect(parsed.data["name"]).toBe("researcher");
      expect(parsed.data["description"]).toBe("Digs through the corpus.");

      // Sprint-013 Adjudication 6: what the write path accepted, the checker
      // must not refuse.
      const checked = await ws.post("/api/check", {
        documents: [{ path: created.path, content: ws.read(created.path) }],
      });
      expect(checked.status).toBe(200);
      const report = (await checked.json()) as { errors: { code: string; path: string }[] };
      expect(report.errors).toEqual([]);
    });
  });

  // SERVER-123. Pre-fix the create wrote Corpus's frontmatter and none of
  // Claude Code's, so `--type agent-def` produced a persona Corpus would
  // happily designate and Claude Code silently would not load — measured
  // against a real session in all four combinations, only both-present loads.
  describe("SPEC.md §7's Claude Code frontmatter", () => {
    const PROFILE_DESCRIPTION =
      "Reach for this when a question is about the shape of an argument rather than its facts.";

    const post = async (
      body: Record<string, unknown>,
    ): Promise<{ status: number; issues: { path: string; message: string }[] }> => {
      const response = await ws.post("/api/docs", body);
      const payload = (await response.json()) as {
        issues?: { path: string; message: string }[];
      };
      return { status: response.status, issues: payload.issues ?? [] };
    };

    // §10's creation is zero-form — "a type and a title are the whole
    // requirement, and everything else the server fills in" — and the CLI has no
    // `--extra` on create, so a hard requirement would make `--type agent-def` a
    // verb that always fails. Thin, and loadable, is the point.
    it("fills in a description from the title when the caller sends none", async () => {
      start("create-agent-def-default-description");

      const created = await createDoc(ws, { type: "agent-def", title: "Archivist" });

      expect(created.path).toBe(".claude/agents/archivist.md");
      const parsed = parseDocument(ws.read(created.path), created.path);
      expect(parsed.data["name"]).toBe("archivist");
      expect(parsed.data["description"]).toBe("Archivist");

      // The whole point: nothing this route writes can fail the check that
      // reports an unloadable profile (sprint-013 Adjudication 6).
      const checked = await ws.post("/api/check", { ids: [created.id] });
      expect(await checked.json()).toMatchObject({ ok: true, errors: [] });
    });

    // An *explicitly* empty description is a caller naming the field and asking
    // for something Claude Code cannot use; substituting the title would answer
    // a question it did not ask.
    it("refuses an explicitly empty description rather than defaulting it", async () => {
      start("create-agent-def-blank-description");

      const refused = await post({
        type: "agent-def",
        title: "Archivist",
        extra: { description: "   " },
      });

      expect(refused.status).toBe(400);
      expect(refused.issues.map((issue) => issue.path)).toEqual(["extra.description"]);
      // Not merely "a field is absent": what it costs is the finding.
      expect(refused.issues[0]?.message).toContain("Claude Code loads a subagent only when");
      // Nothing was written, committed, or projected.
      expect(ws.exists(".claude/agents/archivist.md")).toBe(false);
      expect(ws.git("status", "--porcelain")).toBe("");
    });

    // `name` is not caller data: `.claude/agents/<stem>.md` is what makes
    // `@<stem>` resolve, so the only correct value is the stem.
    it("derives `name` from the filename the create allocated", async () => {
      start("create-agent-def-derives-name");

      const created = await createDoc(ws, {
        type: "agent-def",
        title: "The Archivist",
        extra: { description: PROFILE_DESCRIPTION },
      });

      expect(created.path).toBe(".claude/agents/the-archivist.md");
      const parsed = parseDocument(ws.read(created.path), created.path);
      expect(parsed.data["name"]).toBe("the-archivist");
      expect(parsed.data["description"]).toBe(PROFILE_DESCRIPTION);
      // Claude Code's two keys lead the block, as the shipped skills do.
      expect(Object.keys(parsed.data).slice(0, 2)).toEqual(["name", "description"]);
    });

    // The second divergence: one file at two addresses, with no error anywhere.
    it("refuses a caller-supplied `name` that disagrees with the filename", async () => {
      start("create-agent-def-name-divergence");

      const refused = await post({
        type: "agent-def",
        title: "Bareprofile",
        extra: { name: "numbers", description: PROFILE_DESCRIPTION },
      });

      expect(refused.status).toBe(400);
      expect(refused.issues.map((issue) => issue.path)).toEqual(["extra.name"]);
      expect(refused.issues[0]?.message).toContain("@bareprofile");
      expect(refused.issues[0]?.message).toContain("numbers");
      expect(ws.exists(".claude/agents/bareprofile.md")).toBe(false);
    });

    it("accepts a caller-supplied `name` that agrees with it", async () => {
      start("create-agent-def-name-agrees");

      const created = await createDoc(ws, {
        type: "agent-def",
        title: "Bareprofile",
        extra: { name: "bareprofile", description: PROFILE_DESCRIPTION },
      });

      expect(created.path).toBe(".claude/agents/bareprofile.md");
      expect(parseDocument(ws.read(created.path), created.path).data["name"]).toBe("bareprofile");
    });

    // The rule follows the *root*, not the type: a `type: agent-def` filed
    // under `data/docs/` is a document about a persona, and Claude Code never
    // looks there, so nothing is required of it.
    it("asks nothing of a type: agent-def document filed under data/docs", async () => {
      start("create-agent-def-docs-root");

      const misfiled = await createDoc(ws, {
        type: "agent-def",
        title: "About Personas",
        folder: "inbox",
      });

      expect(misfiled.path).toBe("data/docs/inbox/about-personas.md");
      expect(parseDocument(ws.read(misfiled.path), misfiled.path).data["name"]).toBeUndefined();
    });

    it("asks nothing of an ordinary note", async () => {
      start("create-agent-def-note-untouched");

      const note = await createDoc(ws, { type: "note", title: "Ordinary" });
      const parsed = parseDocument(ws.read(note.path), note.path);
      expect(parsed.data["name"]).toBeUndefined();
      expect(parsed.data["description"]).toBeUndefined();
    });
  });

  it("is readable immediately, with no polling", async () => {
    start("create-read-your-write");
    const created = await createDoc(ws, { type: "note", title: "Immediate" });

    const response = await ws.request(`/api/docs/${created.id}`);
    expect(response.status).toBe(200);
    const doc = DocSchema.parse(await response.json());
    expect(doc.frontmatter.id).toBe(created.id);

    const row = ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(created.id) as
      { path: string } | undefined;
    expect(row?.path).toBe(created.path);
  });
});
