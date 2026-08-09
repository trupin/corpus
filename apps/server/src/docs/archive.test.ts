import { chmodSync } from "node:fs";
import { join } from "node:path";
import { DocListSchema, DocMutationResponseSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { createThread } from "../threads/thread-fixture.js";
import { createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";

let ws: WriteWorkspace;

afterEach(() => {
  ws.close();
});

const SKILL = [
  "---",
  "name: demo",
  "description: A demonstration skill.",
  "---",
  "",
  "# Demo skill",
  "",
  "Do the thing.",
  "",
].join("\n");

/** A workspace with a real skill folder — `SKILL.md` plus siblings — projected. */
function withSkill(name: string): { skillId: string } {
  ws = createWriteWorkspace(name);
  ws.write(".claude/skills/demo/SKILL.md", SKILL);
  ws.write(".claude/skills/demo/reference.md", "# Reference\n\nDetails.\n");
  ws.write(".claude/skills/demo/run.sh", "#!/bin/sh\necho demo\n");
  ws.git("add", "-A", "--", ".claude");
  ws.git("commit", "-m", "seed the skill");
  ws.reproject();
  const row = ws.db.prepare("SELECT id FROM documents WHERE type = 'skill'").get() as {
    id: string;
  };
  return { skillId: row.id };
}

const NESTED_SKILL = [
  "---",
  "name: nested",
  "description: A skill inside another skill's folder.",
  "---",
  "",
  "# Nested skill",
  "",
  "Do the other thing.",
  "",
].join("\n");

/** Outer skill folder with a second `SKILL.md` nested inside it, projected. */
function withNestedSkill(name: string): { outer: string; nested: string } {
  ws = createWriteWorkspace(name);
  ws.write(".claude/skills/demo/SKILL.md", SKILL);
  ws.write(".claude/skills/demo/reference.md", "# Reference\n\nDetails.\n");
  ws.write(".claude/skills/demo/nested/SKILL.md", NESTED_SKILL);
  ws.git("add", "-A", "--", ".claude");
  ws.git("commit", "-m", "seed the skills");
  ws.reproject();
  return {
    outer: idAt(".claude/skills/demo/SKILL.md"),
    nested: idAt(".claude/skills/demo/nested/SKILL.md"),
  };
}

const idAt = (path: string): string =>
  (ws.db.prepare("SELECT id FROM documents WHERE path = ?").get(path) as { id: string } | undefined)
    ?.id ?? "";

const pathOf = (id: string): string =>
  (ws.db.prepare("SELECT path FROM documents WHERE id = ?").get(id) as { path: string } | undefined)
    ?.path ?? "";

const list = async (query: string): Promise<string[]> => {
  const response = await ws.request(`/api/docs${query}`);
  const payload = DocListSchema.parse(await response.json());
  return payload.items.map((item) => item.id);
};

describe("archive and unarchive", () => {
  it("flips status and keeps the document indexed", async () => {
    ws = createWriteWorkspace("archive-status");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Retiring" });

    const archived = await ws.post(`/api/docs/${created.id}/archive`, {});
    expect(archived.status).toBe(200);
    expect(DocMutationResponseSchema.parse(await archived.json()).doc.frontmatter.status).toBe(
      "archived",
    );
    expect(parseDocument(ws.read(created.path)).data["status"]).toBe("archived");
    expect(await list("?status=archived")).toContain(created.id);
    expect(await list("")).not.toContain(created.id);

    const restored = await ws.post(`/api/docs/${created.id}/unarchive`, {});
    expect(restored.status).toBe(200);
    expect(DocMutationResponseSchema.parse(await restored.json()).doc.frontmatter.status).toBe(
      "open",
    );
    expect(parseDocument(ws.read(created.path)).data["status"]).toBe("open");
    expect(await list("")).toContain(created.id);
    expect(await list("?status=archived")).not.toContain(created.id);
  });

  it("moves a skill's whole folder and keeps its id and index entry", async () => {
    const { skillId } = withSkill("archive-skill");

    const response = await ws.post(`/api/docs/${skillId}/archive`, {});
    expect(response.status).toBe(200);

    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo/reference.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo/run.sh")).toBe(true);
    expect(ws.exists(".claude/skills/demo")).toBe(false);

    expect(await list("?type=skill&status=archived")).toEqual([skillId]);
    // The synthetic id is derived from the path, so the archive stamps it into
    // the file — otherwise the move would silently mint a different document.
    expect(parseDocument(ws.read(".claude/skills-archived/demo/SKILL.md")).data["id"]).toBe(
      skillId,
    );
    // git records it as a rename of the whole folder.
    const stat = ws.git("show", "--stat", "--format=", "HEAD");
    expect(stat).toContain("skills");
    expect(stat).toContain("skills-archived");
    expect(stat).toContain("SKILL.md");
  });

  it("reverses the folder move exactly on unarchive", async () => {
    const { skillId } = withSkill("archive-skill-round-trip");
    await ws.post(`/api/docs/${skillId}/archive`, {});
    ws.advance(60_000);

    const response = await ws.post(`/api/docs/${skillId}/unarchive`, {});
    expect(response.status).toBe(200);
    const doc = DocMutationResponseSchema.parse(await response.json()).doc;
    expect(doc.frontmatter.status).toBe("open");
    expect(doc.frontmatter.id).toBe(skillId);

    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills/demo/reference.md")).toBe(true);
    expect(ws.exists(".claude/skills/demo/run.sh")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo")).toBe(false);
    expect(await list("?type=skill")).toEqual([skillId]);
  });

  it("refuses to overwrite a file already at the destination and modifies neither side", async () => {
    const { skillId } = withSkill("archive-skill-conflict");
    ws.write(".claude/skills-archived/demo/SKILL.md", "---\nname: older\n---\n\nAn older copy.\n");
    ws.advance(60_000);
    const head = ws.head();
    const beforeSource = ws.read(".claude/skills/demo/SKILL.md");
    const beforeTarget = ws.read(".claude/skills-archived/demo/SKILL.md");

    const response = await ws.post(`/api/docs/${skillId}/archive`, {});
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; issues: { message: string }[] };
    expect(body.code).toBe("bad_request");
    expect(body.issues[0]?.message).toContain(".claude/skills-archived/demo");

    expect(ws.read(".claude/skills/demo/SKILL.md")).toBe(beforeSource);
    expect(ws.read(".claude/skills-archived/demo/SKILL.md")).toBe(beforeTarget);
    expect(ws.exists(".claude/skills/demo/reference.md")).toBe(true);
    expect(ws.head()).toBe(head);
  });

  it("is idempotent and never deletes", async () => {
    ws = createWriteWorkspace("archive-idempotent");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Repeatable" });

    for (const verb of ["archive", "archive", "unarchive", "unarchive"] as const) {
      ws.advance(60_000);
      const response = await ws.post(`/api/docs/${created.id}/${verb}`, {});
      expect(response.status).toBe(200);
      expect(ws.exists(created.path)).toBe(true);
    }
    expect(ws.git("log", "--diff-filter=D", "--format=%s", "--", created.path).trim()).toBe("");
  });
});

// SPEC.md §5 (an id is identity) meeting §7 (archiving a skill moves its whole
// folder). A `SKILL.md` with no `id:` of its own is projected under an id
// derived from its path, so a folder move silently re-mints every document
// underneath it — not only the one the caller named. Nothing reported it,
// because an id vanishing while another appears is exactly what a delete plus a
// create looks like from the projection's side (SERVER-078).
describe("a folder move carries identity, not only files", () => {
  it("keeps a nested skill's id across the archive and the unarchive", async () => {
    const { outer, nested } = withNestedSkill("archive-nested-id");

    expect((await ws.post(`/api/docs/${outer}/archive`, {})).status).toBe(200);

    expect(pathOf(nested)).toBe(".claude/skills-archived/demo/nested/SKILL.md");
    expect(idAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe(nested);
    // Stamped, which is what makes the id survive the *next* move as well —
    // the projection can only derive one from the path.
    expect(parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).data["id"]).toBe(
      nested,
    );

    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${outer}/unarchive`, {})).status).toBe(200);

    expect(pathOf(nested)).toBe(".claude/skills/demo/nested/SKILL.md");
    expect(idAt(".claude/skills/demo/nested/SKILL.md")).toBe(nested);
  });

  it("leaves a carried document's own fields alone — only the id is written", async () => {
    const { outer, nested } = withNestedSkill("archive-nested-fields");
    const before = parseDocument(ws.read(".claude/skills/demo/nested/SKILL.md"));

    await ws.post(`/api/docs/${outer}/archive`, {});

    const after = parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md"));
    expect(after.body).toBe(before.body);
    expect(after.data["name"]).toBe("nested");
    expect(after.data["description"]).toBe(before.data["description"]);
    // Not an edit of this document: `updated` would reset §5's staleness clock
    // for a change its author did not make, and `status` is the *root*'s to say
    // for a skill — writing one here would lie after the reverse move.
    expect(after.data["updated"]).toBeUndefined();
    expect(after.data["status"]).toBeUndefined();
    expect(after.data["id"]).toBe(nested);
  });

  it("keeps a [[ref]] and a parented thread resolving across the round trip", async () => {
    const { outer, nested } = withNestedSkill("archive-nested-references");
    const pointer = await createDoc(ws, {
      type: "note",
      title: "Pointer",
      body: `See [[${nested}]] for the details.`,
    });
    const thread = await createThread(ws, {
      parent: nested,
      selector: { exact: "Do the other thing.", prefix: "", suffix: "" },
      body: "Still needed?",
    });

    const linksTo = (): string[] =>
      ws.db
        .prepare("SELECT to_id FROM links WHERE from_id = ?")
        .all(pointer.id)
        .map((row) => (row as { to_id: string }).to_id);
    const parentOf = (id: string): string =>
      (ws.db.prepare("SELECT parent_id FROM threads WHERE id = ?").get(id) as { parent_id: string })
        .parent_id;
    const anchorOwners = (): string[] =>
      ws.db
        .prepare("SELECT doc_id FROM anchors WHERE anchor_id = ?")
        .all(thread.anchorId)
        .map((row) => (row as { doc_id: string }).doc_id);

    expect(linksTo()).toEqual([nested]);
    expect(parentOf(thread.id)).toBe(nested);
    expect(anchorOwners()).toEqual([nested]);

    for (const verb of ["archive", "unarchive"] as const) {
      ws.advance(60_000);
      expect((await ws.post(`/api/docs/${outer}/${verb}`, {})).status).toBe(200);
      // Every reference in §5's list points by id, so all three miss the moment
      // the id moves — and the pointer document is never even read by the act.
      expect(linksTo()).toEqual([nested]);
      expect(parentOf(thread.id)).toBe(nested);
      expect(anchorOwners()).toEqual([nested]);
    }
  });

  it("stamps nothing into a nested skill that already declares its own id", async () => {
    ws = createWriteWorkspace("archive-nested-declared-id");
    ws.write(".claude/skills/demo/SKILL.md", SKILL);
    ws.write(
      ".claude/skills/demo/nested/SKILL.md",
      ["---", "id: doc_declared1", "name: nested", "---", "", "Body.", ""].join("\n"),
    );
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skills");
    ws.reproject();
    const before = ws.read(".claude/skills/demo/nested/SKILL.md");

    await ws.post(`/api/docs/${idAt(".claude/skills/demo/SKILL.md")}/archive`, {});

    expect(idAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe("doc_declared1");
    // Byte-for-byte: an id it already carries needs no write, so the file is in
    // the commit as a pure rename.
    expect(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).toBe(before);
  });
});

// The order-dependent wedge: archiving the nested skill first created
// `.claude/skills-archived/demo/`, which then refused the outer skill's archive
// forever, recoverable only by moving a directory by hand (SERVER-078).
describe("a destination folder that exists is merged, not refused", () => {
  it("archives the outer skill after the nested one, in either order", async () => {
    const { outer, nested } = withNestedSkill("archive-nested-first");

    expect((await ws.post(`/api/docs/${nested}/archive`, {})).status).toBe(200);
    expect(ws.exists(".claude/skills-archived/demo/nested/SKILL.md")).toBe(true);

    ws.advance(60_000);
    const response = await ws.post(`/api/docs/${outer}/archive`, {});

    expect(response.status).toBe(200);
    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo/reference.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo/nested/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills/demo")).toBe(false);
    // The same two documents, under the same two ids, as archiving the outer
    // one first would have produced.
    expect(pathOf(outer)).toBe(".claude/skills-archived/demo/SKILL.md");
    expect(pathOf(nested)).toBe(".claude/skills-archived/demo/nested/SKILL.md");
  });

  it("merges past an empty directory an earlier round trip left behind", async () => {
    const { outer, nested } = withNestedSkill("archive-empty-leftover");
    await ws.post(`/api/docs/${nested}/archive`, {});
    ws.advance(60_000);
    await ws.post(`/api/docs/${nested}/unarchive`, {});
    // The nested skill went there and came back; the folder it needed is still
    // sitting at the destination, holding nothing.
    expect(ws.exists(".claude/skills-archived/demo")).toBe(true);

    ws.advance(60_000);
    const response = await ws.post(`/api/docs/${outer}/archive`, {});

    expect(response.status).toBe(200);
    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo/nested/SKILL.md")).toBe(true);
  });

  it("still refuses when a file at the destination would be overwritten, naming it", async () => {
    const { outer } = withNestedSkill("archive-merge-collision");
    // An unrelated archived skill of the same name: its own `SKILL.md` is
    // exactly the file the move would overwrite.
    ws.write(".claude/skills-archived/demo/nested/SKILL.md", "---\nname: other\n---\n\nOther.\n");
    ws.advance(60_000);
    const head = ws.head();

    const response = await ws.post(`/api/docs/${outer}/archive`, {});

    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { message: string }[] };
    expect(body.issues[0]?.message).toContain(".claude/skills-archived/demo/nested/SKILL.md");
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills/demo/nested/SKILL.md")).toBe(true);
    expect(ws.head()).toBe(head);
  });
});

describe("a merge that fails leaves the workspace as it found it", () => {
  it("restores the source folder when a file cannot be moved into the destination", async () => {
    const { outer, nested } = withNestedSkill("archive-merge-rollback");
    await ws.post(`/api/docs/${nested}/archive`, {});
    const head = ws.head();
    const before = ws.read(".claude/skills/demo/SKILL.md");
    // The destination exists and collides with nothing, so the move is planned
    // — and then cannot be applied, which is the only way into the unwind.
    chmodSync(join(ws.root, ".claude", "skills-archived", "demo"), 0o500);

    try {
      ws.advance(60_000);
      const response = await ws.post(`/api/docs/${outer}/archive`, {});
      expect(response.status).toBe(500);
    } finally {
      chmodSync(join(ws.root, ".claude", "skills-archived", "demo"), 0o700);
    }

    expect(ws.read(".claude/skills/demo/SKILL.md")).toBe(before);
    expect(ws.exists(".claude/skills/demo/reference.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(false);
    expect(ws.exists(".claude/skills-archived/demo/nested/SKILL.md")).toBe(true);
    expect(ws.head()).toBe(head);
  });
});

describe("what a carried document cannot be stamped with", () => {
  it("still moves a nested file the projection could not index", async () => {
    ws = createWriteWorkspace("archive-nested-unindexed");
    ws.write(".claude/skills/demo/SKILL.md", SKILL);
    // Frontmatter that cannot be parsed: no row, therefore no id to preserve.
    ws.write(".claude/skills/demo/nested/SKILL.md", "---\nname: [unclosed\n---\n\nBody.\n");
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skills");
    ws.reproject();
    const outer = idAt(".claude/skills/demo/SKILL.md");
    const before = ws.read(".claude/skills/demo/nested/SKILL.md");

    const response = await ws.post(`/api/docs/${outer}/archive`, {});

    expect(response.status).toBe(200);
    expect(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).toBe(before);
    expect(pathOf(outer)).toBe(".claude/skills-archived/demo/SKILL.md");
  });

  it("refuses when a directory it must move is a file at the destination", async () => {
    const { outer, nested } = withNestedSkill("archive-dir-over-file");
    await ws.post(`/api/docs/${nested}/unarchive`, {});
    ws.write(".claude/skills-archived/demo/nested", "not a directory\n");
    ws.advance(60_000);
    const head = ws.head();

    const response = await ws.post(`/api/docs/${outer}/archive`, {});

    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { message: string }[] };
    expect(body.issues[0]?.message).toContain(".claude/skills-archived/demo/nested");
    expect(ws.exists(".claude/skills/demo/nested/SKILL.md")).toBe(true);
    expect(ws.head()).toBe(head);
  });
});
