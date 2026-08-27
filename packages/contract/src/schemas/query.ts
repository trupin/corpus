import { z } from "zod";
import { ACTORS } from "../actor.js";
import { ActorSchema } from "./actor.js";
import { CORE_DOC_TYPES, DOC_STATUSES, docRowBaseShape } from "./doc.js";
import { DocumentIdSchema, ThreadIdSchema } from "./id.js";
import { PageMetaSchema, PaginationQuerySchema } from "./pagination.js";
import { THREAD_AGENT_STATES, ThreadAgentSchema } from "./thread.js";
import { IsoDateSchema, IsoDateTimeSchema } from "./time.js";
import { openapi } from "./openapi-metadata.js";

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
 * The reasons a row lands in Attention (SPEC.md §10). `needs=me` is their union;
 * a row's own `attention` array carries the individual reasons and never `me`.
 */
export const NEEDS_REASONS = ["unread-reply", "form", "due", "stale", "failed-job"] as const;

export const NeedsReasonSchema = openapi(z.enum(NEEDS_REASONS), {
  description: "Why a row needs attention (SPEC.md §10).",
});

export const NEEDS_FILTERS = ["me", ...NEEDS_REASONS] as const;

export const NeedsFilterSchema = z.enum(NEEDS_FILTERS);

/**
 * `order` (CONTRACT-011) sorts ascending by the §10 key of the same name — since
 * rider 7 (2026-08-22) a **board's position among boards**, where it used to be
 * a pinned view's position on the board. Ascending only: a board bar reads left
 * to right, and no §10 surface wants the reverse. Ties and absent keys are
 * deterministic by the documented tiebreak — `order` with nulls **last** (a
 * board with no `order` is placed, never dropped), then `title`, then `id` — so
 * the same set renders in the same sequence on every load.
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

/**
 * How far under `folder` a collection listing reaches (CONTRACT-081).
 *
 * The pair is named rather than spelled as a boolean, because a boolean would
 * have to pick which way round `true` means and the reader would have to
 * remember it. `tree` and `self` each name the set being asked for.
 *
 * The two sets exist because two surfaces ask the same question differently. A
 * board's folder column shows a folder's work **and** the conversations about
 * it, so it wants the whole subtree with threads inherited from their parents —
 * that is what `folder` has always meant. The explorer draws one row per folder
 * and asks each folder for its own documents, so it wants exactly one level, and
 * the tree reading is what makes a document appear under every expanded ancestor
 * at once.
 */
export const FOLDER_SCOPES = ["tree", "self"] as const;

export const FolderScopeSchema = z.enum(FOLDER_SCOPES);

/**
 * `tree` — the reading `folder` has always had. The default is not a taste
 * decision: this parameter arrives under a route many callers already use, and
 * defaulting to `self` would silently narrow every board column in the product.
 */
export const DEFAULT_FOLDER_SCOPE = "tree" satisfies (typeof FOLDER_SCOPES)[number];

/** Relative deadline windows, so a client never has to compute "today" itself. */
export const DUE_KEYWORDS = ["overdue", "today", "week"] as const;

export const DueKeywordSchema = z.enum(DUE_KEYWORDS);

const THREAD_ONLY =
  " Thread-only: it no-ops for non-thread types rather than erroring (SPEC.md §9.2).";

const queryParam = (name: string) => ({ param: { name, in: "query" as const, required: false } });

/**
 * SPEC.md §9.2's **Pattern matching**, said once and appended to every filter
 * that honours it (SHARED-011's rider, signed 2026-08-04).
 *
 * The rule is deliberately "a value containing `*` or `?` is a pattern", and
 * not a separate parameter or an opt-in flag, because that is what makes the
 * feature **additive**: every view stored before this release keeps its meaning.
 * `folder=work` has no wildcard and is the prefix match it always was, and
 * `folder=work/*` matched nothing at all before, so no stored query changes its
 * result.
 *
 * A glob is not `q`. `q` is FTS5 — indexed, word-based, and ranked. A glob
 * matches one field's literal text and says nothing about relevance, which is
 * why the two compose rather than compete.
 */
const GLOB_NOTE =
  " **Takes glob patterns** (SPEC.md §9.2): `*` matches any run of characters and `?` matches " +
  "one, so `Catch-Up*` means what it looks like. A value carrying neither character is matched " +
  "exactly as it always was, so no stored query changes meaning. Matching is case-insensitive. " +
  "Distinct from `q`, which ranks whole words across the corpus; a glob matches this field " +
  "literally and says nothing about relevance.";

/**
 * Whether a filter value is a pattern rather than a literal.
 *
 * Exported because the server's predicate builder has to make exactly this
 * judgment, and two copies of "what counts as a glob" is how a query means one
 * thing to the validator and another to the SQL.
 */
