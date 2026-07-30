import { describe, expect, it } from "vitest";
import {
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  SkillCreateRequestSchema,
  SkillNameSchema,
  SkillRollbackRequestSchema,
  SkillRollbackResultSchema,
} from "./skill.js";

/** A pattern-valid name of exactly `length` characters, for the bound's two edges. */
const nameOfLength = (length: number): string => "a".repeat(length);

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

  /**
   * The bound (orchestrator ruling, 2026-07-30). A name becomes a directory
   * name, so it is refused at the schema rather than at `mkdir`. Both edges are
   * asserted: an off-by-one either way is a silently different contract.
   */
  it("accepts a name of exactly the maximum length", () => {
    const longest = nameOfLength(SKILL_NAME_MAX_LENGTH);
    expect(longest).toHaveLength(64);
    expect(SkillNameSchema.parse(longest)).toBe(longest);
  });

  it("refuses a name one character past the maximum", () => {
    expect(SkillNameSchema.safeParse(nameOfLength(SKILL_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });

  /** Every name the product itself ships is far inside the bound. */
  it.each(["orchestrate", "comment"])("leaves the shipped skill name %s well within it", (name) => {
    expect(name.length).toBeLessThan(SKILL_NAME_MAX_LENGTH);
    expect(SkillNameSchema.parse(name)).toBe(name);
  });
});

describe("SkillCreateRequest (CONTRACT-020)", () => {
  const minimal = { name: "weekly-review", description: "Run the Monday review." };

  it("takes a name and a description as the whole requirement", () => {
    expect(SkillCreateRequestSchema.parse(minimal)).toEqual(minimal);
  });

  it("accepts the optional document fields the server would otherwise fill in", () => {
    const full = {
      ...minimal,
      title: "Weekly review",
      body: "## Steps\n\n1. Read the inbox.\n",
      tags: ["core"],
    };
    expect(SkillCreateRequestSchema.parse(full)).toEqual(full);
  });

  it.each(["name", "description"] as const)("demands %s", (field) => {
    const { [field]: _omitted, ...rest } = minimal;
    expect(SkillCreateRequestSchema.safeParse(rest).success).toBe(false);
  });

  /**
   * The guard is the schema, not the handler: a name that could name anything
   * outside `.claude/skills/<name>/` never reaches a filesystem call, because
   * the pattern admits no separator, no dot and no whitespace.
   */
  it.each([
    "../evil",
    "..",
    "a/b",
    "/etc/passwd",
    ".claude",
    "%2e%2e",
    "orchestrate/../../x",
    "orchestrate ",
  ])("refuses the traversal-shaped name %s", (name) => {
    expect(SkillCreateRequestSchema.safeParse({ ...minimal, name }).success).toBe(false);
  });

  /**
   * A description is what Claude Code discovers a skill by, so an empty one
   * produces a file that is installed and uninvokable — the one failure this
   * verb exists to prevent.
   */
  it("rejects an empty description as firmly as a missing one", () => {
    expect(SkillCreateRequestSchema.safeParse({ ...minimal, description: "" }).success).toBe(false);
  });

  /** The create body inherits the name bound, since it is the body that makes the directory. */
  it("accepts a name of exactly the maximum length and refuses one past it", () => {
    expect(
      SkillCreateRequestSchema.safeParse({ ...minimal, name: nameOfLength(SKILL_NAME_MAX_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      SkillCreateRequestSchema.safeParse({
        ...minimal,
        name: nameOfLength(SKILL_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects an empty title, since the default is the name and not nothing", () => {
    expect(SkillCreateRequestSchema.safeParse({ ...minimal, title: "" }).success).toBe(false);
  });

  /** An empty body is a real request: the skill is created and then edited. */
  it("accepts an empty body, which is not the same as omitting it", () => {
    expect(SkillCreateRequestSchema.parse({ ...minimal, body: "" }).body).toBe("");
  });

  /**
   * Strict (CONTRACT-017). `folder` in particular is the plausible typo — a
   * caller reaching for `POST /api/docs`'s vocabulary — and silently ignoring it
   * would file the skill somewhere the caller did not ask for.
   */
  it.each(["folder", "type", "status", "extra", "id"])("rejects the unknown key %s", (key) => {
    expect(SkillCreateRequestSchema.safeParse({ ...minimal, [key]: "x" }).success).toBe(false);
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

  /**
   * CONTRACT-016. §14's "the file write stands, the commit failure is a warning"
   * outcome has no sha to report, and reporting the pre-existing HEAD would put
   * a foreign commit in an audit field.
   */
  it("accepts a null commit, meaning the restoration is uncommitted", () => {
    const uncommitted = {
      ...result,
      commit: null,
      warnings: [{ code: "commit_failed" as const, detail: "pre-commit hook exited 1" }],
    };
    expect(SkillRollbackResultSchema.parse(JSON.parse(JSON.stringify(uncommitted)))).toEqual(
      uncommitted,
    );
  });

  it("accepts a null commit for the git-less workspace too", () => {
    const skipped = {
      ...result,
      commit: null,
      warnings: [{ code: "commit_skipped" as const, detail: "not a git repository" }],
    };
    expect(SkillRollbackResultSchema.parse(skipped).commit).toBeNull();
  });

  /** Nullable, not optional: the field is still always on the wire. */
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
