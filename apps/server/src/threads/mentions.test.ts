import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createThreadWorkspace, type WriteWorkspace } from "./thread-fixture.js";
import {
  INVOCATION_TYPE,
  MENTION_TYPE,
  NO_MENTIONS,
  invocableName,
  parseMentions,
  requestsAgent,
  resolveMentionTarget,
  scanMentionTokens,
} from "./mentions.js";

// Real files under the real document roots, projected by the real projector:
// §8's "validates them against the projection" is only meaningful against rows
// the projector actually produced from `.claude/agents/*.md` and a `SKILL.md`.
let ws: WriteWorkspace;

beforeAll(() => {
  ws = createThreadWorkspace("mentions");
  ws.write(
    ".claude/agents/researcher.md",
    "---\nname: researcher\ndescription: digs things up\n---\nBody.\n",
  );
  ws.write(
    ".claude/agents/retired.md",
    "---\nname: retired\ndescription: no longer used\nstatus: archived\n---\nBody.\n",
  );
  // Exactly the shape `corpus init` seeds: Claude Code's `name` and Corpus's
  // `title` in one block (§7), spelled differently. The projection keeps the
  // title, so a resolver reading only that column answers `/comment` with
  // nothing.
  ws.write(
    ".claude/skills/comment/SKILL.md",
    "---\nname: comment\ndescription: handles comment.created\nid: doc_skillcomment\n" +
      "type: skill\ntitle: Comment\n---\nBody.\n",
  );
  ws.write(
    ".claude/skills/orchestrate/SKILL.md",
    "---\nname: orchestrate\ndescription: the agent loop\n---\nBody.\n",
  );
  ws.reproject();
});

afterAll(() => {
  ws.close();
});

const parse = (body: string): ReturnType<typeof parseMentions> => parseMentions(ws.db, body);

describe("scanMentionTokens", () => {
  it("finds both sigils at a word boundary", () => {
    expect(scanMentionTokens("hey @agent, try /comment please")).toEqual([
      { sigil: "@", name: "agent" },
      { sigil: "/", name: "comment" },
    ]);
  });

  it.each([
    ["an email address", "email me@agent.example"],
    ["a path segment", "see path/comment/x"],
    ["a URL", "https://example.test/comment"],
    ["a word continuing past the sigil's owner", "a@agentb"],
    ["a fenced block", "```\n@agent /comment\n```"],
    ["an inline span", "use `@agent` in the docs"],
  ])("ignores %s", (_label, body) => {
    expect(scanMentionTokens(body).filter((token) => token.name !== "agentb")).toEqual([]);
  });

  it("keeps a mention that ends a sentence", () => {
    expect(scanMentionTokens("ask @agent.")).toEqual([{ sigil: "@", name: "agent" }]);
  });
});

describe("parseMentions", () => {
  it("reads @agent as the generic request, with nothing structured", () => {
    expect(parse("@agent is this still right?")).toEqual({
      generic: true,
      mentions: [],
      skills: [],
      unresolved: [],
    });
  });

  it("resolves a subagent against `.claude/agents/`", () => {
    const parsed = parse("@researcher take this");
    expect(parsed.mentions).toEqual([
      { name: "researcher", docId: expect.stringMatching(/^doc_/) as unknown, status: "open" },
    ]);
    expect(parsed.skills).toEqual([]);
  });

  // The seeded skill's Corpus title is "Comment"; its invocable name is
  // `comment`, which is what a person types and what Claude Code dispatches on.
  it("resolves a skill by the name its path encodes, not by its Corpus title", () => {
    const parsed = parse("/comment please");
    expect(parsed.skills).toEqual([{ name: "comment", docId: "doc_skillcomment", status: "open" }]);
    expect(parsed.mentions).toEqual([]);
  });

  it("still resolves a document by its title when that is all it has", () => {
    expect(parse("/orchestrate now").skills[0]).toMatchObject({ name: "orchestrate" });
  });

  it("does not care about case after the sigil", () => {
    expect(parse("/Comment please").skills[0]).toMatchObject({ name: "comment" });
    expect(parse("@Researcher please").mentions[0]).toMatchObject({ name: "researcher" });
  });

  // §8 hands the "missing or archived" case to the orchestrator to answer in its
  // reply, which it cannot do if the server swallows the request first.
  it("passes an archived target through with its status, still requesting the agent", () => {
    const parsed = parse("@retired can you look?");
    expect(parsed.mentions[0]).toMatchObject({ name: "retired", status: "archived" });
    expect(requestsAgent(parsed)).toBe(true);
  });

  it("reports tokens that resolve to nothing without requesting the agent", () => {
    const parsed = parse("check @nobody and /nothing");
    expect(parsed.unresolved).toEqual(["@nobody", "/nothing"]);
    expect(requestsAgent(parsed)).toBe(false);
  });

  it("does not cross the sigils: a skill's name is not a subagent", () => {
    expect(parse("@comment").unresolved).toEqual(["@comment"]);
    expect(parse("/researcher").unresolved).toEqual(["/researcher"]);
  });

  it("reports one entry per distinct token, however often it is written", () => {
    const parsed = parse("@researcher @researcher /comment /comment @agent @agent");
    expect(parsed.mentions).toHaveLength(1);
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.generic).toBe(true);
  });

  it("finds nothing in code, whatever the fence", () => {
    expect(parse("```\n@agent /comment @researcher\n```")).toEqual(NO_MENTIONS);
    expect(parse("use `@agent` and `/comment`")).toEqual(NO_MENTIONS);
  });
});

describe("requestsAgent", () => {
  it("is false for a body with nothing in it", () => {
    expect(requestsAgent(NO_MENTIONS)).toBe(false);
  });
});

// The lookup a designation makes (SPEC.md §7, SERVER-109). It shares this
// module's index so that a designation and a mention of one name can never
// resolve to two documents.
describe("resolveMentionTarget", () => {
  it("resolves an agent-def by the name a mention would use", () => {
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "researcher")).toMatchObject({
      name: "researcher",
      status: "open",
    });
  });

  it("ignores case and surrounding whitespace, which a typed name can carry", () => {
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "  ReSeArChEr ")).toMatchObject({
      name: "researcher",
    });
  });

  it("answers an archived target with its status rather than nothing", () => {
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "retired")).toMatchObject({
      name: "retired",
      status: "archived",
    });
  });

  it("does not cross the sigils' types: a skill is not a subagent", () => {
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "comment")).toBeNull();
    expect(resolveMentionTarget(ws.db, INVOCATION_TYPE, "comment")).toMatchObject({
      name: "comment",
    });
  });

  it("answers nothing for a name no document responds to", () => {
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "nobody")).toBeNull();
  });
});

describe("invocableName", () => {
  it.each([
    [".claude/skills/comment/SKILL.md", "comment"],
    [".claude/skills/comment/reference/deep/SKILL.md", "comment"],
    [".claude/skills-archived/retired/SKILL.md", "retired"],
    [".claude/agents/researcher.md", "researcher"],
  ])("reads %s as %s", (path, expected) => {
    expect(invocableName(path)).toBe(expected);
  });

  it.each([
    // A document *about* a skill is not an invocable one.
    "data/docs/inbox/skills.md",
    "data/threads/th_a1b2c3d4.md",
    "somewhere/else.md",
  ])("has no invocable name for %s", (path) => {
    expect(invocableName(path)).toBeNull();
  });
});
