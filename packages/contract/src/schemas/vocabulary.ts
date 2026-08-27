import { z } from "zod";
import { openapi } from "./openapi-metadata.js";

/**
 * What a workspace's own vocabulary looks like on the wire (SPEC.md §9.2).
 *
 * SPEC.md §5's **Structured fields** says a convention a workspace invents
 * "becomes a filter the moment it is written". Becoming one is not the same as
 * being findable: an invented field appears in no list anywhere, and neither
 * does a tag — `SearchHit` carries none, which is the defect CONTRACT-026 filed
 * against the search overlay's `tag:` chip in 2026-08 and which this answers for
 * the same price.
 *
 * **Counts, not bare lists.** A menu that ranks by use is worth more than one
 * that ranks alphabetically, and the count is one column in the same `GROUP BY`
 * — free where it is computed and impossible to add later without a wire change.
 *
 * **Keys carry no values.** The response says which extra fields exist, never
 * what they hold. A workspace with a `customer` field on four hundred documents
 * would otherwise return four hundred strings for one completion menu: keys are
 * bounded by the conventions a workspace invents, values by nothing. Tags are
 * the exception and are not one — a tag vocabulary *is* the tag list, which is
 * the whole of what CONTRACT-026 asked for, and tags are already a closed,
 * comma-free, low-cardinality set.
 */
export const TagUseSchema = openapi(
  z.object({
    value: z.string().describe("The tag, lowercased — the form the `tag` filter matches."),
    count: z.number().int().min(0).describe("Documents carrying it, counted once each."),
  }),
  "TagUse",
);

export const ExtraKeyUseSchema = openapi(
  z.object({
    key: z
      .string()
      .describe(
        "The frontmatter key, exactly as written. **Case is preserved**, because " +
          "`json_extract` is case-sensitive and `Owner` is genuinely a different field from " +
          "`owner` — unlike a tag, whose filter matches case-insensitively.",
      ),
    count: z.number().int().min(0).describe("Documents carrying it, counted once each."),
  }),
  "ExtraKeyUse",
);

export const WorkspaceVocabularySchema = openapi(
  z.object({
    tags: z
      .array(TagUseSchema)
      .describe(
        "Every tag in use, most-used first and then alphabetical — deterministic, so a client " +
          "renders the order it is given rather than sorting again.",
      ),
    extraKeys: z
      .array(ExtraKeyUseSchema)
      .describe("Every extra frontmatter key in use (SPEC.md §5), ordered the same way."),
  }),
  "WorkspaceVocabulary",
);

export type TagUse = z.infer<typeof TagUseSchema>;
export type ExtraKeyUse = z.infer<typeof ExtraKeyUseSchema>;
export type WorkspaceVocabulary = z.infer<typeof WorkspaceVocabularySchema>;
