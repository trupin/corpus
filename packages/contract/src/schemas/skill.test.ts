import { describe, expect, it } from "vitest";
import {
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  SkillCreateRequestSchema,
  SkillNameSchema,
} from "./skill.js";

/** A pattern-valid name of exactly `length` characters, for the bound's two edges. */
const nameOfLength = (length: number): string => "a".repeat(length);

describe("SkillName", () => {
  it.each(["orchestrate", "comment", "weekly-review", "triage2"])("accepts %s", (name) => {
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
