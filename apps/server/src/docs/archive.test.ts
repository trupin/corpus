import { chmodSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  ACTOR_HEADER,
  DocListSchema,
  DocMutationResponseSchema,
  type Warning,
} from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
import { createAutoCommitter, createGit } from "../git/index.js";
import { silentLogger } from "../logger.js";
import { createThread } from "../threads/thread-fixture.js";
import { carriedWarnings, planSetArchived, setArchived } from "./archive.js";
import { loadDocument } from "./read.js";
import { AUTH, createDoc, createWriteWorkspace, type WriteWorkspace } from "./write-fixture.js";
import { allowAllWrites, createDocumentMutex, type DocsWorkspace } from "./write.js";

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

const statusOf = (id: string): string =>
  (ws.db.prepare("SELECT status FROM documents WHERE id = ?").get(id) as { status: string }).status;

/** The verb's own workspace, for the cases that need the mutex or the guard. */
const docsWorkspace = (): DocsWorkspace => ({
  workspaceRoot: ws.root,
  projection: ws.db,
  git: createAutoCommitter({ git: createGit(ws.root), now: () => ws.clock }),
  selfWrites: ws.server.selfWrites,
  bus: ws.server.bus,
  logger: silentLogger,
  now: () => ws.clock,
  assertWritable: allowAllWrites,
});

