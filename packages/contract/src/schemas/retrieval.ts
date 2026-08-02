import { z } from "@hono/zod-openapi";
import { DocumentIdSchema } from "./id.js";
import { docFilterShape } from "./query.js";

/**
 * Retrieval (SPEC.md §7 Retrieval discipline, §9.2): `GET /api/search` and
 * `GET /api/docs/{id}/related` — the two endpoints `corpus search` and
 * `corpus doc related` are thin clients over, and the reason §1 can claim the
 * agent "retrieves; it never enumerates".
 *
 * **Frugal by contract, which is why these are not `GET /api/docs`.** The
 * collection query already ranks (`sort=relevance`) — but it answers with
 * document *rows*, whose cost scales with the documents rather than with the
 * answer. A hit here is an **address plus a line of context**: id, title, the
 * heading path of the best-matching passage, one snippet line. There is no body
 * field, no excerpt-of-the-body field and no segment array, and that absence is
 * the endpoint's whole reason to exist. Reading a body stays a separate,
 * deliberate act on a retrieved id (`GET /api/docs/{id}`).
 *
 * **The shapes are frozen (SHARED-006's signed drafting decision).** Retrieval
 * ships in phases: Phase A ranks lexically over FTS5 and relates through the
 * `links` graph; Phase B adds semantic relevance to the *same* ranked lists,
 * *in place*, without moving a field. So the two seams Phase B needs already
 * exist and do nothing:
 *
 * - {@link semanticIndexField} rides on both envelopes — absent or `current`
 *   throughout Phase A, with no staleness computation behind it.
 * - {@link RELATIONS} carries `similar` and `both` today though Phase A emits
 *   only `linked`.
 *
 * Widening either later would be precisely the migration the freeze was signed
 * to avoid.
 *
 * **CONTRACT-023 kept that promise and changed nothing here.** Phase B's contract
 * surface is two new endpoints (`./index-maintenance.ts`, `../routes/index-maintenance.ts`)
 * plus a server that starts producing values this file has always published:
 * `SEMANTIC_INDEX_STATES` and {@link RELATIONS} are byte-identical to their
 * CONTRACT-022 form, and the only edits below are prose. In particular the three
 * non-`current` states get their *meanings* — which fact maps to which value —
 * written down in one place, `IndexStatus.state`, rather than being restated
 * here where the counts behind them are not available.
 *
 * **Tolerant queries, like every other read.** These are query schemas, so an
 * unknown parameter is stripped rather than rejected (the strict-bodies,
 * tolerant-reads policy in `./index.ts`). Concretely: a request to
 * `/api/search` carrying `sort=relevance`, `offset=10` or `pinned=true` — the
 * three `GET /api/docs` parameters the signed §9.2 list omits — is **accepted
 * and those parameters are silently ignored**, never a `400`. Ranked retrieval
 * has one order (its ranking) and returns a top-k, not a page, so there is
 * nothing for them to mean; `schemas/retrieval.test.ts` pins the behaviour so
 * the answer is written down rather than discovered.
 */

/**
 * The retrieval result cap, shared by both endpoints.
 *
 * **A decision, not an inheritance.** The list convention is
 * `DEFAULT_PAGE_LIMIT = 50` / `MAX_PAGE_LIMIT = 200` (`./pagination.ts`), and
 * taking it here was the rejected alternative: 200 one-line hits is a page of
 * prose the agent never asked for, in a surface whose entire justification is
 * token frugality. Ten is what a first look at a ranked list is for — the agent
 * reads the top few, picks an id, and reads *that*; fifty is the ceiling for the
 * rare sweep, and still an order of magnitude cheaper than the bodies the sweep
 * replaces. A caller that genuinely wants breadth wants `GET /api/docs`, which
 * pages properly.
 */
export const RETRIEVAL_DEFAULT_LIMIT = 10;
export const RETRIEVAL_MAX_LIMIT = 50;

/**
 * The separator between heading levels in a hit's `headingPath`, pinned here so
 * the server that builds the address and every client that prints it agree on
 * one rendering (the same reason the turn heading's U+00B7 is pinned server-side).
 *
 * It is a **display join**: a consumer prints the path, and must not split on it
 * to recover the individual headings — a heading may legitimately contain the
 * character. Structured breadcrumbs, if a surface ever needs them, are a new
 * field rather than a parse of this one.
 */
export const HEADING_PATH_SEPARATOR = " › ";

