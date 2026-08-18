import type { DocRow } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../apps/server/src/docs/corpus-fixture.js";
import {
  INVOCATION_TYPE,
  MENTION_TYPE,
  resolveMentionTarget,
  unaddressableTarget,
} from "../apps/server/src/threads/mentions.js";
import {
  isAddressableTarget,
  rowToken,
} from "../packages/kit/src/components/Autocomplete/invocable.js";

/**
 * **What the client offers and what the server resolves, over one workspace.**
 *
 * SERVER-125's own acceptance criterion is the standard this file exists to
 * hold: *"the autocomplete and the resolver must agree — offering what will not
 * resolve is worse than either"*. It stopped indexing an off-root
 * `type: agent-def` as a mention target under any spelling, its title alias
 * included; both client surfaces went on offering those rows for a release
 * because each derived the rule for itself, and neither had anything to compare
 * against (UI-123).
 *
 * So the fixture is one workspace, the rows are what the **real projector**
 * makes of it, and every question is asked twice — once of
 * `apps/server/src/threads/mentions.ts` and once of the two client surfaces. A
 * unit test on either side alone could only ever restate that side's opinion.
 *
 * It lives in `scripts/` for `stub-server-parity.test.ts`'s reason: this is the
 * one place in the repo that may look at two applications at once, since
 * `apps/ui` and `apps/server` are siblings and an import between them would
 * invent a dependency edge.
 *
 * **The gate, not the whole menu.** What is compared is which rows become
 * *offers* and under what name. The menus' other rules — the generic `@agent`,
 * the typeable-token charset, the limit, the blank title — are each side's own
 * and are tested where they live.
 */

let ws: Workspace;

/** Rows as `GET /api/docs?type=<type>` reports them, straight off the projection. */
const directory = (type: string): readonly DocRow[] =>
  ws.db
    .prepare("SELECT id, path, title FROM documents WHERE type = ? ORDER BY id")
    .all(type) as unknown as DocRow[];

/** The `@` / `/` menu's offers: the row's token, for every row that has one. */
const completions = (type: string): readonly string[] =>
  directory(type).flatMap((row) => rowToken(row) ?? []);

/**
 * The designate menu's offers, by its own rule: the gate, then the **title**,
 * which is what `agentDefRows` sends (`apps/ui/src/thread/residentActions.ts`).
 *
 * Spelled here rather than imported, and this is the one seam in the file. That
 * module imports `@corpus/kit`, whose types are React's, and repo tooling
 * compiles under `NodeNext` with no DOM lib — pulling a UI module in would drag
 * a browser type program into `scripts/` for one function. What is *not* copied
 * is the rule: the gate below is `isAddressableTarget`, the kit's own, which is
 * the only thing UI-123 could get wrong twice. That the menu applies it, and
 * sends the title of what survives, is pinned by `residentActions.test.ts`.
 */
const designations = (): readonly string[] =>
  directory(MENTION_TYPE)
    .filter((row) => isAddressableTarget(row))
    .map((row) => row.title.trim())
    .filter((name) => name !== "");

const agentDef = (title: string): string =>
  `---\nname: ${title.toLowerCase()}\ndescription: a persona\ntype: agent-def\ntitle: ${title}\n---\nBody.\n`;

beforeAll(() => {
  ws = createWorkspace("mention-offers");
  // Two personas Claude Code actually loads. `Bookkeeper` is the common shape
  // since SERVER-122: the title is not the stem, and both spellings resolve.
  ws.write(".claude/agents/researcher.md", agentDef("Researcher"));
  ws.write(".claude/agents/bookkeeper.md", agentDef("Bookkeeper"));
  // A skill Claude Code discovers by its directory name, whose Corpus title is
  // spelled differently (§7 — "the two sets coexist in the same YAML block").
  ws.write(
    ".claude/skills/comment/SKILL.md",
    "---\nname: comment\ndescription: handles comment.created\ntype: skill\ntitle: Comment\n---\nBody.\n",
  );
  // …and the two documents *about* those things, filed where an explicit
  // `--folder` still puts them (SERVER-122). They are documents, not personas.
  ws.doc({
    id: "doc_legacy1",
    path: "data/docs/inbox/legacy.md",
    type: "agent-def",
    title: "Legacy",
  });
  ws.doc({
    id: "doc_about1",
    path: "data/docs/notes/about-skills.md",
    type: "skill",
    title: "Autopilot",
  });
  ws.reproject();
});

