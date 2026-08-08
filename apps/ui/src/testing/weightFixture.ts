import type { Doc, DocRow } from "@corpus/contract";
import { docRowFixture } from "@corpus/kit/testing";

/**
 * A workspace's declared weight levels, as the composers' suites meet them
 * (SPEC.md §11's rider; UI-082).
 *
 * The composers read the set from the **orchestrate skill document**, so every
 * surface's suite needs a projected `type: skill` document with a tier table in
 * its body. Shared from here rather than restated per suite for the reason the
 * feature exists at all: five surfaces reading one declaration, and a per-suite
 * copy is how one of them ends up testing a set the others do not offer.
 *
 * The bodies below are **fixtures, not the product's vocabulary** — the shipped
 * table is pinned against the shipped file in
 * `packages/kit/src/weight/weightLevels.test.ts`. What the fixtures exist to
 * prove here is that the composer follows whatever the document says.
 */

export const ORCHESTRATE_SKILL_ID = "doc_orchestrate";

/** The query the kit issues to find the skill: `GET /api/docs?type=skill`. */
export const SKILL_QUERY_SEARCH = "?type=skill";

function table(rows: readonly (readonly [string, string])[]): string {
  return [
    "## Delegation",
    "",
    "| Weight | Key | Model | What falls here |",
    "| --- | --- | --- | --- |",
    ...rows.map(([label, key]) => `| ${label} | ${key} | **A model** | Guidance for the agent. |`),
    "",
    "Nothing outside this table declares a level.",
  ].join("\n");
}

/** Three levels, spelled as the shipped template spells them. */
export const THREE_LEVELS = table([
  ["Small and mechanical", "light"],
  ["Standard", "standard"],
  ["Heavy or judgment-laden", "heavy"],
]);

/** The same three with the middle one reworded — the rename round trip. */
export const RENAMED_LEVELS = table([
  ["Small and mechanical", "light"],
  ["Ordinary", "standard"],
  ["Heavy or judgment-laden", "heavy"],
]);

/** A fourth level added, to prove the picker follows with no code change. */
export const FOUR_LEVELS = table([
  ["Small and mechanical", "light"],
  ["Standard", "standard"],
  ["Heavy or judgment-laden", "heavy"],
  ["Exhaustive", "exhaustive"],
]);

/** A skill that declares nothing parseable — a workspace on an older template. */
export const NO_LEVELS = "## Delegation\n\nDispatch through the Task tool.\n";

/** The row `GET /api/docs?type=skill` answers with. */
export function skillRow(): DocRow {
  return docRowFixture({
    id: ORCHESTRATE_SKILL_ID,
    type: "skill",
    title: "orchestrate",
    path: ".claude/skills/orchestrate/SKILL.md",
  });
}

/** The document `GET /api/docs/{id}` answers with, carrying the declaration. */
export function skillDoc(body: string = THREE_LEVELS): Doc {
  return {
    frontmatter: {
      id: ORCHESTRATE_SKILL_ID,
      type: "skill",
      title: "orchestrate",
      path: ".claude/skills/orchestrate/SKILL.md",
      status: "open",
      tags: [],
      created: null,
      updated: null,
      due: null,
      reviewed: null,
      evergreen: false,
      parent: null,
      agent: null,
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra: {},
    },
    body,
    anchors: [],
    backlinks: [],
  } as unknown as Doc;
}

/**
 * Everything a `readerTransport` needs to answer with a declaration: the skill
 * row for the type query and the document for the read.
 */
export function weightWiring(body: string = THREE_LEVELS): {
  readonly docs: readonly Doc[];
  readonly rows: Readonly<Record<string, readonly DocRow[]>>;
} {
  return { docs: [skillDoc(body)], rows: { [SKILL_QUERY_SEARCH]: [skillRow()] } };
}

/** The keys the fixture declarations offer, in order — what a picker must show. */
export const THREE_KEYS = ["light", "standard", "heavy"] as const;