/**
 * How caught-up the semantic index is (SPEC.md §9.1) — Phase B's seam,
 * inert in Phase A.
 *
 * **Consumers test `!== "current"`, never a switch.** The one thing a client may
 * conclude from a value other than `current` is that ranking is degraded and it
 * should say so; the individual values exist to let it say *why*. That rule is
 * what keeps the field additive: a Phase B value a client has never heard of
 * still reads as "degraded" instead of falling through an exhaustive match.
 */
export const SEMANTIC_INDEX_STATES = ["current", "indexing", "stale", "disabled"] as const;

export const SemanticIndexStateSchema = z.enum(SEMANTIC_INDEX_STATES);

/**
 * The response-envelope field carrying {@link SemanticIndexStateSchema}, shared
 * by both retrieval envelopes because Phase B degrades both rankings together.
 */
const semanticIndexField = SemanticIndexStateSchema.optional().describe(
  "Whether the semantic half of ranking is caught up (SPEC.md §9.1) — **Retrieval Phase B's seam, " +
    "inert in Phase A**, where it is absent or `current` and nothing computes it. Treat **any** " +
    "value other than `current` as degraded ranking worth telling the caller about, rather than " +
    "matching the values exhaustively: `indexing` (a rebuild or backfill is running), `stale` " +
    "(documents are still pending), `disabled` (no semantic index is configured — lexical ranking " +
    "only). Absent means the server makes no claim, which is Phase A's normal answer. " +
    "`GET /api/index/status` is the detailed surface behind this one word — the same value with " +
    "the counts, the recorded provider/model identity and the rebuild flag it derives from.",
);

/**
 * `GET /api/search`'s parameters, exactly as SPEC.md §9.2 spells them: `q`, the
 * fourteen shared structured filters, and a cap.
 *
 * `q` is **required** — a ranked list with nothing to rank is not a degraded
 * answer, it is a different endpoint (`GET /api/docs`). The filters are spread
 * from {@link docFilterShape}, the single definition `GET /api/docs` also builds
 * from, which is what makes §9.2's "the same set, with the same semantics
 * (including the archived default)" true by construction rather than by review.
 */
export const SearchQuerySchema = z.object({
  q: z
    .string()
    .min(1)
    .openapi({
      param: { name: "q", in: "query", required: true },
      description:
        "The query, and the only required parameter. Phase A matches it lexically (FTS5) across " +
        "document titles, bodies and turn bodies, exactly as `GET /api/docs`'s `q` does; from " +
        "Phase B the same string is also matched semantically and the two relevances combine into " +
        "one ranked list (SPEC.md §9.1). Missing or empty is a `400`, never an unranked everything.",
    }),
  ...docFilterShape,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RETRIEVAL_MAX_LIMIT)
    .default(RETRIEVAL_DEFAULT_LIMIT)
    .openapi({
      param: { name: "limit", in: "query", required: false },
      description:
        `How many hits to return (1–${RETRIEVAL_MAX_LIMIT}, default ${RETRIEVAL_DEFAULT_LIMIT}). ` +
        "Lower than the list endpoints' cap on purpose: retrieval is read by an agent that pays " +
        "for every line, and a top-ten is what a ranked list is for. There is no `offset` — a " +
        "ranked result set is a top-k, not a page; widen `limit` or narrow the filters.",
    }),
});

/**
 * One hit: **an address and a line of context, never a body.**
 *
 * Four fields, and the absences are as contractual as the presences (SPEC.md
 * §9.2: "the document id, title, the heading path of the best-matching passage
 * …, and a one-line snippet — never a body"). There is no score: a rank number
 * is meaningless without the corpus it was computed against, the order already
 * carries it, and Phase B recomputes it from a different combination anyway.
 */
export const SearchHitSchema = z
  .object({
    id: DocumentIdSchema.describe(
      "The document the passage lives in — a thread id for a hit inside a thread, since threads " +
        "are documents (SPEC.md §6). One hit per document: a document matching in several places " +
        "is ranked by its best passage and reported once.",
    ),
    title: z.string().describe("The document's current title, for a line the agent can read."),
    headingPath: z
      .string()
      .describe(
        "Where inside the document the best-matching passage sits — its address, rendered as the " +
          `enclosing headings from outermost to innermost joined by \`${HEADING_PATH_SEPARATOR}\` ` +
          "(`HEADING_PATH_SEPARATOR`). A passage with no heading above it reports the document's " +
          "title, so a hit always has an address. For a hit inside a thread turn it is that turn's " +
          "heading (SPEC.md §6, §9.2). A **display join**: print it, never split it.",
      ),
    snippet: z
      .string()
      .describe(
        "One line of context around the match, in plain text: a single line — no newline, and none " +
          "of the delimiters the full-text index marks matches with — short enough that a client " +
          "prints one hit per row. It is a *taste* of the passage and never the passage: no client " +
          "should try to reconstruct content from it, and no server should widen it into one.",
      ),
  })
  .openapi("SearchHit");

