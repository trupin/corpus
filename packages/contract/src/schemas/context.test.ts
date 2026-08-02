import { describe, expect, it } from "vitest";
import {
  AnchoredContextPackSchema,
  CONTEXT_MAX_EXCERPT_CHARS,
  CONTEXT_MAX_EXCERPTS,
  CONTEXT_MAX_QUOTE_CHARS,
  CONTEXT_MAX_SECTION_CHARS,
  CONTEXT_PACK_SHAPES,
  ContextExcerptSchema,
  ContextPackSchema,
  DeletedParentContextPackSchema,
  OrphanedAnchorContextPackSchema,
  StandaloneContextPackSchema,
  WholeDocumentContextPackSchema,
  type ContextPack,
} from "./context.js";
import { RELATIONS, SEMANTIC_INDEX_STATES } from "./retrieval.js";

const excerpt = {
  id: "doc_b2c3d4",
  headingPath: "Lender comparison › Rates",
  excerpt: "Three lenders quoted between 5.9% and 6.4% in July.",
  relation: "linked" as const,
};

const base = { threadId: "th_x9y8", excerpts: [excerpt] };

const ANCHORED = {
  shape: "anchored" as const,
  ...base,
  parent: {
    id: "doc_a1b2c3",
    title: "Mortgage options",
    headingPath: "Mortgage options › Rates",
    quote: "the 30-year fixed rate assumption is 6.1%",
    section: "## Rates\n\nWe assume the 30-year fixed rate assumption is 6.1% through 2027.",
    truncated: false,
  },
};

const WHOLE_DOCUMENT = {
  shape: "whole-document" as const,
  ...base,
  parent: {
    id: "doc_a1b2c3",
    title: "Mortgage options",
    opening: "A comparison of the three offers on the table.",
    truncated: false,
  },
};

const ORPHANED = {
  shape: "orphaned-anchor" as const,
  ...base,
  parent: {
    id: "doc_a1b2c3",
    title: "Mortgage options",
    quote: "the 30-year fixed rate assumption is 6.1%",
    truncated: false,
  },
};

const STANDALONE = { shape: "standalone" as const, ...base };

const PARENT_DELETED = {
  shape: "parent-deleted" as const,
  ...base,
  deletedParent: "doc_a1b2c3",
};

const ALL_SHAPES = [ANCHORED, WHOLE_DOCUMENT, ORPHANED, STANDALONE, PARENT_DELETED];

/** `n` characters of prose, so a length assertion reads as a length rather than as content. */
const chars = (n: number): string => "x".repeat(n);