afterAll(() => {
  ws.close();
});

describe("the fixture the two sides are compared over", () => {
  /**
   * Non-vacuity, first: with an empty directory, or one where nothing is
   * dropped, every agreement below would hold of a client that offered nothing
   * and of one that offered everything.
   */
  it("holds rows on both sides of the gate, in both types", () => {
    expect(directory(MENTION_TYPE)).toHaveLength(3);
    expect(directory(INVOCATION_TYPE)).toHaveLength(2);
    expect(completions(MENTION_TYPE)).toHaveLength(2);
    expect(completions(INVOCATION_TYPE)).toHaveLength(1);
  });

  /**
   * And the dropped rows are **still documents**: the query is unfiltered, which
   * is what keeps the board's `type:` filter and the seeded "Skills & agents"
   * view whole. The filter belongs where a row becomes an offer, and nowhere
   * earlier.
   */
  it("still lists the documents neither menu offers", () => {
    expect(directory(MENTION_TYPE).map((row) => row.title)).toContain("Legacy");
    expect(directory(INVOCATION_TYPE).map((row) => row.title)).toContain("Autopilot");
  });
});

describe.each([
  ["a mention", MENTION_TYPE],
  ["an invocation", INVOCATION_TYPE],
])("%s the `@` / `/` menu offers", (_label, type) => {
  it("resolves on the server, to the document the row came from", () => {
    for (const row of directory(type)) {
      const token = rowToken(row);
      if (token === null) continue;
      const target = resolveMentionTarget(ws.db, type, token);
      // The document the row came from, and the name the server keeps for it —
      // which is the token, whichever spelling found it.
      expect(target?.docId).toBe(row.id);
      expect(target?.name).toBe(token);
    }
  });
});

describe.each([
  ["a mention", MENTION_TYPE],
  ["an invocation", INVOCATION_TYPE],
])("%s row the menu drops", (_label, type) => {
  /**
   * The half that would have caught UI-123 on the day SERVER-125 landed: a
   * dropped row resolves under **neither** spelling, so nothing the client
   * withholds was addressable, and — with the test above — nothing addressable
   * is withheld.
   */
  it("resolves under no spelling at all, its title included", () => {
    const dropped = directory(type).filter((row) => !isAddressableTarget(row));
    expect(dropped).not.toHaveLength(0);
    for (const row of dropped) {
      expect(resolveMentionTarget(ws.db, type, row.title)).toBeNull();
      expect(resolveMentionTarget(ws.db, type, row.title.toLowerCase())).toBeNull();
      expect(resolveMentionTarget(ws.db, type, row.id)).toBeNull();
    }
  });

  /** And the server can say *which* document it skipped, which is the same row. */
  it("is the row the server reports as unaddressable, by name", () => {
    for (const row of directory(type).filter((candidate) => !isAddressableTarget(candidate))) {
      expect(unaddressableTarget(ws.db, type, row.title)).toEqual({
        docId: row.id,
        path: row.path,
        title: row.title,
      });
    }
  });
});

describe("the board's designate menu", () => {
  /**
   * The second surface, by the same rule and with its own spelling: it sends the
   * **title**, which the server resolves for an addressable row because
   * `targetIndex` still carries the title alias — for a row it indexes at all.
   */
  it("offers only names a designation resolves, and offers every one it can", () => {
    expect(designations()).toEqual(["Bookkeeper", "Researcher"]);
    for (const name of designations()) {
      expect(resolveMentionTarget(ws.db, MENTION_TYPE, name)).not.toBeNull();
    }
  });

  /**
   * The regression itself, named. `Legacy` was designatable through this menu
   * until UI-123, and since SERVER-125 that designation earns a `404` naming the
   * file.
   */
  it("does not offer the document about a persona, which the server refuses", () => {
    expect(designations()).not.toContain("Legacy");
    expect(resolveMentionTarget(ws.db, MENTION_TYPE, "Legacy")).toBeNull();
  });

  /**
   * The two surfaces offer the **same rows**, differing only in the spelling
   * each sends — one the stem, the other the title. A rule applied by one and
   * not the other is how this pair drifted the first time.
   */
  it("offers the same rows the `@` menu does", () => {
    const offered = directory(MENTION_TYPE).filter((row) => isAddressableTarget(row));
    expect(designations()).toHaveLength(offered.length);
    expect(completions(MENTION_TYPE)).toEqual(offered.map((row) => rowToken(row)));
  });
});