const acquireLock = async (id: string, actor: "user" | "agent"): Promise<void> => {
  const response = await ws.server.app.request(`/api/locks/${id}`, {
    method: "POST",
    headers: { ...AUTH, [ACTOR_HEADER]: actor },
  });
  expect(response.status).toBe(201);
};

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

  it("stamps a carried skill whose declared id the contract cannot accept", async () => {
    ws = createWriteWorkspace("archive-nested-unusable-id");
    ws.write(".claude/skills/demo/SKILL.md", SKILL);
    // A *string* id, and therefore one the old rule left alone — but not one
    // `^(doc|th)_[A-Za-z0-9]+$` accepts, so the projection ignores it and the
    // row carries a path-derived id the move would re-mint (PR #38, finding 1).
    ws.write(
      ".claude/skills/demo/nested/SKILL.md",
      ["---", "id: my-nested-skill", "name: nested", "---", "", "Body.", ""].join("\n"),
    );
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skills");
    ws.reproject();
    const nested = idAt(".claude/skills/demo/nested/SKILL.md");

    expect(
      (await ws.post(`/api/docs/${idAt(".claude/skills/demo/SKILL.md")}/archive`, {})).status,
    ).toBe(200);

    expect(idAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe(nested);
    expect(parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).data["id"]).toBe(
      nested,
    );
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

// PR #38's review, finding 1: the two halves of SERVER-078's fix disagreed. The
// carried half stamped the row's id unconditionally; the requested half stamped
// only when the frontmatter carried no *string* `id` — so a `SKILL.md` declaring
// `id: my-skill`, which the contract's `^(doc|th)_[A-Za-z0-9]+$` rejects and the
// projection therefore replaces with a path-derived one, was written back
// unstamped and re-minted by the very move the stamp exists to survive. Worse,
// the id the caller sent no longer resolved afterwards, so the response was a
// `404` for a document whose folder had just moved and been committed.
describe("the requested document is stamped by the same rule as the carried ones", () => {
  const DECLARED = [
    "---",
    "id: my-skill",
    "name: demo",
    "description: A skill that declares an id the contract cannot accept.",
    "---",
    "",
    "# Demo skill",
    "",
  ].join("\n");

  const withUnusableId = (name: string): string => {
    ws = createWriteWorkspace(name);
    ws.write(".claude/skills/demo/SKILL.md", DECLARED);
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skill");
    ws.reproject();
    return idAt(".claude/skills/demo/SKILL.md");
  };

  it("keeps the id of a skill whose frontmatter declares an unusable one", async () => {
    const skillId = withUnusableId("archive-unusable-id");

    const response = await ws.post(`/api/docs/${skillId}/archive`, {});

    // Answered about the document the caller named, not a `404` for a document
    // the act itself re-minted out of existence.
    expect(response.status).toBe(200);
    expect(DocMutationResponseSchema.parse(await response.json()).doc.frontmatter.id).toBe(skillId);
    expect(pathOf(skillId)).toBe(".claude/skills-archived/demo/SKILL.md");
    expect(parseDocument(ws.read(".claude/skills-archived/demo/SKILL.md")).data["id"]).toBe(
      skillId,
    );
    expect((await ws.request(`/api/docs/${skillId}`)).status).toBe(200);
  });

  it("survives the unarchive round trip under the same id", async () => {
    const skillId = withUnusableId("archive-unusable-id-round-trip");
    await ws.post(`/api/docs/${skillId}/archive`, {});
    ws.advance(60_000);

    expect((await ws.post(`/api/docs/${skillId}/unarchive`, {})).status).toBe(200);

    expect(pathOf(skillId)).toBe(".claude/skills/demo/SKILL.md");
    expect(idAt(".claude/skills/demo/SKILL.md")).toBe(skillId);
  });

  it("writes no id into a document that already declares the row's own", async () => {
    ws = createWriteWorkspace("archive-note-untouched");
    ws.reproject();
    const created = await createDoc(ws, { type: "note", title: "Ordinary" });
    const before = parseDocument(ws.read(created.path));

    await ws.post(`/api/docs/${created.id}/archive`, {});

    // The rule is "the row's id", which an ordinary document already carries —
    // so the diff of an ordinary archive is still `status` and `updated`.
    const after = parseDocument(ws.read(created.path));
    expect(after.data["id"]).toBe(before.data["id"]);
    expect(after.data["title"]).toBe(before.data["title"]);
    expect(after.data["status"]).toBe("archived");
  });
});

// Finding 2: relaxing the merge made a §7-contradictory state reachable — a
// skill whose file sits in the *enabled* root while its row reads `archived`.
// §7 makes location the enablement, so the row must follow the file.
describe("a skill's frontmatter never contradicts the root it lands in", () => {
  it("reconciles a nested skill swept back to the enabled root by the outer unarchive", async () => {
    const { outer, nested } = withNestedSkill("archive-nested-status");

    // Archived on its own: this is what writes `status: archived` into the
    // nested skill's file.
    expect((await ws.post(`/api/docs/${nested}/archive`, {})).status).toBe(200);
    expect(
      parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).data["status"],
    ).toBe("archived");

    // The outer skill's archive merges the two folders …
    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${outer}/archive`, {})).status).toBe(200);
    // … and leaves the archived root's frontmatter alone: the root decides
    // status there, so the key is never consulted and never rewritten.
    expect(
      parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).data["status"],
    ).toBe("archived");

    // … and the unarchive brings both back, enabling the nested skill in Claude
    // Code again. The row has to say so.
    const stamped = parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).data[
      "updated"
    ];
    ws.advance(60_000);
    expect((await ws.post(`/api/docs/${outer}/unarchive`, {})).status).toBe(200);

    expect(pathOf(nested)).toBe(".claude/skills/demo/nested/SKILL.md");
    expect(parseDocument(ws.read(".claude/skills/demo/nested/SKILL.md")).data["status"]).toBe(
      "open",
    );
    expect(statusOf(nested)).toBe("open");
    expect(await list("?type=skill")).toContain(nested);
    expect(await list("?type=skill&status=archived")).not.toContain(nested);
    // The system's keys and nothing else: `updated` is still the instant this
    // document's *own* archive stamped, because §5's staleness clock is not a
    // neighbour's to reset.
    expect(parseDocument(ws.read(".claude/skills/demo/nested/SKILL.md")).data["updated"]).toBe(
      stamped,
    );
  });

  it("leaves an unrelated status on a carried document alone", async () => {
    ws = createWriteWorkspace("archive-carried-open-status");
    ws.write(".claude/skills/demo/SKILL.md", SKILL);
    ws.write(
      ".claude/skills/demo/nested/SKILL.md",
      ["---", "name: nested", "status: open", "---", "", "Body.", ""].join("\n"),
    );
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skills");
    ws.reproject();

    await ws.post(`/api/docs/${idAt(".claude/skills/demo/SKILL.md")}/archive`, {});

    // `open` under the archived root is not a contradiction — the root decides
    // there — so nothing is reconciled and the author's key survives.
    expect(
      parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).data["status"],
    ).toBe("open");
  });
});

// Finding 3: the carried stamp writes another document's file, so this verb owes
// that document what every other cross-document write here already gives it —
// its write lane for the act's whole length, and its lease consulted.
describe("a folder move holds the lanes and the leases of what it carries", () => {
  it("refuses when the other party holds a lease on a carried skill", async () => {
    const { outer, nested } = withNestedSkill("archive-carried-lock");
    await acquireLock(nested, "agent");
    const head = ws.head();

    const response = await ws.post(`/api/docs/${outer}/archive`, {}, { [ACTOR_HEADER]: "user" });

    expect(response.status).toBe(423);
    const body = (await response.json()) as { message: string; lock: { docId: string } };
    // Everything that names a document names the locked one, or a person clears
    // the lease on the skill they archived and nothing changes.
    expect(body.message).toContain(nested);
    expect(body.message).toContain("the lock to clear is");
    expect(body.lock.docId).toBe(nested);
    expect(ws.exists(".claude/skills/demo/nested/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/skills-archived/demo")).toBe(false);
    expect(ws.head()).toBe(head);
  });

  it("waits for a carried skill's write lane before it touches the folder", async () => {
    const { outer } = withNestedSkill("archive-carried-lane");
    const nested = idAt(".claude/skills/demo/nested/SKILL.md");
    const mutex = createDocumentMutex();
    let release = (): void => undefined;
    const holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Held by hand rather than raced: an interleaving a test decides is the only
    // kind it can assert on (SERVER-034).
    void mutex.run(nested, () => holding);

    const archiving = setArchived(docsWorkspace(), mutex, "user", outer, true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // `applyOperations` is synchronous and runs in the first turn after the
    // guard, so without the carried lane the folder would already have moved.
    expect(ws.exists(".claude/skills-archived/demo")).toBe(false);
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);

    release();
    await archiving;
    expect(ws.exists(".claude/skills-archived/demo/SKILL.md")).toBe(true);
    expect(idAt(".claude/skills-archived/demo/nested/SKILL.md")).toBe(nested);
  });
});

// Finding 5: `existsSync` answers about a symlink's *target*, so a symlink at
// the destination was either replaced (dangling) or merged *through* (pointing
// at a directory), writing files somewhere neither end of the move names.
describe("a destination that is not a real directory is never merged through", () => {
  it("refuses a symlink standing where the destination folder would be", async () => {
    const { outer } = withNestedSkill("archive-symlink-destination");
    mkdirSync(join(ws.root, ".claude", "elsewhere"), { recursive: true });
    mkdirSync(join(ws.root, ".claude", "skills-archived"), { recursive: true });
    symlinkSync(
      join(ws.root, ".claude", "elsewhere"),
      join(ws.root, ".claude/skills-archived/demo"),
    );
    const head = ws.head();

    const response = await ws.post(`/api/docs/${outer}/archive`, {});

    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { message: string }[] };
    // The destination itself is what is in the way, so that is what is named —
    // no path under it, and no trailing slash where a filename would go.
    expect(body.issues[0]?.message).toBe(
      ".claude/skills-archived/demo already exists; move or remove it first",
    );
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
    expect(ws.exists(".claude/elsewhere/SKILL.md")).toBe(false);
    expect(ws.head()).toBe(head);
  });

  it("refuses a dangling symlink at the destination rather than replacing it", async () => {
    const { outer } = withNestedSkill("archive-dangling-symlink");
    mkdirSync(join(ws.root, ".claude", "skills-archived"), { recursive: true });
    symlinkSync(join(ws.root, ".claude", "nowhere"), join(ws.root, ".claude/skills-archived/demo"));

    const response = await ws.post(`/api/docs/${outer}/archive`, {});

    expect(response.status).toBe(400);
    expect(ws.exists(".claude/skills/demo/SKILL.md")).toBe(true);
  });
});

// CONTRACT-047 / SERVER-088. Everything above this line was already true and
// entirely silent: a person who archived one skill had another skill disabled,
// and sometimes its frontmatter rewritten, and learned it from `git log`.
describe("the response says which documents the move carried", () => {
  /** Every warning on an archive/unarchive response, through the contract's schema. */
  const warningsOf = async (id: string, verb: "archive" | "unarchive"): Promise<Warning[]> => {
    const response = await ws.post(`/api/docs/${id}/${verb}`, {});
    expect(response.status).toBe(200);
    return DocMutationResponseSchema.parse(await response.json()).warnings;
  };

  const codes = (warnings: readonly Warning[]): string[] => warnings.map((warning) => warning.code);

  const detailOf = (warnings: readonly Warning[], code: string): string =>
    warnings.find((warning) => warning.code === code)?.detail ?? "";

  it("names a carried skill in both directions", async () => {
    const { outer, nested } = withNestedSkill("archive-warn-round-trip");

    const archived = await warningsOf(outer, "archive");

    // One code, not two: nothing of the carried document's frontmatter needed
    // correcting, and the id stamp beside it is deliberately unreported.
    expect(codes(archived)).toEqual(["carried_skill"]);
    expect(detailOf(archived, "carried_skill")).toBe(
      `${nested} (.claude/skills-archived/demo/nested/SKILL.md) was carried by this skill ` +
        `folder move and is now disabled; the request never named it (SPEC.md §7)`,
    );

    ws.advance(60_000);
    const restored = await warningsOf(outer, "unarchive");

    // The same document, the other way, and the path is the one it is at now.
    expect(codes(restored)).toEqual(["carried_skill"]);
    expect(detailOf(restored, "carried_skill")).toBe(
      `${nested} (.claude/skills/demo/nested/SKILL.md) was carried by this skill folder move ` +
        `and is now enabled; the request never named it (SPEC.md §7)`,
    );
  });

  it("names the reconciliation an unarchive performed on a carried skill", async () => {
    const { outer, nested } = withNestedSkill("archive-warn-reconciliation");

    // The nested skill archived on its own is what writes `status: archived`
    // into its file — the state the outer unarchive later has to reconcile. It
    // carries nothing itself, so it says nothing; and the outer archive that
    // follows carries nothing either, because that folder is already empty of
    // skills. Both silences are the point: the report arrives with the effect.
    expect(await warningsOf(nested, "archive")).toEqual([]);
    ws.advance(60_000);
    expect(await warningsOf(outer, "archive")).toEqual([]);

    ws.advance(60_000);
    const restored = await warningsOf(outer, "unarchive");

    expect(codes(restored)).toEqual(["carried_skill", "carried_reconciliation"]);
    expect(detailOf(restored, "carried_reconciliation")).toBe(
      `${nested} (.claude/skills/demo/nested/SKILL.md) still said \`status: archived\` under ` +
        `the enabled skills root, so its status was reconciled to \`open\``,
    );
    // The report and the write are one story (§4): the key really did change.
    expect(parseDocument(ws.read(".claude/skills/demo/nested/SKILL.md")).data["status"]).toBe(
      "open",
    );
  });

  it("says nothing when the folder carried no other skill document", async () => {
    // A folder full of files — `reference.md`, `run.sh` — none of which is a
    // skill document. Silence means "carried no other skill document at all",
    // so a skill archived alone must be silent or the channel is noise.
    const { skillId } = withSkill("archive-warn-solitary");

    expect(await warningsOf(skillId, "archive")).toEqual([]);
    ws.advance(60_000);
    expect(await warningsOf(skillId, "unarchive")).toEqual([]);
  });

  it("reports the carry but no reconciliation for a carried file already saying `open`", async () => {
    ws = createWriteWorkspace("archive-warn-already-open");
    ws.write(".claude/skills/demo/SKILL.md", SKILL);
    ws.write(
      ".claude/skills/demo/nested/SKILL.md",
      ["---", "id: doc_nestedopen", "name: nested", "status: open", "---", "", "Body.", ""].join(
        "\n",
      ),
    );
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skills");
    ws.reproject();
    const outer = idAt(".claude/skills/demo/SKILL.md");

    expect(codes(await warningsOf(outer, "archive"))).toEqual(["carried_skill"]);
    ws.advance(60_000);
    const restored = await warningsOf(outer, "unarchive");

    // Back under the enabled root, already saying what it should say: nothing
    // is written, so nothing is reconciled and nothing is claimed. It carries
    // its own id too, so this act writes not one byte of that file.
    expect(codes(restored)).toEqual(["carried_skill"]);
    expect(ws.read(".claude/skills/demo/nested/SKILL.md")).toContain("status: open");
  });

  // The asymmetry CONTRACT-047 decided deliberately (decision 1). Restoring the
  // symmetry — "both are writes, report both" — fails here rather than teaching
  // a reader to skip a warning that fires on nearly every carry.
  it("emits nothing for the id stamp, which fires on nearly every carry", async () => {
    const { outer, nested } = withNestedSkill("archive-warn-id-stamp-silent");

    const archived = await warningsOf(outer, "archive");

    // The stamp really happened — this is a write, and it is still not reported.
    expect(parseDocument(ws.read(".claude/skills-archived/demo/nested/SKILL.md")).data["id"]).toBe(
      nested,
    );
    expect(codes(archived)).toEqual(["carried_skill"]);
    expect(archived.map((warning) => warning.detail).join(" ")).not.toContain("id");
  });

  it("does not name a moved file the projection never indexed", async () => {
    ws = createWriteWorkspace("archive-warn-unindexed");
    ws.write(".claude/skills/demo/SKILL.md", SKILL);
    // No row, so there is no document to name — `planCarriedWrites`'s stance,
    // and a warning quoting a path with no id would name nothing a caller can
    // open.
    ws.write(".claude/skills/demo/nested/SKILL.md", "---\nname: [unclosed\n---\n\nBody.\n");
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skills");
    ws.reproject();

    const archived = await warningsOf(idAt(".claude/skills/demo/SKILL.md"), "archive");

    expect(archived).toEqual([]);
    expect(ws.exists(".claude/skills-archived/demo/nested/SKILL.md")).toBe(true);
  });

  it("reports the carry of a move that rewrites not one byte of the requested skill", () => {
    // `plan.text === null` — the folder moved and the requested document's own
    // bytes are unchanged, which is exactly the case where the carried report
    // matters most and exactly the case a `plan.text`-gated report would lose.
    ws = createWriteWorkspace("archive-warn-no-own-write");
    // Already says `archived` while sitting in the *enabled* root, so this
    // archive has nothing of its own to write.
    ws.write(
      ".claude/skills/demo/SKILL.md",
      // Its own id declared, so even the stamp is a no-op.
      [
        "---",
        "id: doc_demoskill",
        "name: demo",
        "status: archived",
        "---",
        "",
        "# Demo skill",
        "",
      ].join("\n"),
    );
    ws.write(".claude/skills/demo/nested/SKILL.md", NESTED_SKILL);
    ws.git("add", "-A", "--", ".claude");
    ws.git("commit", "-m", "seed the skills");
    ws.reproject();
    const outer = idAt(".claude/skills/demo/SKILL.md");
    const nested = idAt(".claude/skills/demo/nested/SKILL.md");

    const plan = planSetArchived(
      docsWorkspace(),
      loadDocument(ws.root, ws.db, outer),
      true,
      new Set([outer, nested]),
    );

    expect(plan?.text).toBeNull();
    expect(codes(carriedWarnings(plan?.carried ?? [], new Set([outer])))).toEqual([
      "carried_skill",
    ]);
  });

  it("names a carried document that moved but was never stamped", () => {
    // A `SKILL.md` that appeared under the folder *after* the lanes were chosen:
    // its lane is not held, so the act moves its file and deliberately writes
    // nothing into it. The move is still the enablement change (§7), so it is
    // still reported — the warning follows the plan, not the stamp.
    const { outer } = withNestedSkill("archive-warn-unheld");
    const plan = planSetArchived(
      docsWorkspace(),
      loadDocument(ws.root, ws.db, outer),
      true,
      new Set([outer]),
    );

    const nested = idAt(".claude/skills/demo/nested/SKILL.md");
    expect(plan?.carried).toEqual([
      {
        id: nested,
        path: ".claude/skills-archived/demo/nested/SKILL.md",
        enabled: false,
        reconciled: false,
      },
    ]);
    expect(codes(carriedWarnings(plan?.carried ?? [], new Set([outer])))).toEqual([
      "carried_skill",
    ]);
    // Moved, never written: no `write` operation names its destination.
    expect(
      plan?.operations.some(
        (operation) =>
          operation.kind === "write" &&
          operation.path === ".claude/skills-archived/demo/nested/SKILL.md",
      ),
    ).toBe(false);
  });
});