export function hasGlob(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

/**
 * The `extra.<key>` namespace's key rule.
 *
 * A key reaches the server as a JSON path (`$."owner"`), so it has to be an
 * identifier. The bind is the guard that matters — SERVER-158 never
 * interpolates — and this pattern is the second one, refusing the request
 * before it is made rather than answering an empty list.
 */
export const EXTRA_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The query-string prefix that opens the namespace: `extra.assignee=theo`. */
export const EXTRA_PARAM_PREFIX = "extra.";

const EXTRA_KEY_MAX = 64;

export const ExtraFilterKeySchema = z
  .string()
  .min(1)
  .max(EXTRA_KEY_MAX)
  .regex(
    EXTRA_KEY_PATTERN,
    "An extra field's name must be an identifier: letters, digits, `_`, `-`.",
  );

/**
 * `extra.<key>=<value>` as it arrives on {@link DocsQuerySchema}, after
 * {@link collectExtraFilters} has lifted the dotted parameters into one record.
 *
 * **There is no absence sentinel.** `extra.owner=` is refused rather than read
 * as "documents with no owner". `stage=`'s empty element is a *core* field's
 * null sentinel, deliberately chosen because a written stage can never be
 * empty; giving an open namespace a second one is design the rider did not
 * sign, and asking for absence is a filter nobody has specified yet.
 */
export const ExtraFilterSchema = z.record(ExtraFilterKeySchema, z.string().min(1));

/**
 * Lifts every `extra.<key>` parameter out of a raw query record and into the
 * single `extra` field the schema declares.
 *
 * **Why a function and not a schema.** Zod cannot restructure sibling keys from
 * inside a field, and wrapping the object in `z.preprocess` would work except
 * that it destroys `.shape` — which `apps/ui/src/board/query/grammar.ts` reads
 * at runtime to derive the query editor's field list, and which
 * `openapi.test.ts` walks to assert both endpoints publish the same filters.
 * Losing either to gain one parse step is the wrong trade, so the lift is an
 * exported function and the two callers that need it (the server's collection
 * handler, the CLI's `doc list`) call the same one.
 *
 * Keys are validated here, so a malformed one is a `400` naming the key rather
 * than a filter that silently matches nothing.
 */
export function collectExtraFilters(
  raw: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  const found: Record<string, string> = {};
  let any = false;
  for (const [name, value] of Object.entries(raw)) {
    if (!name.startsWith(EXTRA_PARAM_PREFIX)) continue;
    any = true;
    const key = name.slice(EXTRA_PARAM_PREFIX.length);
    // Checked here rather than left to the record schema, because a record's
    // own key failure reads "Invalid key in record" and never says which key.
    // The caller mistyped one parameter out of several, and the message it gets
    // has to name that one.
    const checked = ExtraFilterKeySchema.safeParse(key);
    if (!checked.success) {
      throw new z.ZodError([
        {
          code: "custom",
          path: [name],
          message:
            `\`${name}\` is not a filter. An extra field's name must be an identifier — ` +
            `letters, digits, \`_\` and \`-\`, starting with a letter or \`_\` — and ` +
            `\`${key}\` is not.`,
          input: key,
        },
      ]);
    }
    if (value === undefined || value === "") {
      throw new z.ZodError([
        {
          code: "custom",
          path: [name],
          message:
            `\`${name}\` needs a value. There is no way to ask for a document that lacks a ` +
            `field: an empty value is refused rather than read as absence.`,
          input: value,
        },
      ]);
    }
    found[key] = value;
  }
  return any ? ExtraFilterSchema.parse(found) : undefined;
}

/**
 * The structured filters, and **the only definition of them**. `GET /api/docs`
 * and `GET /api/search` share this shape rather than each spelling the grammar
 * out, because SHARED-006 Edit 7 makes that sharing a promise: `/api/search`'s
 * "structured filters are the same set, with the same semantics (including the
 * archived default), as `GET /api/docs`". Two hand-maintained lists that have to
 * agree is exactly the drift the promise forbids, so a filter added here appears
 * on both endpoints with no second edit — `openapi.test.ts` walks this shape and
 * asserts the two published parameter sets are identical, filter by filter.
 *
 * Three parameters `GET /api/docs` carries are deliberately **not** here:
 *
 * - `q` is the query, not a filter, and its optionality is the one thing the two
 *   endpoints genuinely disagree about — optional on the collection query (which
 *   is a list first), required on ranked retrieval (which is nothing without it).
 *   Each endpoint therefore declares its own, with its own description.
 * - `sort` is a list concern, and the signed `/api/search` parameter list omits
 *   it: ranked retrieval has one order, its ranking. (`pinned` was the other
 *   such omission until rider 7 removed it from the API entirely, 2026-08-22.)
 * - `offset` rides on {@link PaginationQuerySchema}, which `/api/search` does not
 *   compose: a ranked result set is a top-k, not a page.
 * - `isParent` (CONTRACT-042) is a genuine structural filter and would belong
 *   here on the merits — ranked retrieval over roots only is a sensible ask —
 *   but §9.2's signed `/api/search` parameter string does not carry it, while
 *   the signed `GET /api/docs` string does. Publishing it on ranked retrieval is
 *   therefore a SPEC rider rather than a contract decision, so it lives on
 *   `DocsQuerySchema` alone until that rider is signed. This is the one
 *   exclusion here that is bookkeeping rather than principle; moving it into
 *   this shape is a one-line change and no consumer breaks.
 */
export const docFilterShape = {
  /**
   * `title` and `body` are filters the SHARED-011 rider **creates**. Its own
   * example is `title=Catch-Up*`, and the collection query carried neither — it
   * had `q` (FTS5 across titles, bodies and turns) and nothing that matched one
   * field literally.
   *
   * They join the shared shape rather than `DocsQuerySchema` alone, so ranked
   * retrieval gets them too. That is the right side of this module's own rule:
   * a structural filter belongs to both endpoints unless §9.2's signed
   * `/api/search` parameter string excludes it, and these two are structural in
   * exactly the way `tag` is.
   */
  title: openapi(z.string().min(1).optional(), {
    ...queryParam("title"),
    description: "Match a document's title." + GLOB_NOTE,
  }),
  body: openapi(z.string().min(1).optional(), {
    ...queryParam("body"),
    description:
      "Match a document's body text. Threads carry their turns in their body, so a glob here " +
      "reaches turn text as stored." +
      GLOB_NOTE,
  }),
  type: openapi(z.string().min(1).optional(), {
    ...queryParam("type"),
    description:
      `Comma-separated document types; values OR together. Core values: ${CORE_DOC_TYPES.join(", ")}. ` +
      "Open rather than enumerated because a workspace may hold documents of a type this build " +
      "has never heard of, and they are searchable like any other (SPEC.md §5, §12's M6).",
  }),
  status: openapi(z.enum(DOC_STATUSES).optional(), {
    ...queryParam("status"),
    description:
      "Restrict to a lifecycle status. Omitted, the default result set **excludes** " +
      "`status: archived` (SPEC.md §10); passing `status` explicitly overrides that default, so " +
      "`status=archived` selects archived documents *only*. To see archived documents " +
      "**alongside** the rest, use `includeArchived=true` — that is the archived chip, not this " +
      "parameter.",
  }),
  /**
   * **The null sentinel is an empty element, and it is what makes a kanban's
   * first column one request** (CONTRACT-074's decision, taken here so UI-152
   * does not have to OR two responses together).
   *
   * §10 puts "a document in scope with no value for the field" in a kanban's
   * first column *beside* the documents actually in its first stage, so that
   * column is a union — and a union is one request only if the filter can OR.
   * So `stage=` is comma-separated like `type` and `tag`, and one of its
   * elements may be empty.
   *
   * **The empty element cannot collide with a real stage**, which is the whole
   * reason it was chosen over a word like `none`: a written stage is a non-empty
   * string (`StageValueSchema`, `./doc.ts`), so the empty element names a value no
   * document can hold and can only mean absence. A reserved word would be a
   * stage vocabulary the product forbids, and §5 calls `stage` free-form.
   *
   * The cost is one reserved character in a stage value — a comma — which is
   * exactly the price `tag` already pays for the same separator, and is why
   * `StageValueSchema` refuses one on write.
   */
  stage: openapi(z.string().optional(), {
    ...queryParam("stage"),
    description:
      "Comma-separated stage values (SPEC.md §5); values OR together like `type` and `tag`, " +
      "and each is an **exact** match. **An empty element selects documents with no `stage` at " +
      "all** — the null sentinel — so a kanban's first column, which holds its first stage " +
      "*and* everything unstaged (SPEC.md §10), is one request: `stage=,triage`. It can never " +
      "collide with a real stage, because a written stage is a non-empty comma-free string, so " +
      "the empty element names a value no document can hold. `stage=` on its own therefore " +
      "selects the unstaged, and omitting the parameter filters nothing at all. Duplicate " +
      "elements collapse. **Not thread-only**: any document may carry a stage. A kanban over " +
      "`status` needs none of this — every document has a status — and draws its columns with " +
      "`status=`.",
  }),
  includeArchived: openapi(z.stringbool().optional(), {
    ...queryParam("includeArchived"),
    type: "boolean",
    description:
      "Lift the default archived exclusion. `true` widens the default result set into the " +
      "**union** of archived and non-archived documents — the archived chip's " +
      '"include archived" reading (SPEC.md §10) — where `status=archived` selects archived ' +
      "documents *only*. Absent or `false` keeps today's behaviour. It modifies the **default** " +
      "and nothing else, so it is a no-op alongside an explicit `status`: `status` already " +
      "replaces the default filter, and `status=open&includeArchived=true` is just `status=open`.",
  }),
  tag: openapi(z.string().min(1).optional(), {
    ...queryParam("tag"),
    description:
      "Comma-separated tags; values OR together. Tags are validated comma-free on write, so the " +
      "separator needs no escaping scheme." +
      GLOB_NOTE,
  }),
  folder: openapi(z.string().min(1).optional(), {
    ...queryParam("folder"),
    description:
      "Path prefix relative to `data/docs/`, matching the folder and its descendants. Threads " +
      "inherit their parent document's folder (SPEC.md §10). How far down it reaches is " +
      "`folderScope`'s to say on the collection query, which defaults to the tree." +
      GLOB_NOTE +
      " A pattern is matched against the stored workspace-relative path and bypasses the " +
      "bare-name normalisation a wildcard-free `folder` gets, so write `data/docs/work/*` or " +
      "`work/*` and mean the path. `folderScope` cannot narrow a pattern and the pair is " +
      "refused with `400`.",
  }),
  parent: openapi(DocumentIdSchema.optional(), {
    ...queryParam("parent"),
    description: `Threads whose \`parent\` is this document id.${THREAD_ONLY}`,
  }),
  references: openapi(DocumentIdSchema.optional(), {
    ...queryParam("references"),
    description:
      "Documents whose body contains `[[<id>]]`, read from the projection's `links` table " +
      "(SPEC.md §9.1). Powers the backlinks panel and the `references:` filter chip.",
  }),
  agent: openapi(z.enum(THREAD_AGENT_STATES).optional(), {
    ...queryParam("agent"),
    description: `Agent participation state from the thread's frontmatter (SPEC.md §6).${THREAD_ONLY}`,
  }),
  author: openapi(z.enum(ACTORS).optional(), {
    ...queryParam("author"),
    description: `Author of the thread's last turn — the "awaiting your answer" half of Attention.${THREAD_ONLY}`,
  }),
  since: openapi(IsoDateTimeSchema.optional(), {
    ...queryParam("since"),
    description:
      "ISO 8601 instant; matches documents whose `updated` is strictly after it. Distinct from " +
      "`due`, which is a calendar date or a keyword.",
  }),
  due: openapi(z.union([IsoDateSchema, DueKeywordSchema]).optional(), {
    ...queryParam("due"),
    description:
      "Either an ISO calendar date (due on or before that date) or one of " +
      `${DUE_KEYWORDS.join(", ")}. Keywords are resolved server-side against the workspace's clock.`,
  }),
  stale: openapi(StaleTierSchema.optional(), {
    ...queryParam("stale"),
    description:
      "Staleness tier (SPEC.md §5), selecting documents at or beyond it — `aging` includes stale and " +
      "very-stale. Documents with `evergreen: true` never match.",
  }),
  unread: openapi(z.stringbool().optional(), {
    ...queryParam("unread"),
    type: "boolean",
    description: `Threads whose last turn is newer than your last-seen mark (SPEC.md §7).${THREAD_ONLY}`,
  }),
  needs: openapi(NeedsFilterSchema.optional(), {
    ...queryParam("needs"),
    description:
      "The Attention filter (SPEC.md §10). `me` is the union of every reason; the individual reasons " +
      `(${NEEDS_REASONS.join(", ")}) back the per-reason chips. Composes with the other filters by ` +
      "intersection — `needs=me&folder=finance` is Attention within that folder.",
  }),
} as const;

/**
 * Published parameter order is `…, unread, isParent, needs, sort`, so the shared
 * filters are spread in two runs with the one docs-only filter between them.
 * Order is not cosmetic here: `openapi.test.ts` pins the parameter list, and
 * it is what keeps `openapi.json` byte-stable across regenerations. A filter
 * added to {@link docFilterShape} still lands on both endpoints untouched by
 * this split — it joins the first run.
 *
 * The split used to hold `pinned` as well, which rider 7 removed from the API
 * on 2026-08-22 (a view has no `pinned`, and a board lists its own columns).
 */
const { needs: needsFilter, ...filtersBeforeIsParent } = docFilterShape;

/**
 * The full §9.2 grammar. Values OR within a comma-separated parameter and AND
 * across parameters, so `type=note,view&tag=finance` reads "notes or views that
 * are tagged finance".
 */
export const DocsQuerySchema = PaginationQuerySchema.extend({
  q: openapi(z.string().min(1).optional(), {
    ...queryParam("q"),
    description:
      "Full-text query (FTS5) across document titles, bodies and turn bodies. Matching rows carry " +
      "`snippets`; without `q` every row's `snippets` array is empty.",
  }),
  ...filtersBeforeIsParent,
  isParent: openapi(z.stringbool().optional(), {
    ...queryParam("isParent"),
    type: "boolean",
    description:
      "Whether the document is a **child of something** (SPEC.md §9.2). `true` selects " +
      "**roots** — documents whose `parent` is null or absent — which is what lets a view show " +
      "top-level documents without their child threads mixed in among them; `false` selects " +
      "documents that **are** a child. Absent filters nothing, exactly like every other " +
      "optional filter: there is no default of `true`, so a view that never sets it shows what " +
      'it always showed. **It does not mean "has children."** A standalone note that nothing ' +
      "hangs off still matches `isParent=true` — the filter asks what a document is *under*, " +
      'never what is *under it*. The "has at least one child" reading matches the name more ' +
      "literally and was considered and **rejected** (a parents-only view that hid every " +
      "uncommented note would be nearly empty); the name is the one the user asked for and is " +
      'kept deliberately, so do not "fix" it into the other meaning. **Not thread-only**, ' +
      "unlike `parent`: a non-thread document has no parent at all, so `isParent=true` " +
      "genuinely matches it and `isParent=false` genuinely excludes it — an answer, not a " +
      "no-op, and a mixed top-level list of notes and standalone threads is the point. " +
      "`parent=<id>` together with `isParent=true` is a contradiction and is **refused with " +
      "`400`** rather than answered with an empty set: `parent` no-ops for non-thread types, " +
      "so an intersection would quietly return every root document that is not a thread — a " +
      "confident answer to a question nobody asked. `parent=<id>&isParent=false` is merely " +
      "redundant and is accepted.",
  }),
  /**
   * Published after `isParent` so the two docs-only parameters sit together and
   * the shared shape stays one spread.
   *
   * **Optional rather than `.default()`, deliberately** — the one place this
   * module departs from `sort`. A zod default is applied before the refinements
   * run, so a defaulted `folderScope` is indistinguishable from a sent one, and
   * the rule below ("a scope with nothing to scope is a `400`") could then only
   * be enforced for `self`. Absent means `tree`; the published `default` says so
   * in the document, where a client reads it.
   */
  folderScope: openapi(FolderScopeSchema.optional(), {
    ...queryParam("folderScope"),
    default: DEFAULT_FOLDER_SCOPE,
    description:
      "How far under `folder` the listing reaches — a **modifier of `folder`**, meaningless " +
      "without it. `tree` (the default, and what `folder` has always meant) matches the folder " +
      "and every descendant, plus the threads whose parent document is filed under it: a folder " +
      "column shows a folder's work *and* the conversations about it (SPEC.md §10). `self` " +
      "matches the documents filed **directly** in the folder — a path with no further `/` after " +
      "the prefix — and inherits nothing, so a thread whose parent sits in the folder while its " +
      "own file does not is **absent**: a thread is a document, and its own path decides where " +
      "it is filed. `self` is the explorer's reading, one row per folder with that folder's own " +
      "documents under it (SPEC.md §10, rider 1), and it is what keeps one document from being " +
      "drawn under every expanded ancestor at once. `page.total` counts the same set the page " +
      "draws from at either scope, so a `self` listing's bound line is about the folder's own " +
      "documents and not its subtree's. **Sent without `folder` it is a `400` naming `folder`**, " +
      "rather than a silent no-op over the whole corpus: there is no folder for it to stop at. " +
      "A `folder` naming nothing answers an empty page at either scope, and the root — `folder` " +
      "spelled as `data/docs` or `/`, since the parameter is non-empty — with `self` is the " +
      "documents at the top of the tree.",
  }),
  needs: needsFilter,
  /**
   * The open namespace SPEC.md §5's **Structured fields** opens: any frontmatter
   * key a workspace invents, queryable in the same vocabulary as a core one.
   *
   * Declared here rather than in {@link docFilterShape} for the reason
   * `isParent` was: §9.2's signed `/api/search` parameter string does not carry
   * it, so publishing it on ranked retrieval is a SPEC rider rather than a
   * contract decision. Unlike `isParent` this one is principle and not
   * bookkeeping — an open namespace on a ranked endpoint is a much larger
   * surface than one more structural filter, and nobody has asked for it.
   *
   * It arrives on the wire as one parameter per key (`extra.assignee=theo`) and
   * reaches this field as a record, lifted by {@link collectExtraFilters}. The
   * published parameter is therefore named `extra.<key>`, which is what a caller
   * types, and its declared type is the string a caller sends.
   */
  extra: openapi(ExtraFilterSchema.optional(), {
    ...queryParam("extra"),
    description:
      "**Spelled `extra.<key>=<value>` on the wire** — `extra.assignee=theo` — one parameter per " +
      "key. It is published here under the bare name `extra` because a parameter's published " +
      "name must equal the schema key it comes from, and OpenAPI 3.1 has no serialization style " +
      "for a dot-delimited open namespace (`deepObject` would mean `extra[assignee]`). The " +
      "generated client takes it as the record it is and expands it at the boundary. " +
      "Filter on a frontmatter field this workspace invented (SPEC.md §5). One parameter per " +
      "key — `extra.assignee=theo` — and keys AND together like every other filter. A key must " +
      "be an identifier (letters, digits, `_`, `-`), and a malformed one is a `400` naming it. " +
      "The value takes glob patterns on the same terms as `title`. A document that does not " +
      "carry the key never matches, whatever the value, and there is **no way to ask for " +
      "absence**: an empty value is refused rather than read as a null sentinel. Where the " +
      "field holds a JSON array the filter matches if **any element** matches, the way `tag` " +
      "already ORs. Not offered on `/api/search`.",
  }),
  sort: openapi(DocSortSchema.default(DEFAULT_DOC_SORT), {
    ...queryParam("sort"),
    description:
      `Sort key; defaults to \`${DEFAULT_DOC_SORT}\`. \`relevance\` requires \`q\` and is rejected ` +
      "with `400` without it, rather than silently falling back. `order` sorts ascending by the " +
      "§10 key — a **board's position among boards** — with the documented tiebreak: `order` with " +
      "nulls last (a board with no `order` key is placed, never dropped), then `title`, then " +
      "`id`. The board bar's whole set is therefore one bounded query, `type=board&sort=order`, " +
      "with each board's `columns`, `kanban` and `defaultOpen` on the rows.",
  }),
})
  .refine((query) => query.sort !== "relevance" || query.q !== undefined, {
    message: "`sort=relevance` is only meaningful with a `q` query.",
    path: ["sort"],
  })
  /**
   * `parent=<id>` names a parent; `isParent=true` demands there be none. The
   * two are refused together (CONTRACT-042) rather than intersected to an empty
   * set, because the intersection is **not** empty: `parent` no-ops for
   * non-thread types (SPEC.md §9.2), so `parent=X&isParent=true` would answer
   * with every root non-thread document in the workspace — a plausible-looking
   * list that has nothing to do with what was asked. The repo's own precedent
   * is the rung above: `sort=relevance` without `q` is a `400` rather than a
   * silent fallback, for the same reason. A `400` is also the honest code here
   * — dropping either parameter fixes the request, so the caller is not sent in
   * circles. `isParent=false` alongside `parent` is redundant, not
   * contradictory, and passes.
   */
  .refine((query) => query.parent === undefined || query.isParent !== true, {
    message:
      "`parent=<id>` and `isParent=true` contradict: `parent` asks for the children of a " +
      "document and `isParent=true` asks for documents with no parent. Drop one.",
    path: ["isParent"],
  })
  /**
   * A scope with nothing to scope (CONTRACT-081). `folderScope` narrows what
   * `folder` matches, so without `folder` it modifies nothing — and the two
   * readings of answering anyway are both bad: `self` would silently return the
   * unscoped corpus, and `tree` would look like it had been honoured. The `400`
   * is the honest code by this file's own rule: naming a `folder` fixes the
   * request, so the caller is not sent in circles. It applies to `tree` as well
   * as to `self`, because the mistake is the same one either way and a
   * parameter that is quietly ignored for one value and enforced for the other
   * teaches nothing.
   */
  .refine((query) => query.folderScope === undefined || query.folder !== undefined, {
    message:
      "`folderScope` narrows what `folder` matches and needs a `folder` to narrow. Pass " +
      "`folder`, or drop `folderScope`.",
    path: ["folderScope"],
  })
  /**
   * A scope cannot narrow a pattern (SHARED-011).
   *
   * `folderScope=self` is implemented by measuring how many characters a match
   * spends on the folder prefix and refusing any path with a separator after
   * it. A glob has no prefix to measure — a pattern may match paths of
   * several depths at once — so `self` would have to guess, and guessing here means
   * answering a plausible-looking list to a question nobody asked. That is the
   * exact failure `parent` + `isParent=true` is refused for, and the `400` is
   * honest by the same test: dropping either parameter fixes the request.
   */
  .refine((query) => query.folderScope === undefined || !hasGlob(query.folder ?? ""), {
    message:
      "`folderScope` narrows a folder prefix and cannot narrow a glob pattern. Drop " +
      "`folderScope`, or write `folder` without `*` or `?`.",
    path: ["folderScope"],
  });

/**
 * FTS5's `snippet()` output, converted server-side into alternating matched and
 * unmatched segments. Structured rather than marked-up HTML so the UI renders
 * highlights without `dangerouslySetInnerHTML` and without an escaping contract
 * between server and client.
 */
export const SNIPPET_FIELDS = ["title", "body", "turn"] as const;

export const SnippetFieldSchema = z.enum(SNIPPET_FIELDS);

export const SnippetSegmentSchema = openapi(
  z.object({
    text: z.string(),
    match: z
      .boolean()
      .describe("True for the segments the query matched; render those highlighted."),
  }),
  "SnippetSegment",
);

export const SnippetSchema = openapi(
  z.object({
    field: SnippetFieldSchema.describe("Which indexed field the excerpt came from."),
    threadId: ThreadIdSchema.optional().describe(
      "Set only for `turn` snippets, naming the thread the matching turn belongs to.",
    ),
    segments: z
      .array(SnippetSegmentSchema)
      .describe("Alternating unmatched/matched runs; concatenating `text` yields the excerpt."),
  }),
  "Snippet",
);

/**
 * The §10 thread-row affordances, carried by every row and `null` on rows that
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
        "SPEC.md §9.2). An orphaned thread — `parent` set, title gone — renders an **empty** " +
        "context cell rather than a raw `doc_*` id, which is not the same as a standalone " +
        "thread (no `parent` at all) and must not be labelled as one.",
    ),
  agent: ThreadAgentSchema.nullable().describe(
    `Agent participation state (${THREAD_AGENT_STATES.join(", ")}, SPEC.md §6, §8) — the ` +
      "`agent=` filter's column. It only ever climbs, and nothing lowers it again, so it says " +
      "what this thread's history contains and never what the queue is holding now: the " +
      "pending-agent indicator is `awaitingAgent`, which asks the queue instead. Null on " +
      "non-threads.",
  ),
  anchorQuote: z
    .string()
    .nullable()
    .describe(
      "The anchored text this thread hangs off, pinned at the top of a thread row (SPEC.md §10). " +
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
      "Plain-text preview of the thread's last turn, for the row's second line (SPEC.md §10). " +
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
      "True when the queue still owes this thread something — the pending-agent indicator " +
        "(SPEC.md §8, §10). **It is a question about the queue, not about the thread**: true " +
        "exactly when some event in a non-terminal status (`pending`, `in-progress` or " +
        "`deferred`, SPEC.md §7 — `deferred` included, since a job parked while somebody edits " +
        "is still owed) carries this thread's id as a top-level value of its payload. The " +
        "payload is matched by value rather than by a fixed key list (`threadId`, `parentId`, " +
        "…), the same way the `failed-job` attention reason matches one, so an event type this " +
        "build has never heard of that names this thread under its own key lights the indicator " +
        "with no server change (SPEC.md §7). **It reads no thread state, deliberately** — not " +
        "`agent`, not `status`, not `lastAuthor`. In particular resolving a thread does not " +
        "clear it, because resolving cancels no queued event: the missing `status` test is the " +
        "rule here, not an omission. A note-only turn enqueues nothing, so it never sets this. " +
        "**Not a duplicate of a `GET /api/jobs` scan**, which asks a different question of the " +
        "same source: separating SPEC.md §8's *working* from *waiting* needs each job's own " +
        "`status` and `lastLine`, which a boolean cannot carry, and that scan is bounded by one " +
        "response's worth of unfinished jobs where this column is unwindowed. Null on " +
        "non-threads.",
    ),
} as const;

/**
 * A row of `GET /api/docs`: the projection's document columns plus what a list
 * needs and a document read does not — why the row wants attention, where the
 * query matched, how stale it is, how many of its threads are unread, how many
 * forms it is still waiting on, and the thread affordances §10's type-aware rows
 * render.
 */
export const DocRowSchema = openapi(
  z.object({
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
    unreadThreads: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many of **this document's own threads** are currently unread for the user " +
          "(SPEC.md §7) — the aggregate behind a document row's unread pill. It counts child " +
          "threads whose last turn is newer than your last-seen mark, which is exactly the " +
          "comparison the per-thread `unread` flag makes, so the two agree by construction: this " +
          "equals the item count of `?parent=<id>&type=thread&unread=true`, and a thread marked " +
          "seen at a `lastSeenTs` before its last turn (a partial read) still counts as unread " +
          "in both. It rides on every row so a list never issues one such query per row. " +
          "**`0` on a thread row** — a thread does not aggregate its own child threads here — " +
          "**and `0` on a document with no threads.** Never null and never absent, so `0` always " +
          'means "nothing unread" and never "unknown".',
      ),
    /**
     * The count behind §10's last Attention clause: "a thread holding **more
     * than one** unanswered form says how many are still open."
     *
     * **Why a scalar on the row, and not something on `attention`.** The reason
     * codes are a flat list the server may extend, and its vocabulary may grow
     * ahead of any one client — `packages/kit`'s reason table renders a code it
     * has never seen for exactly that reason. Widening an entry into
     * `{code, count}` would rewrite every consumer of every reason for one
     * reason's sake, and would break the readers that cannot be rebuilt in step
     * with the server. A sibling field is additive, and nothing that renders a
     * reason chip today has to change to keep working.
     *
     * **Why not derived in the client.** A row carries no turns — `lastTurn` is
     * a plain-text preview of the *last* turn, and the forms in question are
     * typically above it — so the only client-side count is one
     * `GET /api/threads/{id}` per row per render. `unreadThreads` is the
     * precedent for the other choice: an aggregate the projection already knows,
     * ridden on the row so no list ever issues a query per row. The server
     * already computes this exact set (`turns.has_form` / `turns.form_answered`,
     * the columns `needs=form` tests over), so exposing it is cheaper than any
     * alternative *and* cannot drift from the reason.
     *
     * **Why `0` rather than `null` on a non-thread row**, breaking the
     * {@link threadRowShape} convention deliberately. Those fields are rendered;
     * "not a thread" is a distinct display state from "a thread with none", and
     * `turnCount: null` is right for that reason. This field is *arithmetic*: it
     * is read through a `> 1` threshold, and a nullable number forces every
     * reader to coalesce before comparing — a coalesce that is invisible when
     * omitted, since `null > 1` is merely `false`. It follows `unreadThreads`
     * instead: a count is always a count, and `0` never means "unknown".
     */
    unansweredForms: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many **unanswered forms** this thread still holds (SPEC.md §6, §10) — the number " +
          "behind Attention's \"how many are still open\". It counts the thread's agent turns " +
          "carrying an answerable `form` block that no later turn has answered, which is exactly " +
          "the set the `form` attention reason tests for the existence of, under the same " +
          "open-thread guard. **The two agree in both directions**: this is non-zero **iff** " +
          "`attention` contains `form`. Left to right, a form counted here is a form that " +
          "existence test finds; right to left, the reason cannot hold with nothing to count — " +
          "one derivation produces both, so neither can move without the other. The `needs=form` " +
          "filter tests that same predicate, so a filtered list never disagrees with the rows " +
          "in it about which threads are waiting (it filters, so the rest of the query — " +
          "including the default archived exclusion — still applies to which rows are returned " +
          "at all). **Resolving the thread takes it to `0`** along with the reason: a resolved " +
          "conversation is not waiting for an answer (SPEC.md §6). **`POST /api/threads/{id}/seen` " +
          "leaves it untouched** — an unanswered form's row is the one that survives being read " +
          "(SPEC.md §10), the opposite of `unread` and `unreadThreads`, which being read is " +
          "precisely what clears. It rides on every row so no list has to fetch each thread to " +
          "count its forms. **`0` on a thread with no unanswered form, and `0` on every " +
          'non-thread row** — never null and never absent, so `0` always means "none" and never ' +
          '"unknown". Rendering is the consumer\'s: §10 asks for the number only when it is ' +
          "greater than one.",
      ),
    attention: z
      .array(NeedsReasonSchema)
      .describe(
        "Attention reasons for this row, populated on every response rather than only under " +
          "`needs=`, so any list can render reason chips. Empty when nothing applies; never " +
          "contains `me`, which is the union filter and not a reason. Entries stay bare codes: " +
          "the one reason with a number to report carries it in the sibling `unansweredForms`, " +
          "because the server's vocabulary may grow ahead of the client reading it — a client " +
          "must render a reason code it has never seen — and a bare code is what every consumer " +
          "of every reason already reads.",
      ),
    snippets: z
      .array(SnippetSchema)
      .describe("Search highlights for this row; empty when the query carried no `q`."),
  }),
  "DocRow",
);

export const DocListSchema = openapi(
  z.object({ items: z.array(DocRowSchema), page: PageMetaSchema }),
  "DocList",
);

export type StaleTier = z.infer<typeof StaleTierSchema>;
export type NeedsReason = z.infer<typeof NeedsReasonSchema>;
export type NeedsFilter = z.infer<typeof NeedsFilterSchema>;
export type DocSort = z.infer<typeof DocSortSchema>;
export type FolderScope = z.infer<typeof FolderScopeSchema>;
export type DueKeyword = z.infer<typeof DueKeywordSchema>;
export type DocsQuery = z.infer<typeof DocsQuerySchema>;
export type SnippetField = z.infer<typeof SnippetFieldSchema>;
export type SnippetSegment = z.infer<typeof SnippetSegmentSchema>;
export type Snippet = z.infer<typeof SnippetSchema>;
export type DocRow = z.infer<typeof DocRowSchema>;
export type DocList = z.infer<typeof DocListSchema>;
