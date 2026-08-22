// Template pre-fill, at the unit boundary (`findTemplate`) and on the wire
// (`POST /api/docs`).
//
// The rule under test is one sentence of SPEC.md §9.2 — "body pre-filled from
// the type's `template` document when one exists and no body is given" — and
// the regression that made it worth its own suite: the seeded note template
// carries `evergreen: true` (seed documents never go stale), and copying the
// template's own frontmatter onto the instance handed every note created from
// it `evergreen: true`, silently opting the corpus out of §5's staleness ramp.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";
import { findTemplate } from "./templates.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const start = (name: string): WriteWorkspace => {
  ws = createWriteWorkspace(name);
  ws.reproject();
  return ws;
};

/**
 * A template document whose *own* frontmatter is deliberately hostile: every
 * field a create could inherit is set to the opposite of the server default,
 * plus a key the schema has never heard of.
 */
const loadedTemplate = (forType: string, body: string): string =>
  [
    "---",
    "id: doc_tmplnote",
    "type: template",
    "title: Note template",
    "created: 2026-07-01T00:00:00Z",
    "updated: 2026-07-01T00:00:00Z",
    "tags: [seed, housekeeping]",
    "status: resolved",
    "anchors: {}",
    "due: 2026-01-01",
    "reviewed: 2026-07-01T00:00:00Z",
    "evergreen: true",
    "column: research",
    `for: ${forType}`,
    "---",
    "",
    body,
    "",
  ].join("\n");

describe("findTemplate", () => {
  it("returns the template's body and nothing else", () => {
    start("tmpl-body-only");
    ws.write("data/docs/templates/note.md", loadedTemplate("note", "## Considerations"));
    ws.reproject();

    const found = findTemplate(ws.root, ws.db, "note");
    expect(found).not.toBeNull();
    expect(found?.path).toBe("data/docs/templates/note.md");
    expect(found?.body.trim()).toBe("## Considerations");
    // The whole shape: a path and a body. There is no frontmatter channel for a
    // template's own housekeeping to travel through.
    expect(Object.keys(found ?? {}).sort()).toEqual(["body", "path"]);
  });

  it("returns null for a type with no template, and never for `template` itself", () => {
    start("tmpl-absent");
    ws.write("data/docs/templates/note.md", loadedTemplate("note", "NOTE"));
    ws.write(
      "data/docs/templates/meta.md",
      loadedTemplate("template", "META").replace("id: doc_tmplnote", "id: doc_tmplmeta"),
    );
    ws.reproject();

    expect(findTemplate(ws.root, ws.db, "view")).toBeNull();
    // `for: template` would make creating a template start from a template —
    // the one self-referential loop the mechanism refuses rather than follows.
    expect(findTemplate(ws.root, ws.db, "template")).toBeNull();
  });

  it("skips archived templates, and the first match by path wins", () => {
    start("tmpl-skips");
    ws.write(
      "data/docs/templates/a-archived.md",
      loadedTemplate("note", "ARCHIVED")
        .replace("id: doc_tmplnote", "id: doc_tmplarch")
        .replace("status: resolved", "status: archived"),
    );
    ws.write(
      "data/docs/templates/b-good.md",
      loadedTemplate("note", "GOOD").replace("id: doc_tmplnote", "id: doc_tmplgood"),
    );
    ws.write(
      "data/docs/templates/c-later.md",
      loadedTemplate("note", "LATER").replace("id: doc_tmplnote", "id: doc_tmpllatr"),
    );
    ws.reproject();

    expect(findTemplate(ws.root, ws.db, "note")?.body.trim()).toBe("GOOD");
  });

  it("skips a template that has become unparseable since it was projected", () => {
    start("tmpl-corrupt-race");
    ws.write(
      "data/docs/templates/a-corrupt.md",
      loadedTemplate("note", "CORRUPT").replace("id: doc_tmplnote", "id: doc_tmplcrpt"),
    );
    ws.write(
      "data/docs/templates/b-good.md",
      loadedTemplate("note", "GOOD").replace("id: doc_tmplnote", "id: doc_tmplgood"),
    );
    ws.reproject();

    // The real shape of this race: projection only ever holds rows for files it
    // could parse, so a template becomes an unreadable *candidate* by being
    // corrupted out-of-band after projection and before the watcher catches up.
    // An unterminated frontmatter block is what a half-finished editor save
    // leaves behind.
    ws.write(
      "data/docs/templates/a-corrupt.md",
      "---\nid: doc_tmplcrpt\ntype: template\nfor: note",
    );

    // Not a candidate, not an error: the create falls through to the next
    // template rather than failing because an unrelated file is broken.
    expect(findTemplate(ws.root, ws.db, "note")?.body.trim()).toBe("GOOD");
  });

  it("skips a template whose file has been deleted since it was projected", () => {
    start("tmpl-enoent-race");
    ws.write(
      "data/docs/templates/a-gone.md",
      loadedTemplate("note", "GONE").replace("id: doc_tmplnote", "id: doc_tmplgone"),
    );
    ws.write(
      "data/docs/templates/b-good.md",
      loadedTemplate("note", "GOOD").replace("id: doc_tmplnote", "id: doc_tmplgood"),
    );
    ws.reproject();
    rmSync(join(ws.root, "data", "docs", "templates", "a-gone.md"));

    // SERVER-022 finding 6: the row outlives its file for the width of the
    // watcher's debounce, and the ENOENT escaped as a 500 on an unrelated
    // create — a template being deleted is not a reason to refuse a `note`.
    expect(findTemplate(ws.root, ws.db, "note")?.body.trim()).toBe("GOOD");
  });
});

