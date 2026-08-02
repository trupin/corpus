import { describe, expect, it } from "vitest";
import type { components } from "../client/schema.generated.js";
import {
  RELATIONS,
  RelatedDocSchema,
  RelatedDocsSchema,
  RETRIEVAL_DEFAULT_LIMIT,
  RETRIEVAL_MAX_LIMIT,
  SEMANTIC_INDEX_STATES,
  SearchHitSchema,
  SearchResultsSchema,
  type RelatedDocs,
  type SearchResults,
} from "./retrieval.js";

/**
 * CONTRACT-023's central promise, asserted rather than reviewed: **Phase A did
 * not move.**
 *
 * Phase B adds a second relevance signal to lists that are already signed and
 * shipped, and it adds two endpoints beside them. What it must not do is change
 * anything a client generated against CONTRACT-022 already depends on — because
 * `apps/cli` and `apps/ui` compile against the generated component types, and a
 * widened enum or a newly-required field is a build break rather than a runtime
 * surprise.
 *
 * The A-era shapes below are a **verbatim hand transcription** of
 * `src/client/schema.generated.ts` as CONTRACT-022 committed it (the
 * `SearchResults`, `SearchHit`, `RelatedDocs` and `RelatedDoc` components,
 * descriptions stripped), following `./db.compat.test.ts`'s precedent. They are
 * deliberately derived from nothing in the package: a snapshot that tracked the
 * current types would assert nothing at all.
 *
 * Note which types the assignments use. Under `exactOptionalPropertyTypes`,
 * `z.infer` widens an optional property to `?: T | undefined` while
 * `openapi-typescript` never writes an explicit `| undefined` anywhere in the
 * generated module — so zod-inferred types are assignable *from* generated ones
 * and not *to* them, uniformly, for every optional field in this contract
 * (recorded in `./db.compat.test.ts`). Compatibility is therefore asserted
 * against the **generated** shapes, which are the ones consumers actually hold.
 */

interface AEraSearchHit {
  id: string;
  title: string;
  headingPath: string;
  snippet: string;
}

interface AEraSearchResults {
  hits: AEraSearchHit[];
  semanticIndex?: "current" | "indexing" | "stale" | "disabled";
}

interface AEraRelatedDoc {
  id: string;
  title: string;
  excerpt: string;
  relation: "linked" | "similar" | "both";
}

interface AEraRelatedDocs {
  related: AEraRelatedDoc[];
  semanticIndex?: "current" | "indexing" | "stale" | "disabled";
}

/** What a Phase A server serialized: no `semanticIndex` key at all, and `linked` rows. */
const A_ERA_SEARCH: AEraSearchResults = {
  hits: [
    {
      id: "doc_a1b2c3",
      title: "Mortgage options",
      headingPath: "Mortgage options › Rates",
      snippet: "the 30-year fixed rate assumption is 6.1%",
    },
  ],
};

const A_ERA_RELATED: AEraRelatedDocs = {
  related: [
    {
      id: "doc_b2c3d4",
      title: "Lender comparison",
      excerpt: "Rates quoted by three lenders as of July.",
      relation: "linked",
    },
  ],
};

type WireSearchResults = components["schemas"]["SearchResults"];
type WireRelatedDocs = components["schemas"]["RelatedDocs"];

/** What a Phase B server serializes: the field present, and the other two relations produced. */
const PHASE_B_SEARCH: WireSearchResults = { ...A_ERA_SEARCH, semanticIndex: "stale" };

const PHASE_B_RELATED: WireRelatedDocs = {
  related: [
    ...A_ERA_RELATED.related,
    {
      id: "doc_c3d4e5",
      title: "Quarterly revenue",
      excerpt: "Growth slowed.",
      relation: "similar",
    },
    {
      id: "doc_d4e5f6",
      title: "Sales review",
      excerpt: "The last three months.",
      relation: "both",
    },
  ],
  semanticIndex: "stale",
};

describe("the CONTRACT-022 shapes are frozen, and CONTRACT-023 did not touch them", () => {
  /**
   * C3 of sprint-021: three issue files name the Phase B states `current` /
   * `catching-up` / `lexical-only`. Two of those do not exist and must never be
   * added — a value a client cannot represent is exactly the migration the
   * freeze was signed to avoid. The literal is written out rather than compared
   * to itself, so this fails on any edit to the enum.
   */
  it("still publishes exactly the four signed semantic states, in order", () => {
    expect([...SEMANTIC_INDEX_STATES]).toEqual(["current", "indexing", "stale", "disabled"]);
  });

  it("still publishes exactly the three signed relations, in order", () => {
    expect([...RELATIONS]).toEqual(["linked", "similar", "both"]);
  });

  /**
   * `similar` and `both` have parsed since CONTRACT-022; Phase B makes them
   * *producible*, which is a server change. This asserts the contract half:
   * a row carrying either still parses, with no schema edit behind it.
   */
  it.each(RELATIONS)("parses a %s row without a shape change", (relation) => {
    const parsed = RelatedDocsSchema.parse({
      related: [{ id: "doc_b2c3d4", title: "T", excerpt: "E", relation }],
    });
    expect(parsed.related[0]?.relation).toBe(relation);
  });
});

