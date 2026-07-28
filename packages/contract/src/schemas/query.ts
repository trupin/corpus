import { z } from "@hono/zod-openapi";
import { ACTORS } from "../actor.js";
import { ActorSchema } from "./actor.js";
import { CORE_DOC_TYPES, DOC_STATUSES, docRowBaseShape } from "./doc.js";
import { DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { PageMetaSchema, PaginationQuerySchema } from "./pagination.js";
import { THREAD_AGENT_STATES, ThreadAgentSchema } from "./thread.js";
import { IsoDateSchema, IsoDateTimeSchema } from "./time.js";

/**
 * `GET /api/docs` is the single collection query behind every list (SPEC.md
 * §9.2): the board's columns, the search overlay, the Attention view and every
 * autocomplete all compose the same grammar. Everything in this module exists to
 * keep that one endpoint honest — the filters, the sort keys, and the two extra
 * columns (`snippets`, `attention`) a row carries that a plain document read
 * does not.
 */

/** Staleness tiers from SPEC.md §5's age ramp; `fresh` is the absence of a tier. */
export const STALE_TIERS = ["aging", "stale", "very-stale"] as const;

export const StaleTierSchema = z.enum(STALE_TIERS);

/**
 * The reasons a row lands in Attention (SPEC.md §11). `needs=me` is their union;
 * a row's own `attention` array carries the individual reasons and never `me`.
 */
export const NEEDS_REASONS = ["unread-reply", "form", "due", "stale", "failed-job"] as const;

export const NeedsReasonSchema = z.enum(NEEDS_REASONS).openapi({
  description: "Why a row needs attention (SPEC.md §11).",
});

export const NEEDS_FILTERS = ["me", ...NEEDS_REASONS] as const;

export const NeedsFilterSchema = z.enum(NEEDS_FILTERS);

/**
 * `order` (CONTRACT-011) sorts ascending by the §11 view key of the same name
 * — the board's column ordering. Ascending only: a board reads left to right,
 * and no §11 surface wants the reverse. Ties and absent keys are deterministic
 * by the documented tiebreak — `order` with nulls **last** (a column with no
 * `order` is placed, never dropped), then `title`, then `id` — so the same
 * column set renders in the same sequence on every load.
 */
export const DOC_SORTS = [
  "updated",
  "-updated",
  "created",
  "-created",
  "due",
  "title",
  "order",
  "relevance",
] as const;

export const DocSortSchema = z.enum(DOC_SORTS);

export const DEFAULT_DOC_SORT = "-updated" satisfies (typeof DOC_SORTS)[number];

/** Relative deadline windows, so a client never has to compute "today" itself. */
export const DUE_KEYWORDS = ["overdue", "today", "week"] as const;

export const DueKeywordSchema = z.enum(DUE_KEYWORDS);

const THREAD_ONLY =
  " Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2).";

const queryParam = (name: string) => ({ param: { name, in: "query" as const, required: false } });

/**
 * The full §9.2 grammar. Values OR within a comma-separated parameter and AND
 * across parameters, so `type=note,view&tag=finance` reads "notes or views that
 * are tagged finance".
 */
export const DocsQuerySchema = PaginationQuerySchema.extend({
  q: z
    .string()
    .min(1)
    .optional()
    .openapi({
      ...queryParam("q"),
      description:
        "Full-text query (FTS5) across document titles, bodies and turn bodies. Matching rows carry " +
        "`snippets`; without `q` every row's `snippets` array is empty.",
    }),
  type: z
    .string()
    .min(1)
    .optional()
    .openapi({
      ...queryParam("type"),
      description:
        `Comma-separated document types; values OR together. Core values: ${CORE_DOC_TYPES.join(", ")}. ` +
        "Open rather than enumerated because plugins define their own types (SPEC.md §5, §10).",
    }),
  status: z
    .enum(DOC_STATUSES)
    .optional()
    .openapi({
      ...queryParam("status"),
      description:
        "Restrict to a lifecycle status. Omitted, the default result set **excludes** " +
        "`status: archived` (SPEC.md §11); passing `status` explicitly overrides that default, so " +
        "`status=archived` is how the archived chip brings them back.",
    }),
  tag: z
    .string()
    .min(1)
    .optional()
    .openapi({
      ...queryParam("tag"),
      description:
        "Comma-separated tags; values OR together. Tags are validated comma-free on write, so the " +
        "separator needs no escaping scheme.",
    }),
  folder: z
    .string()
    .min(1)
    .optional()
    .openapi({
      ...queryParam("folder"),
      description:
        "Path prefix relative to `data/docs/`, matching the folder and its descendants. Threads " +
        "inherit their parent document's folder (SPEC.md §11).",
    }),
  parent: DocumentIdSchema.optional().openapi({
    ...queryParam("parent"),
    description: `Threads whose \`parent\` is this document id.${THREAD_ONLY}`,
  }),
  references: DocumentIdSchema.optional().openapi({
    ...queryParam("references"),
    description:
      "Documents whose body contains `[[<id>]]`, read from the projection's `links` table " +
      "(SPEC.md §9.1). Powers the backlinks panel and the `references:` filter chip.",
  }),
  agent: z
    .enum(THREAD_AGENT_STATES)
    .optional()
    .openapi({
      ...queryParam("agent"),
      description: `Agent participation state from the thread's frontmatter (SPEC.md §6).${THREAD_ONLY}`,
    }),
  author: z
    .enum(ACTORS)
    .optional()
    .openapi({
      ...queryParam("author"),
      description: `Author of the thread's last turn — the "awaiting your answer" half of Attention.${THREAD_ONLY}`,
    }),
  since: IsoDateTimeSchema.optional().openapi({
    ...queryParam("since"),
    description:
      "ISO 8601 instant; matches documents whose `updated` is strictly after it. Distinct from " +
      "`due`, which is a calendar date or a keyword.",
  }),
  due: z
    .union([IsoDateSchema, DueKeywordSchema])
    .optional()
    .openapi({
      ...queryParam("due"),
      description:
        "Either an ISO calendar date (due on or before that date) or one of " +
        `${DUE_KEYWORDS.join(", ")}. Keywords are resolved server-side against the workspace's clock.`,
    }),
  stale: StaleTierSchema.optional().openapi({
    ...queryParam("stale"),
    description:
      "Staleness tier (SPEC.md §5), selecting documents at or beyond it — `aging` includes stale and " +
      "very-stale. Documents with `evergreen: true` never match.",
  }),
  unread: z
    .stringbool()
    .optional()
    .openapi({
      ...queryParam("unread"),
      type: "boolean",
      description: `Threads whose last turn is newer than your last-seen mark (SPEC.md §7).${THREAD_ONLY}`,
    }),
  pinned: z
    .stringbool()
    .optional()
    .openapi({
      ...queryParam("pinned"),
      type: "boolean",
      description:
        "Documents whose frontmatter carries `pinned: true` (`false` selects the rest — a " +
        "missing key reads as `false`). The board's column set is one bounded query — " +
        "`pinned=true&type=view&sort=order` — with every view's `query`, `order` and `column` " +
        "on the rows, so no per-column follow-up read is ever needed (SPEC.md §11). Not " +
        "thread-only: any type may carry the key, though only views render as columns.",
    }),
  needs: NeedsFilterSchema.optional().openapi({
    ...queryParam("needs"),
    description:
      "The Attention filter (SPEC.md §11). `me` is the union of every reason; the individual reasons " +
      `(${NEEDS_REASONS.join(", ")}) back the per-reason chips. Composes with the other filters by ` +
      "intersection — `needs=me&folder=finance` is Attention within that folder.",
  }),
  sort: DocSortSchema.default(DEFAULT_DOC_SORT).openapi({
    ...queryParam("sort"),
    description:
      `Sort key; defaults to \`${DEFAULT_DOC_SORT}\`. \`relevance\` requires \`q\` and is rejected ` +
      "with `400` without it, rather than silently falling back. `order` sorts ascending by the " +
      "§11 view key — the board's column ordering — with the documented tiebreak: `order` with " +
      "nulls last (a view with no `order` key is placed, never dropped), then `title`, then `id`.",
  }),
}).refine((query) => query.sort !== "relevance" || query.q !== undefined, {
  message: "`sort=relevance` is only meaningful with a `q` query.",
  path: ["sort"],
});

/**
 * FTS5's `snippet()` output, converted server-side into alternating matched and
 * unmatched segments. Structured rather than marked-up HTML so the UI renders
 * highlights without `dangerouslySetInnerHTML` and without an escaping contract
 * between server and client.
 */
export const SNIPPET_FIELDS = ["title", "body", "turn"] as const;

export const SnippetFieldSchema = z.enum(SNIPPET_FIELDS);

export const SnippetSegmentSchema = z
  .object({
    text: z.string(),
    match: z
      .boolean()
      .describe("True for the segments the query matched; render those highlighted."),
  })
  .openapi("SnippetSegment");

export const SnippetSchema = z
  .object({
    field: SnippetFieldSchema.describe("Which indexed field the excerpt came from."),
    threadId: ThreadIdSchema.optional().describe(
      "Set only for `turn` snippets, naming the thread the matching turn belongs to.",
    ),
    segments: z
      .array(SnippetSegmentSchema)
      .describe("Alternating unmatched/matched runs; concatenating `text` yields the excerpt."),
  })
  .openapi("Snippet");

/**
 * The §11 thread-row affordances, carried by every row and `null` on rows that
 * are not threads.
 *
 * **Nullable, not optional.** A row always has the key; `null` means "not a
 * thread", the same convention `due`/`reviewed` already use in
 * `docRowBaseShape`. Optionality would make a missing field ambiguous between
 * "not a thread" and "the server forgot", and would let a consumer's exhaustive
 * render silently skip a column.
 *
 * The values are the same ones `DocsQuerySchema`'s thread-only filters select
 * on — `agent`, `parent`, `author` (here `lastAuthor`) and `unread` — so a chip
 * and the row it filters read from one vocabulary.
 */
const threadRowShape = {
  parent: DocumentIdSchema.nullable().describe(
    "The commented document, for a thread row. Null on non-threads and on standalone threads " +
      "(SPEC.md §6) — those two cases are distinguished by `type`, not by this field.",
  ),
  parentTitle: z
    .string()
    .nullable()
    .describe(
      "The current title of whatever `parent` names, or null. Resolved at query time like " +
        "`Job.originTitle` — never a stored copy, so a rename is reflected immediately. Null " +
        "whenever `parent` is null, and when the parent no longer resolves (a deleted parent, " +
        "SPEC.md §9.2); render such a thread as standalone rather than showing a raw id.",
    ),
  agent: ThreadAgentSchema.nullable().describe(
    `Agent participation state (${THREAD_AGENT_STATES.join(", ")}, SPEC.md §6, §8), backing the ` +
      "pending-agent indicator. Null on non-threads.",
  ),
  anchorQuote: z
    .string()
    .nullable()
    .describe(
      "The anchored text this thread hangs off, pinned at the top of a thread row (SPEC.md §11). " +
        "Null on non-threads, on whole-document threads, and on standalone threads.",
    ),
  turnCount: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Number of turns in the thread. Null on non-threads."),
  lastAuthor: ActorSchema.nullable().describe(
    "Author of the thread's last turn — the `author=` filter's column, and the other half of " +
      '"awaiting your answer". Null on non-threads and on a thread with no turns.',
  ),
  lastTurn: z
    .string()
    .nullable()
    .describe(
      "Plain-text preview of the thread's last turn, for the row's second line (SPEC.md §11). " +
        "Null on non-threads and on a thread with no turns.",
    ),
  unread: z
    .boolean()
    .nullable()
    .describe(
      "True when the thread's last turn is newer than your last-seen mark (SPEC.md §7) — the " +
        "unread badge. Null on non-threads.",
    ),
  awaitingAgent: z
    .boolean()
    .nullable()
    .describe(
      "True when the agent has been drawn into an open thread and the last turn is not yet its " +
        "reply — the pending-agent indicator (SPEC.md §8). Null on non-threads.",
    ),
} as const;

/**
 * A row of `GET /api/docs`: the projection's document columns plus what a list
 * needs and a document read does not — why the row wants attention, where the
 * query matched, how stale it is, and the thread affordances §11's type-aware
 * rows render.
 */
export const DocRowSchema = z
  .object({
    ...docRowBaseShape,
    stale: StaleTierSchema.nullable().describe(
      `Staleness tier from SPEC.md §5's age ramp (${STALE_TIERS.join(", ")}), driving the row's ` +
        "age rail, dimming and age chip. **`null` is fresh** — the tiers name degrees of " +
        "staleness and freshness is their absence, which is also why `stale=` takes a tier and " +
        "never `fresh`. Always null for `evergreen: true` documents, which opt out of staleness " +
        "entirely, and for a document whose age is unknown (`updated` and `reviewed` both null): " +
        "an unknown age is not an old one.",
    ),
    ...threadRowShape,
    attention: z
      .array(NeedsReasonSchema)
      .describe(
        "Attention reasons for this row, populated on every response rather than only under " +
          "`needs=`, so any list can render reason chips. Empty when nothing applies; never " +
          "contains `me`, which is the union filter and not a reason.",
      ),
    snippets: z
      .array(SnippetSchema)
      .describe("Search highlights for this row; empty when the query carried no `q`."),
  })
  .openapi("DocRow");

export const DocListSchema = z
  .object({ items: z.array(DocRowSchema), page: PageMetaSchema })
  .openapi("DocList");

export type StaleTier = z.infer<typeof StaleTierSchema>;
export type NeedsReason = z.infer<typeof NeedsReasonSchema>;
export type NeedsFilter = z.infer<typeof NeedsFilterSchema>;
export type DocSort = z.infer<typeof DocSortSchema>;
export type DueKeyword = z.infer<typeof DueKeywordSchema>;
export type DocsQuery = z.infer<typeof DocsQuerySchema>;
export type SnippetField = z.infer<typeof SnippetFieldSchema>;
export type SnippetSegment = z.infer<typeof SnippetSegmentSchema>;
export type Snippet = z.infer<typeof SnippetSchema>;
export type DocRow = z.infer<typeof DocRowSchema>;
export type DocList = z.infer<typeof DocListSchema>;