describe("POST /api/docs — template pre-fill", () => {
  it("takes the template's body and none of its frontmatter", async () => {
    start("tmpl-create-body-only");
    ws.write(
      "data/docs/templates/note.md",
      loadedTemplate("note", "## Considerations\n\nWhat matters here."),
    );
    ws.reproject();

    const created = await createDoc(ws, { type: "note", title: "Prefilled" });
    const file = ws.read(created.path);
    expect(file).toContain("## Considerations");
    expect(file).toContain("What matters here.");

    const parsed = parseDocument(file, created.path);
    // Every documented server default, against a template that set all of them
    // to something else (SPEC.md §9.2 / `CreateDocRequestSchema`).
    expect(parsed.data["tags"]).toEqual([]);
    expect(parsed.data["status"]).toBe("open");
    expect(parsed.data["due"]).toBeNull();
    expect(parsed.data["reviewed"]).toBeNull();
    expect(parsed.data["evergreen"]).toBe(false);
    // The server's own identity fields are never the template's.
    expect(parsed.data["id"]).toBe(created.id);
    expect(parsed.data["title"]).toBe("Prefilled");
    expect(parsed.data["type"]).toBe("note");
    // Neither the template's selector nor any other key it declared rides along.
    expect(parsed.data["for"]).toBeUndefined();
    expect(parsed.data["column"]).toBeUndefined();
  });

  it("regression: an `evergreen: true` template does not make its instances evergreen", async () => {
    start("tmpl-evergreen-regression");
    // Byte-for-byte the shape `corpus init` seeds: a template that opts *itself*
    // out of staleness, because a seed document never goes stale.
    ws.write(
      "data/docs/templates/note.md",
      [
        "---",
        "id: doc_seedtemplatenote",
        "type: template",
        "title: Note template",
        "created: 2026-07-26T00:00:00Z",
        "updated: 2026-07-26T00:00:00Z",
        "tags: []",
        "status: open",
        "anchors: {}",
        "evergreen: true",
        "for: note",
        "---",
        "",
        "## Context",
        "",
        "## Notes",
        "",
        "## Open questions",
        "",
      ].join("\n"),
    );
    ws.reproject();

    const created = await createDoc(ws, { type: "note", title: "Repro Evergreen" });

    // On the wire…
    const doc = created.body["frontmatter"] as Record<string, unknown>;
    expect(doc["evergreen"]).toBe(false);
    // …in the file…
    expect(parseDocument(ws.read(created.path), created.path).data["evergreen"]).toBe(false);
    // …and in the projection, which is what the staleness ramp reads.
    const row = ws.db.prepare("SELECT evergreen FROM documents WHERE id = ?").get(created.id) as
      { evergreen: number } | undefined;
    expect(row?.evergreen).toBe(0);
    // The body is still the template's — the fix removes a carry-over, not the
    // feature.
    expect(ws.read(created.path)).toContain("## Open questions");
  });

  it("still honours a request that asks for the non-default values", async () => {
    start("tmpl-request-wins");
    ws.write("data/docs/templates/note.md", loadedTemplate("note", "TEMPLATE BODY"));
    ws.reproject();

    const created = await createDoc(ws, {
      type: "note",
      title: "Explicit fields",
      tags: ["mine"],
      status: "resolved",
      due: "2027-03-04",
      evergreen: true,
    });

    const parsed = parseDocument(ws.read(created.path), created.path);
    expect(parsed.data["tags"]).toEqual(["mine"]);
    expect(parsed.data["status"]).toBe("resolved");
    expect(parsed.data["due"]).toBe("2027-03-04");
    expect(parsed.data["evergreen"]).toBe(true);
    // A body was not given, so the template's still applies.
    expect(parsed.body.trim()).toBe("TEMPLATE BODY");
  });

  it("pre-fills only when the body is omitted — an empty string is a body", async () => {
    start("tmpl-only-when-omitted");
    ws.write("data/docs/templates/note.md", loadedTemplate("note", "TEMPLATE BODY"));
    ws.reproject();

    const explicit = await createDoc(ws, {
      type: "note",
      title: "Explicit",
      body: "Only my words.",
    });
    expect(ws.read(explicit.path)).toContain("Only my words.");
    expect(ws.read(explicit.path)).not.toContain("TEMPLATE BODY");

    // `""` is a supplied body — the caller said "empty", not "surprise me".
    const blank = await createDoc(ws, { type: "note", title: "Blank", body: "" });
    expect(parseDocument(ws.read(blank.path), blank.path).body.trim()).toBe("");
    expect(ws.read(blank.path)).not.toContain("TEMPLATE BODY");
  });

  it("creates without pre-fill when the only template vanished under the projection", async () => {
    start("tmpl-enoent-create");
    ws.write("data/docs/templates/note.md", loadedTemplate("note", "TEMPLATE BODY"));
    ws.reproject();
    // Deleted out of band, and the create is issued before the watcher has
    // re-projected — the row is still there, the file is not.
    rmSync(join(ws.root, "data", "docs", "templates", "note.md"));

    const created = await createDoc(ws, { type: "note", title: "Raced" });

    expect(created.body["body"]).toBe("");
    expect(parseDocument(ws.read(created.path), created.path).body.trim()).toBe("");
    expect(created.warnings).toEqual([]);
  });

  it("creates an empty-bodied document for a type with no template", async () => {
    start("tmpl-none");
    ws.write("data/docs/templates/note.md", loadedTemplate("note", "TEMPLATE BODY"));
    ws.reproject();

    // A `view` has no template here: SPEC.md §10 makes "none → empty" an
    // ordinary outcome, never an error.
    const created = await createDoc(ws, { type: "view", title: "No template" });
    expect(created.body["body"]).toBe("");
    expect(parseDocument(ws.read(created.path), created.path).body.trim()).toBe("");
    expect(ws.read(created.path)).not.toContain("TEMPLATE BODY");
  });
});
