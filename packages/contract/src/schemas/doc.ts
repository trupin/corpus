import { z } from "@hono/zod-openapi";
import { TextQuoteSelectorSchema } from "./anchor.js";
import { AnchorIdSchema, DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { PageMetaSchema, PaginationQuerySchema } from "./pagination.js";
import { ThreadStatusSchema } from "./thread.js";
import { IsoDateSchema, IsoDateTimeSchema } from "./time.js";

/**
 * Document types the product itself defines (SPEC.md §5). The wire type stays an
 * open string because plugins declare their own types (e.g. `todo`, §10) — a
 * closed enum here would make every plugin a contract change.
 */
export const CORE_DOC_TYPES = ["note", "thread", "view", "template", "skill", "agent-def"] as const;

export const CoreDocTypeSchema = z.enum(CORE_DOC_TYPES);

export const DocTypeSchema = z
  .string()
  .min(1)
  .openapi({
    description: `Document type. Core values: ${CORE_DOC_TYPES.join(", ")}. Plugins define their own.`,
    example: "note",
  });

export const DOC_STATUSES = ["open", "resolved", "archived"] as const;

export const DocStatusSchema = z.enum(DOC_STATUSES).openapi({
  description:
    "Lifecycle status; meaning is per type. Archiving is a reversible flip, never a deletion.",
});

export const DocFrontmatterSchema = z
  .object({
    id: DocumentIdSchema,
    type: DocTypeSchema,
    title: z.string(),
    created: IsoDateTimeSchema,
    updated: IsoDateTimeSchema,
    tags: z.array(z.string()),
    status: DocStatusSchema,
    anchors: z
      .record(AnchorIdSchema, TextQuoteSelectorSchema)
      .describe("Text-quote selectors for threads on this document, keyed by anchor id."),
    due: IsoDateSchema.nullable().describe(
      "Optional deadline on any type; surfaces in Attention and filters.",
    ),
    reviewed: IsoDateTimeSchema.nullable().describe(
      'Last explicit "still current" confirmation; staleness runs from max(updated, reviewed).',
    ),
    evergreen: z.boolean().describe("True opts the document out of staleness entirely."),
  })
  .openapi("DocFrontmatter");

/** Where a thread's anchor currently lands in the parent body, resolved at read time (SPEC.md §6). */
export const ResolvedAnchorSchema = z
  .object({
    anchorId: AnchorIdSchema,
    selector: TextQuoteSelectorSchema,
    threadId: ThreadIdSchema,
    threadStatus: ThreadStatusSchema,
    range: z
      .object({ start: z.number().int().min(0), end: z.number().int().min(0) })
      .nullable()
      .describe(
        "Character range in the current body, or null when the selector no longer resolves.",
      ),
    orphaned: z
      .boolean()
      .describe(
        "True when the selector did not resolve; the thread is still fully functional but detached.",
      ),
  })
  .openapi("ResolvedAnchor");

export const DocSchema = z
  .object({
    frontmatter: DocFrontmatterSchema,
    body: z.string().describe("Markdown body, without the frontmatter block."),
    path: z
      .string()
      .describe("Path relative to the workspace root. Presentation only — `id` is identity."),
    anchors: z.array(ResolvedAnchorSchema),
  })
  .openapi("Doc");

/** List row: the projection's `documents` columns, without the body (SPEC.md §9.1). */
export const DocSummarySchema = z
  .object({
    id: DocumentIdSchema,
    type: DocTypeSchema,
    title: z.string(),
    path: z.string(),
    status: DocStatusSchema,
    tags: z.array(z.string()),
    created: IsoDateTimeSchema,
    updated: IsoDateTimeSchema,
    due: IsoDateSchema.nullable(),
    reviewed: IsoDateTimeSchema.nullable(),
    evergreen: z.boolean(),
    excerpt: z.string().describe("Leading plain-text excerpt of the body, for list rows."),
  })
  .openapi("DocSummary");

/**
 * The single collection query behind every list. CONTRACT-001 declares the
 * pagination and the three filters the bootstrap surface needs; the rest of
 * SPEC.md §9.2's grammar (folder, parent, references, agent, author, since, due,
 * stale, unread, needs, sort) arrives with CONTRACT-002 without changing these.
 */
export const DocsQuerySchema = PaginationQuerySchema.extend({
  q: z
    .string()
    .min(1)
    .optional()
    .openapi({
      param: { name: "q", in: "query", required: false },
      description: "Full-text query across document titles, bodies and turn bodies.",
    }),
  type: z
    .string()
    .min(1)
    .optional()
    .openapi({
      param: { name: "type", in: "query", required: false },
      description: `Restrict to a single document type. Core values: ${CORE_DOC_TYPES.join(", ")}.`,
    }),
  status: z
    .enum(DOC_STATUSES)
    .optional()
    .openapi({
      param: { name: "status", in: "query", required: false },
      description:
        "Restrict to a status. Omitted, the result set excludes `archived` documents; passing " +
        "`status` explicitly overrides that default.",
    }),
});

export const DocListSchema = z
  .object({ items: z.array(DocSummarySchema), page: PageMetaSchema })
  .openapi("DocList");

export const CreateDocRequestSchema = z
  .object({
    type: DocTypeSchema,
    title: z.string().min(1),
    body: z
      .string()
      .optional()
      .describe("Omit to pre-fill from the type's `template` document when one exists."),
    folder: z.string().optional().describe("Folder under `data/docs/`; defaults to the root."),
    tags: z.array(z.string()).default([]),
    status: z.enum(DOC_STATUSES).default("open"),
    due: IsoDateSchema.nullable().default(null),
    evergreen: z.boolean().default(false),
  })
  .openapi("CreateDocRequest");

export const UpdateDocRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(DOC_STATUSES).optional(),
    due: IsoDateSchema.nullable().optional(),
    reviewed: IsoDateTimeSchema.nullable()
      .optional()
      .describe('Set to the current instant to record "still current" (SPEC.md §5).'),
    evergreen: z.boolean().optional(),
  })
  .openapi("UpdateDocRequest");