describe("the five thread shapes (TEST-943, TEST-944)", () => {
  it("names exactly the five shapes sprint-022 C1 found, in order", () => {
    expect([...CONTEXT_PACK_SHAPES]).toEqual([
      "anchored",
      "whole-document",
      "orphaned-anchor",
      "standalone",
      "parent-deleted",
    ]);
  });

  it.each(ALL_SHAPES)("round-trips a $shape pack unchanged", (pack) => {
    expect(ContextPackSchema.parse(pack)).toEqual(pack);
  });

  /**
   * The point of the discrimination: a consumer reads **one** field to learn
   * which case it holds, rather than probing whether an optional object happens
   * to be present and happens to contain a quote. The `switch` below is
   * exhaustive by construction — the union's members carry a `shape` literal
   * each — and narrows to the fields each case actually has.
   */
  it.each(ALL_SHAPES)("narrows $shape to its own fields on one discriminated read", (raw) => {
    const pack: ContextPack = ContextPackSchema.parse(raw);
    switch (pack.shape) {
      case "anchored":
        expect(pack.parent.section).toContain("6.1%");
        expect(pack.parent.quote).toContain("6.1%");
        break;
      case "whole-document":
        expect(pack.parent.opening).toContain("three offers");
        break;
      case "orphaned-anchor":
        expect(pack.parent.quote).toContain("6.1%");
        break;
      case "standalone":
        expect(pack).not.toHaveProperty("parent");
        break;
      case "parent-deleted":
        expect(pack.deletedParent).toBe("doc_a1b2c3");
        break;
    }
  });

  it("rejects an unknown shape rather than degrading it to a known one", () => {
    expect(ContextPackSchema.safeParse({ ...STANDALONE, shape: "whole-doc" }).success).toBe(false);
  });

  /**
   * The negative half of TEST-943: a pack that *claims* one case while carrying
   * another case's fields must fail, not lose the stray keys silently. Every
   * variant is a `strictObject`, which is what makes this true — and what makes
   * SERVER-047's self-parse test (TEST-970) worth running.
   */
  it.each([
    ["a standalone pack carrying a parent block", { ...STANDALONE, parent: ANCHORED.parent }],
    [
      "a standalone pack carrying a deleted-parent statement",
      { ...STANDALONE, deletedParent: "doc_a1b2c3" },
    ],
    [
      "a parent-deleted pack carrying a parent block",
      { ...PARENT_DELETED, parent: ORPHANED.parent },
    ],
    [
      "a whole-document pack carrying an anchored section",
      { ...WHOLE_DOCUMENT, parent: ANCHORED.parent },
    ],
    [
      "an anchored pack whose parent block is the whole-document one",
      { ...ANCHORED, parent: WHOLE_DOCUMENT.parent },
    ],
  ])("rejects %s", (_label, pack) => {
    expect(ContextPackSchema.safeParse(pack).success).toBe(false);
  });

  /**
   * TEST-944. §6's orphan state is a claim the pack makes, not an absence a
   * client infers: the quote survives, and there is no resolved passage to
   * report — so asserting one is an error rather than extra information.
   */
  it("keeps the preserved quote on an orphaned pack", () => {
    const pack = OrphanedAnchorContextPackSchema.parse(ORPHANED);
    expect(pack.parent.quote).toBe("the 30-year fixed rate assumption is 6.1%");
  });

  it.each([
    ["a section", { section: ANCHORED.parent.section }],
    ["a heading path", { headingPath: ANCHORED.parent.headingPath }],
  ])("rejects an orphaned pack that also asserts %s", (_label, resolved) => {
    const pack = { ...ORPHANED, parent: { ...ORPHANED.parent, ...resolved } };
    expect(OrphanedAnchorContextPackSchema.safeParse(pack).success).toBe(false);
    expect(ContextPackSchema.safeParse(pack).success).toBe(false);
  });

  it("gives the deleted-parent case the standalone shape plus an explicit statement", () => {
    const deleted = DeletedParentContextPackSchema.parse(PARENT_DELETED);
    const standalone = StandaloneContextPackSchema.parse(STANDALONE);
    expect(deleted).not.toHaveProperty("parent");
    expect(deleted.deletedParent).toBe("doc_a1b2c3");
    // Same envelope, one extra statement: the difference is the claim, not the shape of the rest.
    const { shape: _s, deletedParent: _d, ...deletedEnvelope } = deleted;
    const { shape: _s2, ...standaloneEnvelope } = standalone;
    expect(deletedEnvelope).toEqual(standaloneEnvelope);
  });

  it("requires the deleted parent's id, so the case cannot be claimed without naming it", () => {
    const { deletedParent: _omitted, ...withoutId } = PARENT_DELETED;
    expect(ContextPackSchema.safeParse(withoutId).success).toBe(false);
  });
});

describe("the related-excerpt row (TEST-949)", () => {
  /**
   * SPEC.md §7 and §9.2, both signed: "each an id + heading path + short
   * excerpt". Plus the relation the related surface already publishes. C4:
   * `RelatedDoc` was considered and is one field short — it has no
   * `headingPath`, and its excerpt is the document's *opening* line rather than
   * the passage that matched.
   */
  it("is an id, a heading path, a short excerpt and why — and nothing else", () => {
    expect(Object.keys(ContextExcerptSchema.shape)).toEqual([
      "id",
      "headingPath",
      "excerpt",
      "relation",
    ]);
  });

  it("rejects a row missing the heading path the signed text names", () => {
    const { headingPath: _dropped, ...withoutPath } = excerpt;
    expect(ContextExcerptSchema.safeParse(withoutPath).success).toBe(false);
  });

  it.each(RELATIONS)("labels a row %s, reusing the frozen relation vocabulary", (relation) => {
    expect(ContextExcerptSchema.parse({ ...excerpt, relation }).relation).toBe(relation);
  });

  it("admits no fourth relation", () => {
    expect(ContextExcerptSchema.safeParse({ ...excerpt, relation: "referenced" }).success).toBe(
      false,
    );
  });

  it("carries no title, because the heading path already falls back to one", () => {
    expect(ContextExcerptSchema.safeParse({ ...excerpt, title: "Lender comparison" }).success).toBe(
      false,
    );
  });
});