describe("a Phase A client still compiles and still parses (TEST-874)", () => {
  /**
   * Assignability, not object literals: these are values off a wire, so no
   * excess-property check applies and the assertion is purely "nothing the A-era
   * type promised has gone missing, changed type, or changed optionality".
   */
  it("lets A-era reading code consume a Phase B search payload", () => {
    const consumed: AEraSearchResults = PHASE_B_SEARCH;
    expect(consumed.hits[0]?.headingPath).toBe("Mortgage options › Rates");
    expect(consumed.semanticIndex).toBe("stale");
  });

  it("lets A-era reading code consume a Phase B related payload", () => {
    const consumed: AEraRelatedDocs = PHASE_B_RELATED;
    expect(consumed.related.map((row) => row.relation)).toEqual(["linked", "similar", "both"]);
  });

  it("lets an A-era payload satisfy the current generated types", () => {
    const search: WireSearchResults = A_ERA_SEARCH;
    const related: WireRelatedDocs = A_ERA_RELATED;
    expect(search.hits).toHaveLength(1);
    expect(related.related).toHaveLength(1);
  });

  it("lets an A-era payload satisfy the schemas' inferred types", () => {
    const search: SearchResults = A_ERA_SEARCH;
    const related: RelatedDocs = A_ERA_RELATED;
    expect(search).toEqual(A_ERA_SEARCH);
    expect(related).toEqual(A_ERA_RELATED);
  });

  it("still parses a Phase A payload, so no shipped handler's output turns invalid", () => {
    expect(SearchResultsSchema.parse(A_ERA_SEARCH)).toEqual(A_ERA_SEARCH);
    expect(RelatedDocsSchema.parse(A_ERA_RELATED)).toEqual(A_ERA_RELATED);
  });

  it("lets a wire-typed Phase B payload flow into the schemas' inferred types", () => {
    const search: SearchResults = PHASE_B_SEARCH;
    const related: RelatedDocs = PHASE_B_RELATED;
    expect(search.semanticIndex).toBe("stale");
    expect(SearchResultsSchema.parse(PHASE_B_SEARCH)).toEqual(PHASE_B_SEARCH);
    expect(RelatedDocsSchema.parse(PHASE_B_RELATED)).toEqual(related);
  });
});

/**
 * C4: Phase A's honest answer about the semantic index is **absence** — the
 * shipped server emits no `semanticIndex` key, and two server tests pin that.
 * Those tests get to flip deliberately when SERVER-045 starts emitting the
 * field; what must not happen is the contract forcing the flip by making the
 * field required. Both object literals below are the assertion: under
 * `exactOptionalPropertyTypes` a literal missing a **required** property is a
 * compile error, so these lines stop typechecking the moment `semanticIndex`
 * stops being optional.
 */
/**
 * CONTRACT-024 adds a third ranked surface (`./context.ts`) and must leave Phase
 * A and Phase B where they are (TEST-950, TEST-951). Its one edit to this module
 * is `export` on `semanticIndexField` plus prose — no executable change to the
 * two enums, the two row shapes or the two limit constants. Asserted here rather
 * than reviewed, and asserted against the **generated** components as well as
 * the schemas, since those are the types consumers actually hold.
 */
describe("CONTRACT-024 did not move the retrieval shapes (TEST-950, TEST-951)", () => {
  it("still publishes the two frugal row shapes field for field", () => {
    expect(Object.keys(SearchHitSchema.shape)).toEqual(["id", "title", "headingPath", "snippet"]);
    expect(Object.keys(RelatedDocSchema.shape)).toEqual(["id", "title", "excerpt", "relation"]);
  });

  it("still publishes the two limit constants unchanged", () => {
    expect(RETRIEVAL_DEFAULT_LIMIT).toBe(10);
    expect(RETRIEVAL_MAX_LIMIT).toBe(50);
  });

  /**
   * C4, from the other side: the pack's excerpt row is deliberately **not** a
   * `RelatedDoc`. Widening the frozen shape with an optional `headingPath` for
   * one caller's benefit was the rejected alternative (Open Conflict 2), and
   * this is the assertion that it stayed rejected.
   */
  it("kept `headingPath` off RelatedDoc, so the pack's row is a new shape rather than a widening", () => {
    expect(Object.keys(RelatedDocSchema.shape)).not.toContain("headingPath");
    // Off the wire, so no excess-property check applies: a server that started
    // sending a heading path here would have it dropped, not carried.
    const widened: unknown = {
      related: [{ ...A_ERA_RELATED.related[0], headingPath: "X › Y" }],
    };
    expect(RelatedDocsSchema.parse(widened).related[0]).not.toHaveProperty("headingPath");
  });

  it("still lets a CONTRACT-022-era client compile against both surfaces", () => {
    const search: SearchResults = A_ERA_SEARCH;
    const related: RelatedDocs = A_ERA_RELATED;
    const wireSearch: WireSearchResults = A_ERA_SEARCH;
    const wireRelated: WireRelatedDocs = A_ERA_RELATED;
    expect([search, related, wireSearch, wireRelated].every(Boolean)).toBe(true);
  });
});

describe("`semanticIndex` stays optional on both envelopes (TEST-875)", () => {
  it("keeps it omissible in the generated client components", () => {
    const search: WireSearchResults = { hits: [] };
    const related: WireRelatedDocs = { related: [] };
    expect("semanticIndex" in search).toBe(false);
    expect("semanticIndex" in related).toBe(false);
  });

  it("keeps it omissible on the schemas, which never add it on parse", () => {
    const search = SearchResultsSchema.parse({ hits: [] });
    const related = RelatedDocsSchema.parse({ related: [] });
    expect("semanticIndex" in search).toBe(false);
    expect("semanticIndex" in related).toBe(false);
  });
});
