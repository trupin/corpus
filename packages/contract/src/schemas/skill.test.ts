import { describe, expect, it } from "vitest";
import {
  SKILL_NAME_PATTERN,
  SkillNameSchema,
  SkillRollbackRequestSchema,
  SkillRollbackResultSchema,
} from "./skill.js";

const result = {
  name: "orchestrate",
  docId: "doc_skillorchestrate",
  commit: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456",
  path: ".claude/skills/orchestrate/SKILL.md",
  warnings: [],
};

describe("SkillName", () => {
  it.each(["orchestrate", "comment", "weekly-review", "todos2"])("accepts %s", (name) => {
    expect(SkillNameSchema.parse(name)).toBe(name);
  });

  /**
   * The name is a path segment under `.claude/skills/`, so anything that could
   * escape the directory — or that Claude Code would not discover in the first
   * place — is refused before a handler ever sees it.
   */
  it.each([
    "",
    "../orchestrate",
    "orchestrate/SKILL.md",
    "Orchestrate",
    "my_skill",
    "-lead",
    "a--b",
  ])("rejects %s", (name) => {
    expect(SkillNameSchema.safeParse(name).success).toBe(false);
  });

  it("publishes the pattern the route validates against", () => {
    expect(SKILL_NAME_PATTERN.test("orchestrate")).toBe(true);
    expect(SKILL_NAME_PATTERN.test("../x")).toBe(false);
  });
});

describe("SkillRollbackRequest round-trips", () => {
  it("accepts an empty body, meaning last-known-good", () => {
    expect(SkillRollbackRequestSchema.parse({})).toEqual({});
  });

  it.each([
    ["a sha", "9f1c2ab"],
    ["a tag", "v0.3.1"],
    ["a relative revision", "HEAD~2"],
  ])("accepts %s as the ref", (_label, to) => {
    expect(SkillRollbackRequestSchema.parse({ to }).to).toBe(to);
  });

  /** A client holding a nullable ref never has to strip the key before sending. */
  it("reads an explicit null as last-known-good", () => {
    expect(SkillRollbackRequestSchema.parse({ to: null }).to).toBeNull();
  });

  it("rejects an empty ref, which resolves to nothing", () => {
    expect(SkillRollbackRequestSchema.safeParse({ to: "" }).success).toBe(false);
  });
});

describe("SkillRollbackResult round-trips", () => {
  it("preserves every field", () => {
    expect(SkillRollbackResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });

  it("carries the §14 commit warning a rejected hook produces", () => {
    const warned = {
      ...result,
      warnings: [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
    };
    expect(SkillRollbackResultSchema.parse(JSON.parse(JSON.stringify(warned)))).toEqual(warned);
  });

  it.each(["name", "docId", "commit", "path", "warnings"] as const)("demands %s", (field) => {
    const { [field]: _omitted, ...rest } = result;
    expect(SkillRollbackResultSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a commit that is not a hex object name", () => {
    expect(SkillRollbackResultSchema.safeParse({ ...result, commit: "HEAD" }).success).toBe(false);
  });

  /** Ids are immutable (§5): a rollback restores content, never identity. */
  it("rejects a thread id where the skill document's id belongs", () => {
    expect(SkillRollbackResultSchema.safeParse({ ...result, docId: "th_x9y8" }).success).toBe(
      false,
    );
  });
});
