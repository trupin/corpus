import { z } from "@hono/zod-openapi";

/**
 * W3C-style text-quote selector, stored in the frontmatter of the *commented*
 * document and keyed by anchor id (SPEC.md §6). The body stays clean — there are
 * no inline markers — and resolution happens at read time.
 */
export const TextQuoteSelectorSchema = z
  .object({
    exact: z.string().min(1).describe("The quoted text the thread is attached to."),
    prefix: z
      .string()
      .default("")
      .describe("Text immediately preceding `exact`, for disambiguation."),
    suffix: z
      .string()
      .default("")
      .describe("Text immediately following `exact`, for disambiguation."),
  })
  .openapi("TextQuoteSelector");

export type TextQuoteSelector = z.infer<typeof TextQuoteSelectorSchema>;
