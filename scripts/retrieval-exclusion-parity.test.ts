import {
  CORE_DOC_TYPES,
  RelatedQuerySchema,
  RETRIEVAL_MAX_LIMIT,
  SearchQuerySchema,
} from "@corpus/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALWAYS_RANKED_TYPE,
  neighbourExclusionNote,
  NEIGHBOUR_ONLY_TYPES,
  SEARCH_EXCLUSION_NOTE,
  SEARCH_KEEPS_NEIGHBOUR_TYPES_NOTE,
  UNRANKED_NEIGHBOUR_TYPES,
  UNRANKED_SEARCH_TYPES,
} from "../apps/cli/src/commands/retrieval.js";
import { relatedCommand } from "../apps/cli/src/commands/doc/related.js";
import { searchCommand } from "../apps/cli/src/commands/search.js";
import { contextCommand } from "../apps/cli/src/commands/thread/context.js";
import { createWorkspace, type Workspace } from "../apps/server/src/docs/corpus-fixture.js";
import { relatedDocs } from "../apps/server/src/docs/related.js";
import { searchCorpus } from "../apps/server/src/search/search.js";
import { threadContextPack } from "../apps/server/src/threads/context.js";
import type { ThreadReader } from "../apps/server/src/threads/read.js";

/**
 * **What the CLI's help says retrieval skips, against what retrieval actually
 * skips** (CLI-069).
 *
 * The help text describing SERVER-144's ranking exclusion has now been wrong
 * twice, and both times for one reason: it restated a server-side list in prose
 * with nothing tying the two together. It said `Five document types` and
 * `3 of 5 hits` while the shipped rule dropped two types on search and four on
 * the neighbour surfaces, and named `template` as excluded when it never was.
 *
 * ## Why the check is here
 *
 * `apps/server` is not upstream of `apps/cli` — the dependency direction runs
 * `packages/contract` → `apps/cli` (CLAUDE.md → Repository Structure) — so the
 * CLI cannot import the server's `UNRANKED_DOC_TYPES` and compose its help from
 * it. `scripts/` is the one tree that may look at both and ask whether the words
 * match the behaviour, which is `stub-server-parity.test.ts`'s and
 * `missing-profile-parity.test.ts`'s reason for living here too.
 *
 * ## The measurement is the production code, not a model of it
 *
 * Nothing below reads the server's constants. A real workspace is seeded with
 * one document of **every core type**, each carrying the same phrase, and the
 * three real entry points are called — `searchCorpus` (`GET /api/search`),
 * `relatedDocs` (`GET /api/docs/{id}/related`) and `threadContextPack`
 * (`GET /api/threads/{id}/context`). The types missing from each answer are the
 * measurement, and the CLI's arrays are compared to it.
 *
 * So editing `apps/server/src/docs/filters.ts` turns this red, and so does
 * moving one surface onto the other's list — which no comparison of two
 * constants would catch.
 */

const NOW = Date.parse("2026-08-24T12:00:00Z");

/** The one phrase every seeded document carries, so `q` is constant and type is the variable. */
const PHRASE = "the escrow reserve";

/** `type` → the id seeded for it, for every core type a document can hold. */
const SEEDED: ReadonlyMap<string, string> = new Map(
  CORE_DOC_TYPES.filter((type) => type !== "thread").map((type) => [
    type,
    `doc_${type.replace(/-/g, "")}`,
  ]),
);

/**
 * `skill` and `agent-def` documents are recognised by their root, so they are
 * seeded at the paths `corpus init` writes rather than under `data/docs/`.
 */
const PATHS: Readonly<Record<string, string>> = {
  skill: ".claude/skills/comment/SKILL.md",
  "agent-def": ".claude/agents/resident.md",
};

let ws: Workspace;

/** Every seeded type whose document is absent from `ids`. */
const missingTypes = (ids: readonly string[]): string[] =>
  [...SEEDED]
    .filter(([, id]) => !ids.includes(id))
    .map(([type]) => type)
    .sort();

beforeAll(async () => {
  ws = createWorkspace("cli069-exclusion");

  for (const [type, id] of SEEDED) {
    const path = PATHS[type];
    ws.doc({
      id,
      type,
      ...(path === undefined ? {} : { path }),
      title: `A ${type}`,
      body: `${PHRASE} is recalculated annually, as this ${type} explains.`,
    });
  }
  // The seed the neighbour surfaces expand from: it references every other
  // document, so a type missing from the answer was dropped by the rule rather
  // than by the graph.
  ws.doc({
    id: "doc_seed",
    title: "Seed note",
    body: `${PHRASE}. See ${[...SEEDED.values()].map((id) => `[[${id}]]`).join(", ")}.`,
  });
  ws.thread({
    id: "th_seed",
    title: "About the reserve",
    parent: "doc_seed",
    turns: [{ author: "user", ts: "2026-08-01T09:00:00Z", body: `What about ${PHRASE}?` }],
  });
  ws.reproject();
  await Promise.resolve();
});

afterAll(() => {
  ws.close();
});

const searchIds = async (params: Readonly<Record<string, string>> = {}): Promise<string[]> =>
  (
    await searchCorpus(
      ws.db,
      SearchQuerySchema.parse({ q: PHRASE, limit: String(RETRIEVAL_MAX_LIMIT), ...params }),
      NOW,
      {},
    )
  ).hits.map((hit) => hit.id);

