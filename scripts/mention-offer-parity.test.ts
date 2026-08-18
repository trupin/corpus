import type { DocRow } from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspace, type Workspace } from "../apps/server/src/docs/corpus-fixture.js";
import {
  DOCUMENT_ROOTS,
  SKILL_FILENAME,
  classifyPath,
  type DocumentRoot,
} from "../apps/server/src/projection/index.js";
import {
  INVOCATION_TYPE,
  MENTION_TYPE,
  invocableName as serverInvocableName,
  resolveMentionTarget,
  unaddressableTarget,
} from "../apps/server/src/threads/mentions.js";
import {
  invocableName as kitInvocableName,
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
 * ## The paths are derived from `DOCUMENT_ROOTS`, not written out
 *
 * The two implementations are independent — the server classifies against
 * `DOCUMENT_ROOTS`, the kit runs two regexes — so what this file is worth is
 * exactly the set of paths it thinks to ask about. Its first version asked about
 * five hand-written rows, which is a test of the shapes whoever wrote them
 * happened to think of: a new document root, or a change to what `markdown-flat`
 * admits, would have passed in silence (PR #50 review).
 *
 * {@link shapePaths} therefore generates them, one set per root, from the root's
 * own declared {@link DocumentRoot.shape} — the shape's canonical path, the
 * shape's edges, and the near-miss beside it that the root refuses. Adding a
 * root, or moving a root's shape, produces new questions here with nobody
 * editing this file, and the `switch` is exhaustive over `RootShape` so a new
 * *shape* is a type error rather than a gap.
 *
 * **What is deliberately not derived**, and therefore not claimed:
 *
 *   - The projector's non-shape exclusions — a dot-prefixed segment,
 *     `node_modules`. Those decide whether a file is enumerated at all, and no
 *     `documents.path` either rule is handed ever carries one, so the kit does
 *     not model them and this file does not ask.
 *   - The menus' other rules — the generic `@agent`, the typeable-token charset,
 *     the limit, the blank title. Each is one side's own and is tested where it
 *     lives. What is compared here is the **gate**: which rows become offers,
 *     and under what name.
 */

let ws: Workspace;

/**
 * The paths a root's shape admits, plus the near-miss beside it — one stem per
 * root and type, so no two rows in the fixture ever claim one name.
 *
 * Exhaustive over `RootShape` on purpose: a new shape stops compiling here,
 * which is the point at which somebody has to decide what the client's regexes
 * make of it.
 */
function shapePaths(root: DocumentRoot, stem: string): readonly string[] {
  switch (root.shape) {
    case "markdown-tree":
      // Any `*.md` at any depth, so both are documents.
      return [`${root.path}/${stem}.md`, `${root.path}/folder/${stem}-nested.md`];
    case "markdown-flat":
      // The same two paths, of which the projector takes only the first: this is
      // the pair that fails here the day `markdown-flat` starts admitting depth.
      return [`${root.path}/${stem}.md`, `${root.path}/folder/${stem}-nested.md`];
    case "skill-tree":
      return [
        `${root.path}/${stem}/${SKILL_FILENAME}`,
        // "Only files named `SKILL.md`, **at any depth**" — the directory under
        // the root is the name however deep the file sits.
        `${root.path}/${stem}-deep/nested/${SKILL_FILENAME}`,
        // A `SKILL.md` with no directory to name it: a document, and named by
        // neither side, because Claude Code discovers a skill by the folder
        // holding it and nothing holds this one (SERVER-127).
        `${root.path}/${SKILL_FILENAME}`,
        // …and a file beside a `SKILL.md`, which is not a document at all.
        `${root.path}/${stem}/notes.md`,
      ];
  }
}

/** One stem per root and type: a root that forces a type needs only one. */
const stemFor = (root: DocumentRoot, type: string): string =>
  root.type === null ? `${root.key}-${type}` : root.key;

/** The types a root's documents can carry, as far as this file is concerned. */
const typesUnder = (root: DocumentRoot): readonly string[] =>
  root.type === null ? [MENTION_TYPE, INVOCATION_TYPE] : [root.type];

interface Sample {
  readonly root: DocumentRoot;
  readonly type: string;
  readonly path: string;
  /** The **projector's** answer, never this file's: does this path make a row? */
  readonly document: boolean;
}

const SAMPLES: readonly Sample[] = DOCUMENT_ROOTS.flatMap((root) =>
  typesUnder(root).flatMap((type) =>
    shapePaths(root, stemFor(root, type)).map((path) => ({
      root,
      type,
      path,
      document: classifyPath(path) !== null,
    })),
  ),
);

/**
 * Every sample the corpus is seeded from: a root whose documents can never carry
 * a mention type — `data/threads`, forced to `thread` — produces no row either
 * side is ever asked about, so seeding it would only add noise. Its **paths** are
 * still compared, by {@link SAMPLES}, because that comparison needs no
 * projection at all.
 */
const SEEDED: readonly Sample[] = SAMPLES.filter(
  (sample) => sample.type === MENTION_TYPE || sample.type === INVOCATION_TYPE,
);

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

  // ── The named rows: the shapes that carry meaning, written out ──
  //
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

  // ── The derived rows: one per shape every root declares ──
  //
  // Titles are generated, unique, and unlike every stem in the fixture, for two
  // reasons. The title alias has to be *exercised* — a row whose title is its
  // stem cannot tell the alias from the name — and a dropped row whose title
  // collided with a kept row's would resolve for the wrong reason. One word,
  // because that is what makes them tokens the mention scanner can produce —
  // which is what made the bare `SKILL.md` a harm rather than a curiosity, its
  // own name being untypeable (SERVER-127).
  SEEDED.forEach((sample, index) => {
    ws.doc({
      id: `doc_p${String(index).padStart(2, "0")}`,
      path: sample.path,
      type: sample.type,
      title: `Titled${index}`,
    });
  });

  ws.reproject();
});

