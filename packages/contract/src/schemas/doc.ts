import { z } from "@hono/zod-openapi";
import { TextQuoteSelectorSchema } from "./anchor.js";
import { ExtraFrontmatterSchema } from "./extra.js";
import { AnchorIdSchema, DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { ThreadStatusSchema } from "./thread.js";
import { IsoDateSchema, IsoDateTimeSchema } from "./time.js";
import { warningsField } from "./warning.js";

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

/**
 * **Nullable timestamps (CONTRACT-005 decision, 2026-07-27; extended to
 * `DocFrontmatter` by the SERVER-005 escalation, 2026-07-27).** A document's
 * `created`/`updated` are legitimately absent: a hand-written `SKILL.md` carries
 * no frontmatter timestamps, and the projection stores NULL for it. The wire
 * says `null` rather than an epoch sentinel — the sentinel is a lie every
 * consumer then has to special-case, and "we do not know" is not "1970".
 * Staleness treats an unknown age as **fresh** (`stale: null`), never as
 * ancient, which is the same reading `docs/staleness.ts` already implements.
 *
 * Both response-side shapes say the same thing. The list row (`docRowBaseShape`,
 * `GET /api/docs`) and the single document (`DocFrontmatter`,
 * `GET /api/docs/{id}` and every mutation response) must not disagree about the
 * same file: reading one skill through the two routes previously yielded `null`
 * from one and `1970-01-01T00:00:00Z` from the other.
 *
 * This is a *response*-side statement only. The server's own file-parsing
 * schemas are separate and unaffected.
 */
const UNDATED_DESCRIPTION = (which: string): string =>
  `When the document was ${which}, or \`null\` when the file carries no such timestamp — a ` +
  "hand-written skill file legitimately has none. Render it as “—” rather than " +
  "substituting a date; staleness treats an unknown age as fresh.";

/**
 * **The §11 view keys are first-class core fields, not extra frontmatter**
 * (CONTRACT-011 design decision, 2026-07-27). Three reasons, in force order:
 *
 * 1. Two of the four are server semantics — `pinned` is a `GET /api/docs`
 *    filter and `order` is a sort key, and a key the server filters and sorts
 *    on is by definition not opaque passthrough. Routing them through `extra`
 *    would mean the server reaching into a blob it promises never to read.
 * 2. §11 makes columns core product ("a column IS a `type: view` document");
 *    core keys are closed and validated here, and `query`'s well-formedness
 *    and `column`'s `<plugin>/<type>` format deserve `400`s at the write
 *    boundary, which `extra` deliberately never provides.
 * 3. It keeps `extra`'s contract absolute — *nothing* in it is ever
 *    interpreted by the server, with no view-key asterisk.
 *
 * Plugin keys (`todo.items`, SPEC.md §12) stay in `extra` (`./extra.js`);
 * that split — closed core, open extra — is the whole shape of the surface.
 *
 * Carried on **every** document, not only views: frontmatter is per-file and
 * `type` is an open string, so any file may hold the keys; they simply mean
 * nothing off a view. Shared verbatim between the list row and the single
 * read — `doc.test.ts` pins the descriptions identical, the same rule the
 * nullable timestamps follow.
 */
const PINNED_DESCRIPTION =
  "True pins this `type: view` document to the board as a column (SPEC.md §11). `false` when " +
  "the file carries no `pinned` key. Filter the column set with `GET /api/docs?pinned=true`.";

const ORDER_DESCRIPTION =
  "Board position of a pinned view, ascending under `sort=order` (SPEC.md §11). `null` when the " +
  "file carries no `order` key — such a column is still placed, by the documented tiebreak " +
  "(`order` with nulls last, then `title`, then `id`). Any finite number is legal, so a reorder " +
  "may write midpoints between neighbours instead of renumbering every column.";

const VIEW_QUERY_DESCRIPTION =
  "The stored board query of a `type: view` document (SPEC.md §11): a flat map from " +
  "`GET /api/docs` parameter names to a value or an array of values — arrays OR together, like " +
  'the comma-separated wire form (`{type: ["note", "view"]}` ≡ `type=note,view`). The server ' +
  "stores it and never interprets it: the client compiles it into the collection query and " +
  "renders it as filter chips, so an unknown key degrades in the client, never on the wire. " +
  "`null` when the file carries no `query` key.";

const COLUMN_DESCRIPTION =
  'Plugin column type rendered for this pinned view, as `"<plugin>/<type>"` (SPEC.md §10) — ' +
  "e.g. `todos/board`. `null` when the view is a plain filtered list. A view referencing an " +
  "uninstalled plugin keeps its board position and renders a plugin-missing card (SPEC.md §15).";

const viewQueryValue = z.union([z.string(), z.number(), z.boolean()]);

export const ViewQuerySchema = z
  .record(z.string().min(1), z.union([viewQueryValue, z.array(viewQueryValue)]))
  .openapi({ description: VIEW_QUERY_DESCRIPTION });

/** Exactly one `/` between non-empty, whitespace-free plugin and type names. */
export const COLUMN_REF_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/**
 * Response-side view keys plus the open extra object, spread into both
 * `DocFrontmatterSchema` and `docRowBaseShape` — the same instances, so the
 * two routes cannot describe the same file key differently. All present on
 * every response (`false`/`null`/`{}` when the file omits the key): the
 * nullable-not-optional convention `threadRowShape` documents, and what lets
 * the board read its whole column set from the list response with no N+1.
 */
const viewFrontmatterShape = {
  pinned: z.boolean().describe(PINNED_DESCRIPTION),
  order: z.number().nullable().describe(ORDER_DESCRIPTION),
  query: ViewQuerySchema.nullable().describe(VIEW_QUERY_DESCRIPTION),
  column: z.string().nullable().describe(COLUMN_DESCRIPTION),
  extra: ExtraFrontmatterSchema,
} as const;

export const DocFrontmatterSchema = z
  .object({
    id: DocumentIdSchema,
    type: DocTypeSchema,
    title: z.string(),
    created: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("created")),
    updated: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("last modified")),
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
    ...viewFrontmatterShape,
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
  created: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("created")),
  updated: IsoDateTimeSchema.nullable().describe(UNDATED_DESCRIPTION("last modified")),
  due: IsoDateSchema.nullable(),
  reviewed: IsoDateTimeSchema.nullable(),
  evergreen: z.boolean(),
  excerpt: z.string().describe("Leading plain-text excerpt of the body, for list rows."),
  ...viewFrontmatterShape,
} as const;