/**
 * The search envelope. Deliberately **not** `{items, page}` like `DocList`:
 * `PageMeta`'s `{total, limit, offset}` would describe paging that does not
 * exist here, and a `total` over a relevance ranking is a number with no use —
 * the tail of a ranked list is not more results, it is worse ones.
 */
export const SearchResultsSchema = z
  .object({
    hits: z
      .array(SearchHitSchema)
      .describe(
        "Best match first, ties broken deterministically so the same query twice returns the same " +
          "order. Empty when nothing matched — an empty ranking, never an error.",
      ),
    semanticIndex: semanticIndexField,
  })
  .openapi("SearchResults");

/**
 * Why a document is related (SPEC.md §9.2). Phase A produces `linked` and
 * nothing else; `similar` and `both` are the frozen shape's other half, parsed
 * from day one so Phase B adds semantic neighbours to the same list without a
 * widening — a value a client cannot represent is exactly the migration the
 * freeze exists to avoid.
 */
export const RELATIONS = ["linked", "similar", "both"] as const;

export const RelationSchema = z
  .enum(RELATIONS)
  .describe(
    "How this document is related: `linked` — the reference graph connects them (an outgoing " +
      "`[[ref]]`, a backlink, or both directions); `similar` — semantic similarity only; `both` — " +
      "linked *and* semantically similar. **Retrieval Phase A emits only `linked`**; the other two " +
      "arrive with the semantic index (SPEC.md §9.1) and are in the vocabulary now so their arrival " +
      "changes no shape.",
  );

/** `GET /api/docs/{id}/related`'s parameters — a cap and the archived flag, and nothing else. */
export const RelatedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RETRIEVAL_MAX_LIMIT)
    .default(RETRIEVAL_DEFAULT_LIMIT)
    .openapi({
      param: { name: "limit", in: "query", required: false },
      description:
        `How many related documents to return (1–${RETRIEVAL_MAX_LIMIT}, default ` +
        `${RETRIEVAL_DEFAULT_LIMIT}) — the same frugal cap ranked search uses, for the same reason.`,
    }),
  // Not shared with `docFilterShape.includeArchived`, deliberately: that
  // description is written around `status`, which this route does not take, so
  // reusing it would publish a sentence about a parameter that is not here. The
  // *rule* is the same one, and says so.
  includeArchived: z
    .stringbool()
    .optional()
    .openapi({
      param: { name: "includeArchived", in: "query", required: false },
      type: "boolean",
      description:
        "Lift the default archived exclusion. Archived documents are left out of the related set " +
        "by default, like every list (SPEC.md §11); `true` widens it into the **union**. Archiving " +
        "is organizational rather than deletion, so an archived neighbour is still a real relation " +
        "— it is just not what an agent expanding from a live document usually wants first.",
    }),
});

/**
 * One related document: **id, title, one line, and why.** The same frugality
 * rule as a search hit — the excerpt is a single line derived from the
 * document's opening text, never the stored multi-line list excerpt and never a
 * body.
 */
export const RelatedDocSchema = z
  .object({
    id: DocumentIdSchema.describe(
      "The related document. Always a document that exists: the `links` table deliberately stores " +
        "references to documents that have not been created yet (SPEC.md §9.1), and handing the " +
        "agent an id it cannot then read would be worse than omitting the row.",
    ),
    title: z.string().describe("The related document's current title."),
    excerpt: z
      .string()
      .describe(
        "A single plain-text line from the start of the document — enough to recognise it, never " +
          "enough to read it. Distinct from a list row's `excerpt`, which is a multi-line leading " +
          "slice: this one is collapsed to one line so a client prints one row per line.",
      ),
    relation: RelationSchema,
  })
  .openapi("RelatedDoc");

/** The related envelope; no paging, for the same reason ranked search has none. */
export const RelatedDocsSchema = z
  .object({
    related: z
      .array(RelatedDocSchema)
      .describe(
        "Most related first, ties broken deterministically. Never contains the document itself, " +
          "and empty when nothing relates to it.",
      ),
    semanticIndex: semanticIndexField,
  })
  .openapi("RelatedDocs");

export type SemanticIndexState = z.infer<typeof SemanticIndexStateSchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResults = z.infer<typeof SearchResultsSchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type RelatedQuery = z.infer<typeof RelatedQuerySchema>;
export type RelatedDoc = z.infer<typeof RelatedDocSchema>;
export type RelatedDocs = z.infer<typeof RelatedDocsSchema>;
