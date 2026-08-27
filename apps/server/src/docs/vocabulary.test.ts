import { WorkspaceVocabularySchema } from "@corpus/contract";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "./corpus-fixture.js";
import { workspaceVocabulary } from "./vocabulary.js";

/**
 * SPEC.md §9.2's `GET /api/vocabulary`, against a real projection built from
 * real files. The properties worth holding are the two asymmetries — tags
 * collapse by case and extra keys do not, and a document is counted once
 * however many times it carries a value.
 */

let ws: Workspace;

afterEach(() => ws.close());

function seeded(): Workspace {
  ws = createWorkspace("vocabulary");
  ws.doc({ id: "doc_a", tags: ["finance", "urgent"], frontmatter: { assignee: "theo" } });
  ws.doc({ id: "doc_b", tags: ["Finance"], frontmatter: { assignee: "sam", estimate: 3 } });
  ws.doc({ id: "doc_c", tags: ["finance"], frontmatter: { Assignee: "theo" } });
  ws.doc({ id: "doc_archived", status: "archived", tags: ["secret"], frontmatter: { hidden: 1 } });
  ws.doc({ id: "doc_plain" });
  // What `corpus init` installs: Claude Code's own frontmatter, on documents the
  // tool wrote rather than the workspace.
  ws.doc({
    id: "doc_skill",
    type: "skill",
    path: ".claude/skills/comment/SKILL.md",
    tags: ["core"],
    frontmatter: { name: "comment", description: "Answer a comment." },
  });
  ws.reproject();
  return ws;
}

describe("workspaceVocabulary", () => {
  it("answers the contract's shape", () => {
    expect(() => WorkspaceVocabularySchema.parse(workspaceVocabulary(seeded().db))).not.toThrow();
  });

  it("counts tags by document, most-used first, collapsing case", () => {
    // `Finance` and `finance` are one tag to the filter, so they are one entry
    // here — a menu offering both would be two picks for one query.
    expect(workspaceVocabulary(seeded().db).tags).toEqual([
      { value: "finance", count: 3 },
      { value: "urgent", count: 1 },
    ]);
  });

  it("keeps extra keys case-sensitive, because the filter is", () => {
    // `json_extract` distinguishes them, so `Assignee` finds a different
    // document from `assignee` and collapsing them would offer a key that
    // answers with the wrong rows.
    expect(workspaceVocabulary(seeded().db).extraKeys).toEqual([
      { key: "assignee", count: 2 },
      { key: "Assignee", count: 1 },
      { key: "estimate", count: 1 },
    ]);
  });

  /**
   * Found by running the endpoint against a real `corpus init` workspace: the
   * two most-used "invented" keys were `name` and `description`, five documents
   * each, and the most-used tag was `core` — all of them from the skills the
   * tool installed, sitting above the person's own `assignee`.
   *
   * `rankableSql` is the bar the §7 rider signed 2026-08-24 already set for
   * exactly this question, so this reuses that decision rather than inventing
   * one. It excludes them from a *menu* and from nothing else.
   */
  it("leaves out what the tool installed, not what the workspace wrote", () => {
    const vocabulary = workspaceVocabulary(seeded().db);
    expect(vocabulary.extraKeys.map((entry) => entry.key)).not.toContain("name");
    expect(vocabulary.extraKeys.map((entry) => entry.key)).not.toContain("description");
    expect(vocabulary.tags.map((tag) => tag.value)).not.toContain("core");
    // And still offers the workspace's own.
    expect(vocabulary.extraKeys.map((entry) => entry.key)).toContain("assignee");
  });

  it("excludes archived documents, the way every list does by default", () => {
    const vocabulary = workspaceVocabulary(seeded().db);
    expect(vocabulary.tags.map((tag) => tag.value)).not.toContain("secret");
    expect(vocabulary.extraKeys.map((entry) => entry.key)).not.toContain("hidden");
  });

  it("answers two empty arrays for an empty corpus, never a failure", () => {
    ws = createWorkspace("vocabulary-empty");
    ws.reproject();
    expect(workspaceVocabulary(ws.db)).toEqual({ tags: [], extraKeys: [] });
  });

  it("contributes nothing for a document carrying neither", () => {
    // `doc_plain` has no tags and an empty `extra_json`, and appears in neither
    // list — the control that says these counts are of real use, not of rows.
    const vocabulary = workspaceVocabulary(seeded().db);
    const total = vocabulary.extraKeys.reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(4);
  });
});