/**
 * Creation is zero-form (SPEC.md §11): a type and a title are the whole
 * requirement, and everything else the server fills in. Those fields are
 * therefore `.optional()` with their server-applied default documented, never
 * `.default()` — see the optional-in/defaulted-out note in `./index.ts`.
 */
export const CreateDocRequestSchema = z
  .strictObject({
    type: DocTypeSchema,
    title: z.string().min(1),
    body: z
      .string()
      .optional()
      .describe("Omit to pre-fill from the type's `template` document when one exists."),
    folder: z.string().optional().describe(FOLDER_DESCRIPTION),
    tags: z.array(z.string()).optional().describe("Defaults to no tags."),
    status: z.enum(DOC_STATUSES).optional().describe("Defaults to `open`."),
    due: IsoDateSchema.nullable()
      .optional()
      .describe("Optional deadline. Defaults to `null` — no deadline."),
    evergreen: z
      .boolean()
      .optional()
      .describe("True opts the document out of staleness entirely. Defaults to `false`."),
    pinned: z
      .boolean()
      .optional()
      .describe(
        `${PINNED_DESCRIPTION} Defaults to \`false\` — a view renders as a board column only ` +
          "once pinned.",
      ),
    order: z
      .number()
      .nullable()
      .optional()
      .describe(`${ORDER_DESCRIPTION} Null is the same as omitting it: no \`order\` key.`),
    query: ViewQuerySchema.nullable()
      .optional()
      .describe(`${VIEW_QUERY_DESCRIPTION} Null is the same as omitting it: no \`query\` key.`),
    column: z
      .string()
      .regex(COLUMN_REF_PATTERN, 'A column reference is `"<plugin>/<type>"` — exactly one slash.')
      .nullable()
      .optional()
      .describe(`${COLUMN_DESCRIPTION} Null is the same as omitting it: no \`column\` key.`),
    extra: ExtraFrontmatterSchema.optional(),
  })
  .openapi("CreateDocRequest");

/**
 * Strict (CONTRACT-017): with every field optional, a typoed key — `pinnned`,
 * or a plugin key sent at top level instead of inside `extra` — would otherwise
 * validate as the empty update and silently change nothing.
 */
export const UpdateDocRequestSchema = z
  .strictObject({
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(DOC_STATUSES).optional(),
    due: IsoDateSchema.nullable().optional(),
    reviewed: IsoDateTimeSchema.nullable()
      .optional()
      .describe('Set to the current instant to record "still current" (SPEC.md §5).'),
    evergreen: z.boolean().optional(),
    // The view keys follow the request's own convention — name only what you
    // change. `null` clears the key from the file; subsequent reads report
    // `null` (`false` for `pinned`, whose absent and false states are one).
    pinned: z.boolean().optional().describe(PINNED_DESCRIPTION),
    order: z
      .number()
      .nullable()
      .optional()
      .describe(`${ORDER_DESCRIPTION} On update, \`null\` clears the key from the file.`),
    query: ViewQuerySchema.nullable()
      .optional()
      .describe(`${VIEW_QUERY_DESCRIPTION} On update, \`null\` clears the key from the file.`),
    column: z
      .string()
      .regex(COLUMN_REF_PATTERN, 'A column reference is `"<plugin>/<type>"` — exactly one slash.')
      .nullable()
      .optional()
      .describe(`${COLUMN_DESCRIPTION} On update, \`null\` clears the key from the file.`),
    extra: ExtraFrontmatterSchema.optional(),
  })
  .openapi("UpdateDocRequest");

/**
 * Moving a document rewrites its path only (SPEC.md §9.2) — the id is assigned
 * at creation and is immutable, so every `[[ref]]`, anchor and thread `parent`
 * survives a move untouched.
 */
export const MoveDocRequestSchema = z
  .strictObject({ folder: z.string().describe(FOLDER_DESCRIPTION) })
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

/**
 * What every non-editing document mutation returns — create, move, archive,
 * unarchive. The document is wrapped rather than returned bare so §14's
 * warnings have somewhere to live: a hook that rejected the auto-commit, or a
 * workspace with no git, must surface on the response and not only in a log.
 */
export const DocMutationResponseSchema = z
  .object({ doc: DocSchema, warnings: warningsField })
  .openapi("DocMutationResponse");

export const UpdateDocResponseSchema = z
  .object({ doc: DocSchema, anchors: AnchorReconciliationSchema, warnings: warningsField })
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
    warnings: warningsField,
  })
  .openapi("DeleteDocResult");

export type ViewQuery = z.infer<typeof ViewQuerySchema>;
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
export type DocMutationResponse = z.infer<typeof DocMutationResponseSchema>;
export type UpdateDocResponse = z.infer<typeof UpdateDocResponseSchema>;
export type DeleteDocResult = z.infer<typeof DeleteDocResultSchema>;