/**
 * TEST-946, and the honest reading of TEST-945 (Open Conflict 4): `z.infer`
 * erases `.max()`, nothing in the shipped stack validates a response, and the
 * enforcement is therefore SERVER-047's rank-then-cut. What these caps *are* is
 * a published ceiling and a parser that rejects overflow — which is what makes
 * this module SERVER-047's test oracle. Each case names the constant rather than
 * repeating its value, so a re-tuned cap does not need the tests re-tuned.
 */
describe("the bounds are exported constants, and overflow is rejected (TEST-945, TEST-946)", () => {
  it("exports every cap as a named constant with a sane value", () => {
    for (const [name, value] of [
      ["CONTEXT_MAX_EXCERPTS", CONTEXT_MAX_EXCERPTS],
      ["CONTEXT_MAX_EXCERPT_CHARS", CONTEXT_MAX_EXCERPT_CHARS],
      ["CONTEXT_MAX_SECTION_CHARS", CONTEXT_MAX_SECTION_CHARS],
      ["CONTEXT_MAX_QUOTE_CHARS", CONTEXT_MAX_QUOTE_CHARS],
    ] as const) {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  /**
   * The parent section cap must never equal the server's `CHUNK_CHAR_BUDGET`
   * (2000). A section larger than the chunk budget is split into several chunks,
   * so a chunk is a fragment of a section by construction — and the pack must
   * carry the section. Keeping the cap away from the budget makes a
   * 2000-character parent block a diagnostic signature of the wrong
   * implementation rather than a coincidence (sprint-022 C2, TEST-957).
   */
  it("keeps the section cap clear of the server's chunk budget, so the two are distinguishable", () => {
    expect(CONTEXT_MAX_SECTION_CHARS).not.toBe(2000);
  });

  it("accepts an excerpt array exactly at the count cap", () => {
    const packed = {
      ...STANDALONE,
      excerpts: Array.from({ length: CONTEXT_MAX_EXCERPTS }, () => excerpt),
    };
    expect(ContextPackSchema.safeParse(packed).success).toBe(true);
  });

  it("rejects an excerpt array one element past the count cap", () => {
    const packed = {
      ...STANDALONE,
      excerpts: Array.from({ length: CONTEXT_MAX_EXCERPTS + 1 }, () => excerpt),
    };
    expect(ContextPackSchema.safeParse(packed).success).toBe(false);
  });

  it("accepts an excerpt string exactly at the length cap", () => {
    const row = { ...excerpt, excerpt: chars(CONTEXT_MAX_EXCERPT_CHARS) };
    expect(ContextExcerptSchema.safeParse(row).success).toBe(true);
  });

  it("rejects an excerpt string one character past the length cap", () => {
    const row = { ...excerpt, excerpt: chars(CONTEXT_MAX_EXCERPT_CHARS + 1) };
    expect(ContextExcerptSchema.safeParse(row).success).toBe(false);
    expect(ContextPackSchema.safeParse({ ...STANDALONE, excerpts: [row] }).success).toBe(false);
  });

  it.each([
    ["anchored", "section", CONTEXT_MAX_SECTION_CHARS, ANCHORED],
    ["whole-document", "opening", CONTEXT_MAX_SECTION_CHARS, WHOLE_DOCUMENT],
    ["anchored", "quote", CONTEXT_MAX_QUOTE_CHARS, ANCHORED],
    ["orphaned-anchor", "quote", CONTEXT_MAX_QUOTE_CHARS, ORPHANED],
  ] as const)("bounds the %s pack's `%s` field in both directions", (_shape, field, cap, pack) => {
    const at = { ...pack, parent: { ...pack.parent, [field]: chars(cap) } };
    const over = { ...pack, parent: { ...pack.parent, [field]: chars(cap + 1) } };
    expect(ContextPackSchema.safeParse(at).success).toBe(true);
    expect(ContextPackSchema.safeParse(over).success).toBe(false);
  });
});

describe("the truncation flag (Open Conflict 1)", () => {
  it.each([
    ["anchored", ANCHORED],
    ["whole-document", WHOLE_DOCUMENT],
    ["orphaned-anchor", ORPHANED],
  ] as const)("is required on the %s parent block, so silence is impossible", (_shape, pack) => {
    const { truncated: _dropped, ...withoutFlag } = pack.parent;
    expect(ContextPackSchema.safeParse({ ...pack, parent: withoutFlag }).success).toBe(false);
  });

  it("is a boolean claim rather than a nullable maybe", () => {
    const flagged = { ...ANCHORED, parent: { ...ANCHORED.parent, truncated: true } };
    expect(ContextPackSchema.parse(flagged)).toEqual(flagged);
    expect(
      ContextPackSchema.safeParse({ ...ANCHORED, parent: { ...ANCHORED.parent, truncated: null } })
        .success,
    ).toBe(false);
  });
});

/**
 * TEST-948 / Open Conflict 3. The pack is the third ranked surface, and it must
 * report the *same* word the other two report for the same workspace — so it
 * reuses `semanticIndexField` rather than declaring an enum beside it. One
 * workspace cannot say `stale` on search and `current` on a pack.
 */
describe("the staleness word is the shared one, not a parallel enum (TEST-948)", () => {
  it.each(SEMANTIC_INDEX_STATES)("accepts %s on every shape", (state) => {
    for (const pack of ALL_SHAPES) {
      expect(ContextPackSchema.safeParse({ ...pack, semanticIndex: state }).success).toBe(true);
    }
  });

  it("admits no state outside the frozen four", () => {
    for (const invented of ["catching-up", "lexical-only", "unknown"]) {
      expect(ContextPackSchema.safeParse({ ...STANDALONE, semanticIndex: invented }).success).toBe(
        false,
      );
    }
  });

  it("stays optional, so a server that makes no claim says nothing", () => {
    const parsed = ContextPackSchema.parse(STANDALONE);
    expect("semanticIndex" in parsed).toBe(false);
  });
});

describe("the pack is bounded by construction, not by convention", () => {
  it("carries no body field on any shape, and no place to put one", () => {
    for (const pack of ALL_SHAPES) {
      expect(ContextPackSchema.safeParse({ ...pack, body: "the whole document" }).success).toBe(
        false,
      );
    }
  });

  it("names the thread it briefs on every shape", () => {
    for (const pack of ALL_SHAPES) {
      const { threadId: _dropped, ...withoutThread } = pack;
      expect(ContextPackSchema.safeParse(withoutThread).success).toBe(false);
    }
  });

  it("validates the id prefixes, so a document id cannot pass for a thread id", () => {
    expect(ContextPackSchema.safeParse({ ...STANDALONE, threadId: "doc_a1b2c3" }).success).toBe(
      false,
    );
    expect(
      ContextPackSchema.safeParse({ ...PARENT_DELETED, deletedParent: "anc_k4f7" }).success,
    ).toBe(false);
  });

  it("accepts an empty excerpt list, which is an answer rather than an error", () => {
    expect(ContextPackSchema.parse({ ...STANDALONE, excerpts: [] }).excerpts).toEqual([]);
  });

  it("lets a thread id appear as an excerpt id, since threads are documents", () => {
    const row = { ...excerpt, id: "th_z1y2" };
    expect(ContextPackSchema.safeParse({ ...STANDALONE, excerpts: [row] }).success).toBe(true);
  });
});

describe("the variant schemas are individually usable, which is what the server assembles against", () => {
  it.each([
    ["AnchoredContextPackSchema", AnchoredContextPackSchema, ANCHORED],
    ["WholeDocumentContextPackSchema", WholeDocumentContextPackSchema, WHOLE_DOCUMENT],
    ["OrphanedAnchorContextPackSchema", OrphanedAnchorContextPackSchema, ORPHANED],
    ["StandaloneContextPackSchema", StandaloneContextPackSchema, STANDALONE],
    ["DeletedParentContextPackSchema", DeletedParentContextPackSchema, PARENT_DELETED],
  ] as const)("parses its own shape through %s", (_name, schema, pack) => {
    expect(schema.parse(pack)).toEqual(pack);
  });

  it("refuses a pack of a different shape through a variant schema", () => {
    expect(AnchoredContextPackSchema.safeParse(STANDALONE).success).toBe(false);
    expect(StandaloneContextPackSchema.safeParse(ANCHORED).success).toBe(false);
  });
});