describe("what retrieval actually skips, measured on a real workspace", () => {
  it("is non-vacuous: every seeded type is reachable when its type is named", async () => {
    // Without this, a fixture that failed to seed a type would look exactly like
    // a type the ranking excludes, and every assertion below would pass for the
    // wrong reason.
    for (const [type, id] of SEEDED) {
      expect([type, (await searchIds({ type })).includes(id)]).toEqual([type, true]);
    }
  });

  it("drops exactly the types `corpus search`'s help names", async () => {
    expect(missingTypes(await searchIds())).toEqual([...UNRANKED_SEARCH_TYPES].sort());
  });

  it("lifts the whole default as soon as any type is named, as the help says", async () => {
    // The gate is `if (query.type === undefined)` in `apps/server/src/search/search.ts`.
    // Naming a type is the caller saying what they are after, so the default can
    // only ever subtract from that answer.
    const both = await searchIds({ type: `note,${UNRANKED_SEARCH_TYPES[0]}` });
    expect(both).toContain(SEEDED.get(UNRANKED_SEARCH_TYPES[0]));
  });

  it("drops exactly the types `corpus doc related`'s help names", async () => {
    const rows = await relatedDocs(
      ws.db,
      "doc_seed",
      RelatedQuerySchema.parse({ limit: String(RETRIEVAL_MAX_LIMIT) }),
    );
    expect(missingTypes(rows.related.map((row) => row.id))).toEqual(
      [...UNRANKED_NEIGHBOUR_TYPES].sort(),
    );
  });

  it("drops exactly the types `corpus thread context`'s help names", async () => {
    const reader: ThreadReader = {
      workspaceRoot: ws.config.workspaceRoot,
      projection: ws.db,
      now: () => NOW,
    };
    const pack = await threadContextPack(reader, "th_seed", {});
    expect(missingTypes(pack.excerpts.map((row) => row.id))).toEqual(
      [...UNRANKED_NEIGHBOUR_TYPES].sort(),
    );
  });

  it("ranks a template on all three surfaces, because a template is the user's own", async () => {
    // The rider's one change to the withdrawn implementation, pinned from the
    // CLI's side: the help must not name `template` as excluded, and the reason
    // it must not is measured here rather than asserted about a comment.
    const id = SEEDED.get(ALWAYS_RANKED_TYPE);
    expect(await searchIds()).toContain(id);
    expect(
      (
        await relatedDocs(
          ws.db,
          "doc_seed",
          RelatedQuerySchema.parse({ limit: String(RETRIEVAL_MAX_LIMIT) }),
        )
      ).related.map((row) => row.id),
    ).toContain(id);
  });
});

describe("the help the CLI prints for those surfaces", () => {
  /**
   * The prose is **composed** from the arrays measured above, so this asserts
   * the composition reached the registry rather than that some paragraph happens
   * to contain the right words. A hand-typed restatement — the failure mode this
   * whole file exists for — cannot satisfy an equality against the composed
   * string.
   */
  it("carries the composed exclusion note in `corpus search`", () => {
    expect(searchCommand.description).toContain(SEARCH_EXCLUSION_NOTE);
    expect(searchCommand.description).toContain(SEARCH_KEEPS_NEIGHBOUR_TYPES_NOTE);
  });

  it("carries the composed exclusion note in both neighbour verbs", () => {
    expect(relatedCommand.description).toContain(neighbourExclusionNote("corpus doc related"));
    expect(contextCommand.description).toContain(neighbourExclusionNote("corpus thread context"));
  });

  it("names every excluded type where it is excluded", () => {
    for (const type of UNRANKED_SEARCH_TYPES) {
      expect(SEARCH_EXCLUSION_NOTE).toContain(`\`${type}\``);
    }
    for (const type of UNRANKED_NEIGHBOUR_TYPES) {
      expect(neighbourExclusionNote("corpus doc related")).toContain(`\`${type}\``);
    }
  });

  it("never names `template` as excluded, in any of the three blocks", () => {
    // The claim the withdrawn implementation got wrong. Each block may mention
    // the type — it says the type is *kept* — so the check is that no block
    // states it as an exclusion, which the composed lists cannot do because the
    // type is in neither array.
    expect([...UNRANKED_NEIGHBOUR_TYPES]).not.toContain(ALWAYS_RANKED_TYPE);
    for (const block of [SEARCH_EXCLUSION_NOTE, neighbourExclusionNote("corpus doc related")]) {
      expect(block).toContain(`\`${ALWAYS_RANKED_TYPE}\` is **not**`);
    }
  });

  it("says how to reach an excluded type, so the exclusion never reads as out of reach", () => {
    // Criterion 3 of CLI-069. `--type skill` is the comment skill's own genesis
    // lookup and must be findable from every block that mentions the exclusion.
    const escape = `corpus search --type ${UNRANKED_SEARCH_TYPES[0]}`;
    expect(neighbourExclusionNote("corpus doc related")).toContain(escape);
    expect(SEARCH_EXCLUSION_NOTE).toContain(`\`--type ${UNRANKED_SEARCH_TYPES[0]}\``);
  });

  it("carries no count that was typed by hand", () => {
    // Every figure in these blocks is composed from an array's length, so the
    // stale `Five document types` and `3 of 5 hits` cannot come back. The one
    // surviving figure is the SHARED-070 audit's 52%, which measures token
    // share rather than list length and is quoted in the server's own comment.
    expect(SEARCH_EXCLUSION_NOTE).toContain("two document types");
    expect(neighbourExclusionNote("corpus doc related")).toContain("Four document types");
    expect(UNRANKED_SEARCH_TYPES).toHaveLength(2);
    expect(UNRANKED_NEIGHBOUR_TYPES).toHaveLength(4);
    expect(NEIGHBOUR_ONLY_TYPES).toHaveLength(2);
  });
});