/**
 * Every save runs anchor reconciliation (SPEC.md §6), so the response reports
 * what moved: clients use it to refresh highlight positions and to surface
 * threads that just became detached.
 */
export const AnchorReconciliationSchema = z
  .object({
    remapped: z
      .array(AnchorIdSchema)
      .describe("Anchors whose selector was recomputed against the new body."),
    orphaned: z
      .array(AnchorIdSchema)
      .describe("Anchors whose text was removed; their threads are now detached."),
  })
  .openapi("AnchorReconciliation");

export const UpdateDocResponseSchema = z
  .object({ doc: DocSchema, anchors: AnchorReconciliationSchema })
  .openapi("UpdateDocResponse");

export type DocType = z.infer<typeof DocTypeSchema>;
export type CoreDocType = z.infer<typeof CoreDocTypeSchema>;
export type DocStatus = z.infer<typeof DocStatusSchema>;
export type DocFrontmatter = z.infer<typeof DocFrontmatterSchema>;
export type ResolvedAnchor = z.infer<typeof ResolvedAnchorSchema>;
export type Doc = z.infer<typeof DocSchema>;
export type DocSummary = z.infer<typeof DocSummarySchema>;
export type DocsQuery = z.infer<typeof DocsQuerySchema>;
export type DocList = z.infer<typeof DocListSchema>;
export type CreateDocRequest = z.infer<typeof CreateDocRequestSchema>;
export type UpdateDocRequest = z.infer<typeof UpdateDocRequestSchema>;
export type AnchorReconciliation = z.infer<typeof AnchorReconciliationSchema>;
export type UpdateDocResponse = z.infer<typeof UpdateDocResponseSchema>;
