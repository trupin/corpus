import { describe, expect, it } from "vitest";
import { docRowFixture } from "../../testing/docRow.js";
import { invocableName, isAddressableTarget, rowToken } from "./invocable.js";

/**
 * The client's half of SPEC.md §8's resolution rule. What it is *worth* is
 * decided elsewhere — `scripts/mention-offer-parity.test.ts` runs one fixture
 * through this and through the server's `threads/mentions.ts` and fails if
 * either side moves — so what is here is the rule's own edges.
 *
 * **Every row carries a title**, deliberately. The rule used to fall back to one
 * (`invocableName(path) ?? title`, UI-123), so a fixture with no title cannot
 * tell the fix from the bug: it would answer `null` either way.
 */

const row = (path: string, title = "Some Persona"): ReturnType<typeof docRowFixture> =>
  docRowFixture({ path, title, type: "agent-def" });

describe("invocableName", () => {
  it("derives the name the server indexes, from the path", () => {
    expect(invocableName(".claude/skills/comment/SKILL.md")).toBe("comment");
    expect(invocableName(".claude/skills-archived/old/SKILL.md")).toBe("old");
    expect(invocableName(".claude/agents/researcher.md")).toBe("researcher");
  });

  it("has no name for a document outside those roots", () => {
    expect(invocableName("data/docs/notes/about-skills.md")).toBeNull();
    expect(invocableName("data/docs/inbox/legacy.md")).toBeNull();
  });

  /**
   * The server's skill root is `skill-tree` — *"only files named `SKILL.md`, at
   * any depth"* (`projection/roots.ts`) — so the name is the directory under the
   * root however deep the file sits, and a file beside a `SKILL.md` is not a
   * document at all.
   */
  it("names a skill by its directory at any depth, and names nothing beside it", () => {
    expect(invocableName(".claude/skills/comment/nested/SKILL.md")).toBe("comment");
    expect(invocableName(".claude/skills/comment/notes.md")).toBeNull();
    expect(invocableName(".claude/skills-archived/old/notes.md")).toBeNull();
  });

  /**
   * `SKILL.md` sitting **in** the skills root, named by no directory. Claude
   * Code discovers a skill by the folder that holds it, so nothing loads this
   * one and nothing should address it — the same reasoning SERVER-125 applied to
   * an off-root `agent-def`.
   *
   * The server disagreed when this rule was written: its `invocableName` sliced
   * the first path segment after the root and answered `"SKILL.md"`, so
   * `targetIndex` indexed the row and its typeable title alias with it (PR #50
   * NIT 9). That was the server's defect, not this rule's, and SERVER-127 closed
   * it there rather than making this side agree with a wrong answer;
   * `scripts/mention-offer-parity.test.ts` now holds the two together over one
   * workspace with no exclusions.
   */
  it("names nothing for a SKILL.md with no directory to name it", () => {
    expect(invocableName(".claude/skills/SKILL.md")).toBeNull();
    expect(invocableName(".claude/skills-archived/SKILL.md")).toBeNull();
  });
});

describe("rowToken", () => {
  it("completes an on-root row to its stem, not its title", () => {
    // The common shape since SERVER-122: `corpus doc create --title Bookkeeper`
    // slugs the file and keeps the title, so the two differ routinely and the
    // typeable one is the stem.
    expect(rowToken(row(".claude/agents/bookkeeper.md", "Bookkeeper"))).toBe("bookkeeper");
  });

  /**
   * The regression UI-123 closes. It used to answer `?? row.title`, which was
   * right while the server's index carried a title alias for every row —
   * SERVER-125 stopped indexing an unaddressable row at all, alias included, so
   * the fallback became a name that summons nobody.
   */
  it("has no token for an off-root row, rather than falling back to its title", () => {
    expect(rowToken(row("data/docs/inbox/legacy.md", "Legacy"))).toBeNull();
  });
});

describe("isAddressableTarget", () => {
  it.each([
    [".claude/agents/researcher.md", true],
    [".claude/agents/bookkeeper.md", true],
    [".claude/skills/comment/SKILL.md", true],
    [".claude/skills-archived/old/SKILL.md", true],
    ["data/docs/inbox/legacy.md", false],
    ["data/docs/notes/about-skills.md", false],
    // Nested under the agent root rather than sitting in it. The server's agents
    // root is `markdown-flat` (`projection/roots.ts`), so such a file is not an
    // agent-def at all; this answers the same way rather than inventing a name
    // for it.
    [".claude/agents/team/researcher.md", false],
  ])("answers for %s", (path, expected) => {
    expect(isAddressableTarget(row(path))).toBe(expected);
  });

  it("agrees with rowToken by construction, so no surface can gate on the other", () => {
    for (const path of [".claude/agents/researcher.md", "data/docs/inbox/legacy.md"]) {
      expect(isAddressableTarget(row(path))).toBe(rowToken(row(path)) !== null);
    }
  });
});
