import { DocMutationResponseSchema, DocSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
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
