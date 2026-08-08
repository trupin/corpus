import { z } from "@hono/zod-openapi";

const EXACT_DESCRIPTION = "The quoted text the thread is attached to.";
const PREFIX_DESCRIPTION = "Text immediately preceding `exact`, for disambiguation.";
const SUFFIX_DESCRIPTION = "Text immediately following `exact`, for disambiguation.";

/**
 * Request-side context is a *disambiguator*, not the stored selector. What ends
 * up in the parent's frontmatter is read off the parent's own bytes around the
 * quote (SERVER-071), so a caller holding only a quote may omit it.
 */
const REQUEST_CONTEXT_NOTE =
  "**Not stored as sent**: on a request it only says which occurrence a repeated quote means. " +
  "The context written into the parent's frontmatter is read off the parent document's own bytes " +
  "around the quote, so omitting this costs nothing whenever the quote occurs once.";

/**
 * W3C-style text-quote selector, stored in the frontmatter of the *commented*
 * document and keyed by anchor id (SPEC.md §6). The body stays clean — there are
 * no inline markers — and resolution happens at read time.
 *
 * Parse-side: frontmatter that omits the context strings yields them as empty,
 * so every reader sees the same three-field shape.
 */
export const TextQuoteSelectorSchema = z
  .object({
    exact: z.string().min(1).describe(EXACT_DESCRIPTION),
    prefix: z.string().default("").describe(PREFIX_DESCRIPTION),
    suffix: z.string().default("").describe(SUFFIX_DESCRIPTION),
  })
  .openapi("TextQuoteSelector");

/**
 * The wire form of the same selector, for request bodies. Identical in meaning,
 * but the context strings are optional rather than defaulted: a `default` would
 * render them as *required* members of the generated client type (see the
 * optional-in/defaulted-out note in `./index.ts`), forcing a caller that holds
 * only a quote to invent surrounding text.
 *
 * Deliberately unregistered as a component — it inlines exactly where the
 * nullable request-side selector already inlined, so the published component
 * list keeps one selector rather than two near-identical ones.
 */
export const TextQuoteSelectorRequestSchema = z.object({
  exact: z.string().min(1).describe(EXACT_DESCRIPTION),
  prefix: z.string().optional().describe(`${PREFIX_DESCRIPTION} ${REQUEST_CONTEXT_NOTE}`),
  suffix: z.string().optional().describe(`${SUFFIX_DESCRIPTION} ${REQUEST_CONTEXT_NOTE}`),
});

/**
 * A half-open span of the *body* a selector resolves into — `[start, end)`,
 * measured in the units `String.prototype.slice` uses (UTF-16 code units), over
 * the markdown body **without** the frontmatter block, which is exactly what
 * `Doc.body` carries.
 *
 * One definition, used in both directions: it is what `ResolvedAnchor.range`
 * reports on a read, and what `POST /api/threads/{id}/reattach` accepts on a
 * write. That symmetry is the point — a client that has a range from a read can
 * send it straight back without translating coordinate spaces, and there is no
 * second spelling of "where in the body" to drift.
 *
 * Deliberately **unregistered** as a component: `ResolvedAnchor` uses it
 * `.nullable()`, and zod-to-openapi propagates a registered name onto derived
 * schemas, which would rewrite the shared component (the same hazard
 * `ExtraFrontmatterSchema` is unregistered for). Inlining it in both places is
 * deterministic and costs nothing.
 */
export const BodyRangeSchema = z.object({
  start: z.number().int().min(0).describe("Offset of the first character, inclusive."),
  end: z.number().int().min(0).describe("Offset one past the last character, exclusive."),
});

export type TextQuoteSelector = z.infer<typeof TextQuoteSelectorSchema>;
export type TextQuoteSelectorRequest = z.infer<typeof TextQuoteSelectorRequestSchema>;
export type BodyRange = z.infer<typeof BodyRangeSchema>;
