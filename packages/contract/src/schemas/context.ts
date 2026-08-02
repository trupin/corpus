import { z } from "@hono/zod-openapi";
import { DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { HEADING_PATH_SEPARATOR, RelationSchema, semanticIndexField } from "./retrieval.js";

/**
 * The thread **context pack** (SPEC.md §7 Retrieval discipline — Retrieval Phase
 * C; §9.2's `GET /api/threads/:id/context` bullet). What `corpus thread context`
 * reads, and from Phase C the first thing the comment skill reads about a
 * conversation.
 *
 * **A briefing, never a dump.** §7's signed sentence is the whole design: "The
 * pack is bounded: reading it costs roughly the same however large the corpus
 * grows." So the pack is two halves and no more — the parent-side passage the
 * conversation is *about*, and the top few excerpts from elsewhere that bear on
 * it — each half capped by a named constant below.
 *
 * **What the caps are, and what they are not (CONTRACT-024, sprint-022 C5 /
 * Open Conflict 4).** This is the contract's first *response*-side bound; every
 * other `.max()` in this package is on a request value. Be precise about what
 * it buys, because the issue's original phrasing ("enforceable at the type
 * level") is not achievable and was corrected:
 *
 * - `z.infer` of `z.string().max(n)` is `string`, and of `z.array(T).max(n)` is
 *   `T[]`. **No generated type carries a bound.**
 * - Nothing in the shipped stack validates a response: `app.openapi` handlers
 *   return `c.json(...)` unvalidated, and `openapi-fetch` does no runtime
 *   parsing. **No wire path rejects an over-cap pack.**
 *
 * What the `.max()` calls below genuinely do is publish `maxItems`/`maxLength`
 * into the committed `openapi.json` — a documented ceiling every client author
 * and every future server reads — and make `safeParse` reject overflow, which
 * is what turns this module into a **test oracle**. The division of labour is
 * therefore explicit:
 *
 * | Who | What they owe |
 * | --- | --- |
 * | This module | the named constants, the published ceiling, and a parser that rejects overflow |
 * | `SERVER-047` | actual enforcement, by **rank-then-cut** — rank the candidates, *then* cut to the caps — plus a test that feeds its own assembled pack through {@link ContextPackSchema} and passes |
 *
 * Ranking first and cutting second is the order that matters: cutting first and
 * ranking the remainder returns the excerpts the scan happened to read rather
 * than the ones that matter.
 *
 * **Five shapes, one discriminated field.** A thread is anchored to a passage,
 * to a whole document, to nothing, to a passage that no longer resolves, or to a
 * document that has since been deleted — and a client must be able to tell which
 * by reading {@link ContextPackSchema}'s `shape`, never by probing whether an
 * optional object happens to be present and happens to contain a quote. Each
 * variant is a `strictObject`, so a pack that claims one shape while carrying
 * another shape's fields fails to parse: `orphaned-anchor` carrying a resolved
 * `section`, or `standalone` carrying a `parent` block, are both errors rather
 * than silently-stripped keys. That strictness is what makes SERVER-047's
 * self-parse test worth running.
 *
 * **No query surface in v1.** The route takes a path parameter and nothing else
 * — no `limit`, no `includeArchived`. The bounds live here, in the contract, so
 * `corpus thread context <id>` has no flags to get wrong and no way for a caller
 * to ask for the dump the pack exists to refuse.
 */

/**
 * The five thread shapes a pack can describe (sprint-022 C1 — the issue file
 * counted four and missed the fifth).
 *
 * - `anchored` — `parent` and `anchor` both set, and the anchor still resolves:
 *   the quote plus the whole enclosing section around it.
 * - `whole-document` — a parent with no anchor: the parent's title and its
 *   opening content.
 * - `orphaned-anchor` — a parent and an anchor whose quote no longer matches the
 *   parent verbatim (SPEC.md §6). There is no resolved passage, and the
 *   preserved quote is what the pack carries instead.
 * - `standalone` — no parent at all (the composer's Ask action). No parent
 *   content exists, so there is no parent block.
 * - `parent-deleted` — a parent that `DELETE /api/docs/{id}` removed, leaving
 *   the thread as an orphaned record naming a document that is gone
 *   (SPEC.md §9.2). The standalone shape plus an explicit statement of what was
 *   deleted — **never a `404`**, because the thread and its conversation
 *   plainly exist, and this is exactly the case where an agent most needs a
 *   briefing.
 *
 * **Consumers switch on this, and it is closed.** Unlike
 * `SEMANTIC_INDEX_STATES` — whose whole design is that an unknown value still
 * reads as "degraded" — the shape decides which fields are present, so an
 * exhaustive match is the correct way to read it and a sixth value would be a
 * breaking change rather than an addition.
 */
export const CONTEXT_PACK_SHAPES = [
  "anchored",
  "whole-document",
  "orphaned-anchor",
  "standalone",
  "parent-deleted",
] as const;

export const ContextPackShapeSchema = z.enum(CONTEXT_PACK_SHAPES);

/**
 * How many related excerpts a pack may carry.
 *
 * The same ten as `RETRIEVAL_DEFAULT_LIMIT`, and for the same reason: ten ranked
 * lines is what a first look at a corpus is for. It is a *cap* rather than a
 * default because the route takes no `limit` — there is nothing to raise it to.
 */
export const CONTEXT_MAX_EXCERPTS = 10;

/**
 * How long one related excerpt may be, in characters.
 *
 * Wider than a search hit's single snippet line and far narrower than a body:
 * an excerpt is two or three lines of the matching passage — enough to judge
 * whether the document is worth opening, never enough to substitute for opening
 * it. An excerpt longer than this is **truncated to it, not dropped**: silently
 * losing the best-ranked row because its passage ran long fails the frugality
 * contract in the expensive direction.
 */
export const CONTEXT_MAX_EXCERPT_CHARS = 320;

/**
 * How much parent-side prose a pack may carry — the anchored thread's enclosing
 * section, or the whole-document thread's opening content.
 *
 * **Open Conflict 1's ruling, and the number is chosen, not inherited.** "The
 * whole enclosing section" and "bounded" are in genuine tension: a single
 * heading section can be tens of kilobytes, and the pack's promise is that
 * reading it costs the same at fifty documents and at fifty thousand. The bound
 * wins — *visibly*. A section past this cap is truncated **anchored on the
 * anchor**, so the quote and its immediate surroundings always survive, and the
 * parent block sets `truncated`, so the agent escalates to `corpus doc show`
 * rather than editing against text it believes is complete. A silently
 * truncated section would be worse than no section at all.
 *
 * **Deliberately not the server's `CHUNK_CHAR_BUDGET` (2000).** The parent block
 * must come from the whole-section scan, never from the chunk table — a section
 * larger than the chunk budget is *split* into several chunks, so a chunk is a
 * fragment of a section by construction. Setting this cap to the chunk budget
 * would make the two indistinguishable on the wire; setting it away from the
 * budget makes a 2000-character parent block a diagnostic signature of the wrong
 * implementation rather than a coincidence.
 */
export const CONTEXT_MAX_SECTION_CHARS = 4000;

/**
 * How long the anchor's own quote may be — the text the user selected
 * (SPEC.md §6), and in the orphaned case the only parent-side text there is.
 *
 * Tighter than the section cap because a selection is a phrase or a sentence,
 * not a chapter; a quote past it is truncated and the parent block says so
 * through the same `truncated` flag.
 */
export const CONTEXT_MAX_QUOTE_CHARS = 1000;

/**
 * One related excerpt: **an address, a line or two of the matching passage, and
 * why it is here.**
 *
 * Four fields, matching SPEC.md §7's and §9.2's signed wording — "each an id +
 * heading path + short excerpt" — plus the relation the related surface already
 * publishes. Note what this is *not*: it is **not** a `RelatedDoc`
 * (`./retrieval.ts`), which has no `headingPath` at all and whose excerpt is
 * deliberately the document's *opening* line rather than the passage that
 * matched. Widening the frozen `RelatedDoc` for this one caller was the rejected
 * alternative (sprint-022 C4 / Open Conflict 2).
 *
 * There is no `title`, and that absence is deliberate rather than an oversight:
 * `headingPath` already falls back to the document's title when the matching
 * passage sits under no heading, exactly as a search hit's does, so every row
 * carries a human-readable address without carrying it twice.
 */
export const ContextExcerptSchema = z
  .strictObject({
    id: DocumentIdSchema.describe(
      "The document the excerpt was taken from — a thread id when the passage lives in a thread, " +
        "since threads are documents (SPEC.md §6). Never the thread this pack is about, and never " +
        "its parent: the pack is context *around* the conversation, and both are already in it.",
    ),
    headingPath: z
      .string()
      .describe(
        "Where inside that document the excerpt sits, rendered as the enclosing headings from " +
          `outermost to innermost joined by \`${HEADING_PATH_SEPARATOR}\` ` +
          "(`HEADING_PATH_SEPARATOR`) — the same address a search hit carries, built the same way. " +
          "A passage with no heading above it reports the document's title, so a row always has an " +
          "address a human can read. A **display join**: print it, never split it.",
      ),
    excerpt: z
      .string()
      .max(CONTEXT_MAX_EXCERPT_CHARS)
      .describe(
        `The matching passage, in plain text, at most ${CONTEXT_MAX_EXCERPT_CHARS} characters ` +
          "(`CONTEXT_MAX_EXCERPT_CHARS`) — enough to judge whether the document is worth opening, " +
          "never enough to replace opening it. A longer passage is **truncated to the cap, not " +
          "dropped**, so a well-ranked row never disappears for being verbose. Reading the document " +
          "is a separate, deliberate `GET /api/docs/{id}` on this row's id.",
      ),
    relation: RelationSchema,
  })
  .openapi("ContextExcerpt");

/** The two fields every parent block carries, whatever the thread's shape. */
const parentIdentity = {
  id: DocumentIdSchema.describe("The parent document this thread hangs off."),
  title: z.string().describe("The parent's current title."),
};

/**
 * Whether the parent-side prose in this block was cut to the contract's caps.
 * Declared once so the three block shapes cannot describe it differently.
 */
const truncatedField = z
  .boolean()
  .describe(
    "`true` when the text above was cut to fit `CONTEXT_MAX_SECTION_CHARS` or " +
      "`CONTEXT_MAX_QUOTE_CHARS`. The pack is a briefing, so the cut is a normal outcome for a " +
      "large section rather than an error — but it is **stated**, never silent: an agent that " +
      "needs the rest reads the parent with `corpus doc show`, and an agent editing against a " +
      "section must know whether it saw all of it. Truncation is anchored on the anchor, so the " +
      "quote and its immediate surroundings always survive the cut.",
  );

/** The envelope fields every shape carries, spread into all five variants. */
const contextPackBase = {
  threadId: ThreadIdSchema.describe("The thread this pack briefs."),
  excerpts: z
    .array(ContextExcerptSchema)
    .max(CONTEXT_MAX_EXCERPTS)
    .describe(
      `The most-related excerpts from across the corpus, most related first, at most ` +
        `${CONTEXT_MAX_EXCERPTS} of them (\`CONTEXT_MAX_EXCERPTS\`), ties broken deterministically. ` +
        "Ranked by relatedness to the thread's anchor **and** its text (SPEC.md §7), through the " +
        "reference graph and — from Retrieval Phase B — semantic similarity. Empty when nothing " +
        "relates, which is an answer rather than an error. Never contains the thread itself or its " +
        "parent.",
    ),
  semanticIndex: semanticIndexField,
};

/**
 * The pack for a thread anchored to a passage, and the shape the whole endpoint
 * exists for: the quote the conversation is about, plus the **whole enclosing
 * section** around it rather than a snippet window — because a comment on one
 * sentence is almost never answerable from that sentence alone.
 */
export const AnchoredContextPackSchema = z
  .strictObject({
    shape: z.literal("anchored"),
    ...contextPackBase,
    parent: z
      .strictObject({
        ...parentIdentity,
        headingPath: z
          .string()
          .describe(
            "Where the anchored passage sits in the parent, joined by " +
              `\`${HEADING_PATH_SEPARATOR}\` like every other heading path here, falling back to ` +
              "the parent's title for a passage above the first heading.",
          ),
        quote: z
          .string()
          .max(CONTEXT_MAX_QUOTE_CHARS)
          .describe(
            "The anchor's own text — what the user selected when the thread was opened " +
              `(SPEC.md §6) — at most ${CONTEXT_MAX_QUOTE_CHARS} characters ` +
              "(`CONTEXT_MAX_QUOTE_CHARS`).",
          ),
        section: z
          .string()
          .max(CONTEXT_MAX_SECTION_CHARS)
          .describe(
            "The **whole heading section enclosing the quote**, from its heading line to the " +
              "heading that closes it — not a window around the match, and not one chunk of a " +
              `section (a section may span several). At most ${CONTEXT_MAX_SECTION_CHARS} ` +
              "characters (`CONTEXT_MAX_SECTION_CHARS`); past that it is truncated around the " +
              "quote and `truncated` says so.",
          ),
        truncated: truncatedField,
      })
      .describe("The passage the conversation is about, and the section it lives in."),
  })
  .openapi("AnchoredContextPack");

/**
 * The pack for a thread on a whole document: the parent's title and its opening
 * content (SPEC.md §7). The **opening**, not the body and not the list row's
 * stored excerpt — a fixed leading slice cut mid-word is a worse briefing than
 * the document's first section.
 */
export const WholeDocumentContextPackSchema = z
  .strictObject({
    shape: z.literal("whole-document"),
    ...contextPackBase,
    parent: z
      .strictObject({
        ...parentIdentity,
        opening: z
          .string()
          .max(CONTEXT_MAX_SECTION_CHARS)
          .describe(
            "The parent's opening content — the preamble above its first heading, or its first " +
              "section when there is no preamble. Whole units of prose, never a character slice " +
              `of the body. At most ${CONTEXT_MAX_SECTION_CHARS} characters ` +
              "(`CONTEXT_MAX_SECTION_CHARS`), with `truncated` set when the cap cut it.",
          ),
        truncated: truncatedField,
      })
      .describe("The parent, identified and opened — there is no anchored passage to show."),
  })
  .openapi("WholeDocumentContextPack");

/**
 * The pack for a thread whose anchor no longer resolves (SPEC.md §6).
 *
 * **The orphan condition is a claim the pack makes, not an absence a client
 * infers.** There is deliberately no `section` and no `headingPath` here: the
 * quote does not match the parent verbatim any more, so there is no passage to
 * address and nothing to enclose. What survives is the quote itself — §6's
 * promise that an orphaned thread keeps what it was about — and this is where
 * an agent reads it.
 */
export const OrphanedAnchorContextPackSchema = z
  .strictObject({
    shape: z.literal("orphaned-anchor"),
    ...contextPackBase,
    parent: z
      .strictObject({
        ...parentIdentity,
        quote: z
          .string()
          .max(CONTEXT_MAX_QUOTE_CHARS)
          .describe(
            "The preserved anchor text: what the user selected when the thread was opened, kept " +
              "even though the parent no longer contains it verbatim. The parent's current text " +
              "is a `GET /api/docs/{id}` away — the pack does not guess where the passage went, " +
              "because guessing is exactly the misattachment exact-only resolution exists to " +
              "prevent.",
          ),
        truncated: truncatedField,
      })
      .describe(
        "The parent, and the quote that no longer resolves inside it. No resolved passage is " +
          "reported, because there is none.",
      ),
  })
  .openapi("OrphanedAnchorContextPack");

/**
 * The pack for a standalone thread — the composer's Ask action, `parent: null`.
 *
 * **There is no parent block at all**: not an empty object, not a null-filled
 * one. SPEC.md §7 is explicit that "a standalone thread has no parent content",
 * and a shape that has to be read as "present but empty" is precisely the
 * probing this union exists to replace. The pack is its related excerpts,
 * ranked against the thread's own text.
 */
export const StandaloneContextPackSchema = z
  .strictObject({
    shape: z.literal("standalone"),
    ...contextPackBase,
  })
  .openapi("StandaloneContextPack");

/**
 * The pack for a thread whose parent was deleted (sprint-022 Open Conflict 9).
 *
 * `DELETE /api/docs/{id}` leaves a document's threads as orphaned records that
 * still name it (SPEC.md §9.2), so the naive implementation — load the parent,
 * propagate its `404` — answers "no such thread" about a thread that plainly
 * exists. This shape is the answer instead: **`200`, the standalone shape, plus
 * an explicit statement of what is gone.** The conversation is real, the related
 * excerpts are still useful, and this is the case where a briefing is hardest to
 * reconstruct by hand.
 */
export const DeletedParentContextPackSchema = z
  .strictObject({
    shape: z.literal("parent-deleted"),
    ...contextPackBase,
    deletedParent: DocumentIdSchema.describe(
      "The document id the thread still names, which no longer resolves — deleted while the " +
        "thread survived it. Reading it is a `404`; git retains its history. No parent block " +
        "accompanies it, because there is no parent content left to carry.",
    ),
  })
  .openapi("DeletedParentContextPack");

/**
 * The context pack: one of five shapes, discriminated on `shape`.
 *
 * Deliberately **not** registered as a named component. zod-to-openapi renders a
 * discriminated union as `oneOf` with a `discriminator` mapping, which has no
 * `type: "object"` — and `src/openapi.test.ts`'s "every named component is a
 * plain, non-nullable, undefaulted object" invariant is the guard that catches
 * `Named.nullable()` silently rewriting a shared component. Registering the five
 * *variants* and inlining the union keeps that invariant untouched and still
 * publishes every branch as a referenced component, which is what a client
 * generator needs.
 */
export const ContextPackSchema = z.discriminatedUnion("shape", [
  AnchoredContextPackSchema,
  WholeDocumentContextPackSchema,
  OrphanedAnchorContextPackSchema,
  StandaloneContextPackSchema,
  DeletedParentContextPackSchema,
]);

export type ContextPackShape = z.infer<typeof ContextPackShapeSchema>;
export type ContextExcerpt = z.infer<typeof ContextExcerptSchema>;
export type AnchoredContextPack = z.infer<typeof AnchoredContextPackSchema>;
export type WholeDocumentContextPack = z.infer<typeof WholeDocumentContextPackSchema>;
export type OrphanedAnchorContextPack = z.infer<typeof OrphanedAnchorContextPackSchema>;
export type StandaloneContextPack = z.infer<typeof StandaloneContextPackSchema>;
export type DeletedParentContextPack = z.infer<typeof DeletedParentContextPackSchema>;
export type ContextPack = z.infer<typeof ContextPackSchema>;
