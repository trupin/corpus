import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/**
 * Offset pagination, shared by every collection route. Offsets (rather than
 * cursors) because the projection is a local SQLite database queried with
 * `LIMIT`/`OFFSET` and the board's lists are small and re-fetched wholesale on
 * invalidation (SPEC.md §2.2 rule 3).
 */
export const PaginationQuerySchema = z.object({
  limit: openapi(z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT), {
    param: { name: "limit", in: "query", required: false },
    description: `Maximum rows to return (1–${MAX_PAGE_LIMIT}).`,
  }),
  // The documented schema is spelled out because `z.coerce.number()` accepts
  // `null` whenever the coerced value (0) satisfies the constraints, which zod
  // faithfully reports as `type: ["integer", "null"]`. A query string can never
  // carry a null, so publishing it would only leak `number | null` into every
  // generated client signature.
  offset: openapi(z.coerce.number().int().min(0).default(0), {
    param: { name: "offset", in: "query", required: false },
    type: "integer",
    minimum: 0,
    default: 0,
    description: "Rows to skip before collecting the page.",
  }),
});

export const PageMetaSchema = openapi(
  z.object({
    total: z
      .number()
      .int()
      .min(0)
      .describe(
        "Total rows matching the query, ignoring pagination — and ignoring **only** pagination. " +
          "Every filter the request carried narrows the count exactly as it narrows the page, so " +
          "the bound line a list draws is always about the set that list is showing.",
      ),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
  }),
  "PageMeta",
);

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PageMeta = z.infer<typeof PageMetaSchema>;
