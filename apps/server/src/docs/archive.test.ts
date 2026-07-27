import { DocListSchema, DocMutationResponseSchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { parseDocument } from "../core/index.js";
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

  it("refuses to merge into an existing archived folder and modifies neither side", async () => {
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