afterAll(() => {
  ws.close();
});

describe("the fixture the two sides are compared over", () => {
  /**
   * The derivation, first: this file's whole claim to catching an unanticipated
   * shape is that it asks about one from every root, so an empty or partial
   * generation would make everything below vacuous in a way no other assertion
   * could see.
   */
  it("asks about every document root, and about both sides of each root's shape", () => {
    expect(new Set(SAMPLES.map((sample) => sample.root.key))).toEqual(
      new Set(DOCUMENT_ROOTS.map((root) => root.key)),
    );
    expect(new Set(SAMPLES.map((sample) => sample.root.shape))).toEqual(
      new Set(DOCUMENT_ROOTS.map((root) => root.shape)),
    );
    // Paths the projector takes, and paths it refuses — both, or the near-misses
    // are not being asked about at all.
    expect(SAMPLES.some((sample) => sample.document)).toBe(true);
    expect(SAMPLES.some((sample) => !sample.document)).toBe(true);
  });

  /**
   * And the seeded corpus is what the projector made of those paths, not what
   * this file expected: every sample it calls a document has a row, and every
   * near-miss has none.
   */
  it("projects exactly the derived paths the roots admit", () => {
    const rows = new Set([
      ...directory(MENTION_TYPE).map((row) => row.path),
      ...directory(INVOCATION_TYPE).map((row) => row.path),
    ]);
    for (const sample of SEEDED) {
      expect([sample.path, rows.has(sample.path)]).toEqual([sample.path, sample.document]);
    }
  });

  /**
   * Non-vacuity, second: with an empty directory, or one where nothing is
   * dropped, every agreement below would hold of a client that offered nothing
   * and of one that offered everything.
   */
  it("holds rows on both sides of the gate, in both types", () => {
    for (const type of [MENTION_TYPE, INVOCATION_TYPE]) {
      const rows = directory(type);
      expect(rows.filter((row) => isAddressableTarget(row)).length).toBeGreaterThan(0);
      expect(rows.filter((row) => !isAddressableTarget(row)).length).toBeGreaterThan(0);
      expect(completions(type).length).toBeLessThan(rows.length);
    }
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

describe("the name each side derives from a path", () => {
  /**
   * The comparison that needs no projection, and therefore the one that can ask
   * about a path no workspace holds: the server's `invocableName` against the
   * kit's, over every derived sample. This is where a root added to
   * `DOCUMENT_ROOTS` bites immediately, whatever type its documents carry.
   */
  it.each(SAMPLES.map((sample) => sample.path))("is the same name on both sides for %s", (path) => {
    expect(kitInvocableName(path)).toBe(serverInvocableName(path));
  });

  /**
   * The same claim over the whole set rather than per path, so a divergence in
   * *either* direction is one failing assertion naming both sides' answers —
   * including the one this file was born pinning. A `SKILL.md` a skills root
   * holds directly is named by no directory, the kit always said `null`, the
   * server said `"SKILL.md"` and indexed the row's typeable **title** alias with
   * it; SERVER-127 made the server agree, and the fixture below now covers the
   * shape through the ordinary dropped-row loop with no exclusion.
   */
  it("disagrees about nothing at all, in either direction", () => {
    const divergent = SAMPLES.map((sample) => sample.path).filter(
      (path) => kitInvocableName(path) !== serverInvocableName(path),
    );
    expect(divergent).toEqual([]);
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
   *
   * **No exclusions.** It carried one until SERVER-127: the bare `SKILL.md`,
   * which the client withheld and the server resolved under its title. Whatever
   * a root's shape refuses now comes through here, so a row that becomes
   * addressable to only one side fails this loop rather than being described
   * somewhere as the way things are.
   */
  const dropped = (): readonly DocRow[] =>
    directory(type).filter((row) => !isAddressableTarget(row));

  it("resolves under no spelling at all, its title included", () => {
    expect(dropped()).not.toHaveLength(0);
    for (const row of dropped()) {
      expect(resolveMentionTarget(ws.db, type, row.title)).toBeNull();
      expect(resolveMentionTarget(ws.db, type, row.title.toLowerCase())).toBeNull();
      expect(resolveMentionTarget(ws.db, type, row.id)).toBeNull();
    }
  });

  /** And the server can say *which* document it skipped, which is the same row. */
  it("is the row the server reports as unaddressable, by name", () => {
    for (const row of dropped()) {
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
    expect(designations()).toContain("Bookkeeper");
    expect(designations()).toContain("Researcher");
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
