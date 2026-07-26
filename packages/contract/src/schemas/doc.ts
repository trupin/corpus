import { z } from "@hono/zod-openapi";
import { TextQuoteSelectorSchema } from "./anchor.js";
import { AnchorIdSchema, DocumentIdSchema, ThreadIdSchema } from "./id.js";
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

/**
 * Folder placement under `data/docs/`. Creation is inbox-first (SPEC.md §11
 * "zero-form, inbox-first"), so an omitted folder lands the document in
 * `data/docs/inbox/` rather than at the root.
 */
export const DEFAULT_DOC_FOLDER = "inbox";

const FOLDER_DESCRIPTION =
  "Folder under `data/docs/`, accepted either as a bare name (`finance`) or as the full prefix " +
  `(\`data/docs/finance\`). Defaults to \`${DEFAULT_DOC_FOLDER}\` — creation is inbox-first ` +
  "(SPEC.md §11), and the agent files inbox arrivals per its skill.";

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

/**
 * The projection's `documents` columns, without the body (SPEC.md §9.1). Spread
 * rather than `.extend()`-ed into the list row in `query.ts`: zod-to-openapi
 * carries a registered component name onto derived schemas, so building the row
 * from the raw shape is the only way to get two distinctly named components.
 */
export const docRowBaseShape = {
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
} as const;

export const CreateDocRequestSchema = z
  .object({
    type: DocTypeSchema,
    title: z.string().min(1),
    body: z
      .string()
      .optional()
      .describe("Omit to pre-fill from the type's `template` document when one exists."),
    folder: z.string().optional().describe(FOLDER_DESCRIPTION),
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
 * Moving a document rewrites its path only (SPEC.md §9.2) — the id is assigned
 * at creation and is immutable, so every `[[ref]]`, anchor and thread `parent`
 * survives a move untouched.
 */
export const MoveDocRequestSchema = z
  .object({ folder: z.string().describe(FOLDER_DESCRIPTION) })
  .openapi("MoveDocRequest");

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

/**
 * Deletion is user-only (SPEC.md §7, §9.2). Nothing is hard-deleted from
 * history: git keeps the file, and the document's threads survive as orphaned
 * records that still name it as `parent`.
 */
export const DeleteDocResultSchema = z
  .object({
    deletedId: DocumentIdSchema,
    orphanedThreadIds: z
      .array(ThreadIdSchema)
      .describe(
        "Threads that named the deleted document as `parent`. They keep that id and remain " +
          "readable; their anchors no longer resolve. Drop their caches.",
      ),
  })
  .openapi("DeleteDocResult");

export type DocType = z.infer<typeof DocTypeSchema>;
export type CoreDocType = z.infer<typeof CoreDocTypeSchema>;
export type DocStatus = z.infer<typeof DocStatusSchema>;
export type DocFrontmatter = z.infer<typeof DocFrontmatterSchema>;
export type ResolvedAnchor = z.infer<typeof ResolvedAnchorSchema>;
export type Doc = z.infer<typeof DocSchema>;
export type CreateDocRequest = z.infer<typeof CreateDocRequestSchema>;
export type UpdateDocRequest = z.infer<typeof UpdateDocRequestSchema>;
export type MoveDocRequest = z.infer<typeof MoveDocRequestSchema>;
export type AnchorReconciliation = z.infer<typeof AnchorReconciliationSchema>;
export type UpdateDocResponse = z.infer<typeof UpdateDocResponseSchema>;
export type DeleteDocResult = z.infer<typeof DeleteDocResultSchema>;
