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
  unaddressableTarget,
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
  // A persona whose Corpus title is not its filename — the common shape since
  // SERVER-122, because `corpus doc create --title Bookkeeper` slugs the one and
  // keeps the other. Both aliases have to answer, and two different callers each
  // use only one of them (see `targetIndex`).
  ws.write(
    ".claude/agents/bookkeeper.md",
    "---\nname: bookkeeper\ndescription: keeps the money straight\nid: doc_bookkeep\n" +
      "type: agent-def\ntitle: Bookkeeper\n---\nBody.\n",
  );
  // A document *about* a persona, filed where SERVER-122 keeps `--folder`
  // winning so that it stays expressible. It is not a persona: Claude Code never
  // loads it, and since SERVER-125 nothing addresses it either.
  ws.write(
    "data/docs/inbox/legacy.md",
    "---\nid: doc_legacy1\ntype: agent-def\ntitle: Legacy\n" +
      "created: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nstatus: open\n---\nBody.\n",
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

/**
 * SERVER-125. A `type: agent-def` document outside `.claude/agents/` used to be
 * indexed under its title, which made it resolvable, offered and designatable
 * while Claude Code loaded nothing and no dispatch could reach it.
 */
describe("a document outside the root its type is discovered from", () => {
  it("resolves under no spelling, its title included", () => {
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "Legacy")).toBeNull();
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "legacy")).toBeNull();
  });

  // Not an error and not a refusal: §8's own treatment of a name that names
  // nobody, which is reported and deliberately does not wake the agent.
  it("is an unresolved token that requests nothing", () => {
    const parsed = parse("@legacy can you look at this?");
    expect(parsed.mentions).toEqual([]);
    expect(parsed.unresolved).toEqual(["@legacy"]);
    expect(requestsAgent(parsed)).toBe(false);
  });

  it("is still the document it always was, and says why it is not a persona", () => {
    expect(unaddressableTarget(ws.db, MENTION_TYPE, " legacy ")).toEqual({
      docId: "doc_legacy1",
      path: "data/docs/inbox/legacy.md",
      title: "Legacy",
    });
  });

  it("names nothing when the name is simply a typo", () => {
    expect(unaddressableTarget(ws.db, MENTION_TYPE, "nobody")).toBeNull();
    // …nor when the name belongs to a persona that resolves perfectly well.
    expect(unaddressableTarget(ws.db, MENTION_TYPE, "researcher")).toBeNull();
  });
});

/**
 * The other direction, and the reason the gate is the invocable name rather than
 * the removal of the title alias: an on-root persona is addressed by its stem in
 * a composer and by its title from the board's designate menu, and both callers
 * are real (`residentActions.ts`).
 */
describe("a persona in its root whose title is not its filename", () => {
  it("answers to its stem and to its title alike", () => {
    expect(parse("@bookkeeper look at this").mentions).toEqual([
      { name: "bookkeeper", docId: "doc_bookkeep", status: "open" },
    ]);
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "Bookkeeper")).toEqual({
      name: "bookkeeper",
      docId: "doc_bookkeep",
      status: "open",
    });
  });

  it("is never reported as unaddressable, under either spelling", () => {
    expect(unaddressableTarget(ws.db, MENTION_TYPE, "Bookkeeper")).toBeNull();
    expect(unaddressableTarget(ws.db, MENTION_TYPE, "bookkeeper")).toBeNull();
  });
});

/**
 * The bug the gate closes that nothing else would have: `targetIndex` breaks a
 * name collision by **id order**, and a created document's `doc_*` id is minted
 * at random — so an inert document titled like a working persona took its name
 * away from it whenever its id happened to sort first. The ids here are written
 * rather than minted so the pre-fix answer is the wrong one every run.
 */
describe("an unaddressable document that claims a working name", () => {
  let shadow: WriteWorkspace;

  beforeAll(() => {
    shadow = createThreadWorkspace("mentions-shadow");
    shadow.write(
      ".claude/agents/researcher.md",
      "---\nname: researcher\ndescription: digs things up\nid: doc_zzzzzz\n" +
        "type: agent-def\ntitle: Researcher\n---\nBody.\n",
    );
    shadow.write(
      "data/docs/inbox/about-researcher.md",
      "---\nid: doc_aaaaaa\ntype: agent-def\ntitle: Researcher\n" +
        "created: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nstatus: open\n---\nNotes.\n",
    );
    shadow.write(
      ".claude/skills/comment/SKILL.md",
      "---\nname: comment\ndescription: handles comment.created\nid: doc_zzzzzy\n" +
        "type: skill\ntitle: Comment\n---\nBody.\n",
    );
    shadow.write(
      "data/docs/inbox/about-comment.md",
      "---\nid: doc_aaaaab\ntype: skill\ntitle: Comment\n" +
        "created: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nstatus: open\n---\nNotes.\n",
    );
    shadow.reproject();
  });

  afterAll(() => {
    shadow.close();
  });

  it("does not take `@researcher` from the profile that answers it", () => {
    expect(resolveMentionTarget(shadow.db, MENTION_TYPE, "researcher")?.docId).toBe("doc_zzzzzz");
    expect(parseMentions(shadow.db, "@researcher please").mentions).toEqual([
      { name: "researcher", docId: "doc_zzzzzz", status: "open" },
    ]);
  });

  // The same rule, the other sigil: `invocableName` has always said a
  // `type: skill` document under `data/docs/` is a document about a skill.
  it("does not take `/comment` from the skill that answers it", () => {
    expect(parseMentions(shadow.db, "/comment please").skills).toEqual([
      { name: "comment", docId: "doc_zzzzzy", status: "open" },
    ]);
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
