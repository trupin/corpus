// `GET /api/docs` — the single collection query behind every list in the
// product (SPEC.md §9.2, §10): board columns, the search overlay, the Attention
// view and every autocomplete are this one statement with different parameters.
//
// Three rules shape the SQL:
//
// - **One statement per request, plus one COUNT.** Snippets, Attention reasons
//   and thread state are columns of the same SELECT, never follow-up queries —
//   a list that fanned out per row would be N+1 against a database the UI hits
//   on every keystroke.
// - **Nothing user-supplied is ever interpolated.** Values bind by name; only
//   this module's own fragments become SQL text. Named (rather than positional)
//   parameters are what let a fragment appear in both the WHERE clause and the
//   SELECT list without the caller tracking bind order.
// - **Thread-only filters no-op for non-thread rows** (SPEC.md §9.2). Each is
//   written `t.id IS NULL OR <condition>`, so `?parent=…` narrows the threads in
//   a mixed list and leaves the documents alone rather than emptying it.
//
// The predicates themselves live in `./filters.ts` — the WHERE clause, the FROM
// its aliases name and the FTS hit materialization are shared with ranked
// retrieval (`GET /api/search`), which §9.2 requires to filter identically.
// This module is what the *list* additionally needs: its row columns, its
// ordering, its paging and its wire mapping.

import {
  DEFAULT_DOC_SORT,
  NEEDS_REASONS,
  type DocList,
  type DocRow,
  type DocSort,
  type DocsQuery,
} from "@corpus/contract";
import { bodyExcerpt, type ProjectionDb } from "../projection/index.js";
import {
  compileFilters,
  FROM_SQL,
  FTS_HITS_CTE,
  notArchivedSql,
  paramsFor,
  RELEVANCE_ORDER_BY,
  whereClause,
  type FilterQuery,
} from "./filters.js";
import { parseSnippets } from "./fts.js";
import {
  AWAITING_AGENT_SQL,
  NEEDS_REASON_SQL,
  reasonColumn,
  rowAttention,
  UNANSWERED_FORM_COUNT_SQL,
  UNREAD_SQL,
} from "./needs.js";
import { STALE_TIER_SQL, type StalenessThresholds } from "./staleness.js";

export { DOCS_ROOT, folderPathPrefix } from "./filters.js";

// Undated documents carry `created: null` / `updated: null` straight through
// (CONTRACT-005): the projection stores NULL for a hand-written `SKILL.md` that
// has no timestamps (SPEC.md §7), and `DocRow` now declares both nullable. The
// epoch sentinel this module used to substitute is gone — "we do not know" is
// not "1970", and a sentinel is a lie every consumer then has to special-case.
// Staleness already read it that way: an unknown age is not an old one, so an
// undated row is fresh (`stale: null`), never very-stale.

/** Every ordering ends in `d.id` so paging over ties is stable (TEST-49). */
const ORDER_BY: Readonly<Record<DocSort, string>> = {
  updated: "d.updated ASC, d.id ASC",
  "-updated": "d.updated DESC, d.id ASC",
  created: "d.created ASC, d.id ASC",
  "-created": "d.created DESC, d.id ASC",
  due: "d.due IS NULL, d.due ASC, d.id ASC",
  title: "d.title COLLATE NOCASE ASC, d.id ASC",
  // The board's column ordering (SPEC.md §10, CONTRACT-011): ascending, with
  // the contract's documented tiebreak spelled out — `order` **nulls last** (a
  // view with no `order` key is placed, never dropped), then `title`, then
  // `id`. `IS NULL` yields 0 before 1, which is what puts the nulls after the
  // numbers; the title rung matches the `title` sort's collation so two ways of
  // asking for alphabetical never disagree.
  order: "d.sort_order IS NULL, d.sort_order ASC, d.title COLLATE NOCASE ASC, d.id ASC",
  // FTS5 `rank` is a bm25 score: more negative is a better match. Shared with
  // ranked retrieval rather than restated, so the product has one ranking.
  relevance: RELEVANCE_ORDER_BY,
};

/**
 * Three more joins the *page* needs and the COUNT does not: the anchor a thread
 * hangs off (stored on the commented document, keyed by anchor id — SPEC.md §6),
 * the thread's last turn, and the parent document a thread names. All three are
 * keyed on their table's full primary key, so none can multiply a row; the COUNT
 * deliberately keeps {@link FROM_SQL} so it does no work the total does not
 * depend on. Nothing in the WHERE clause names any of these aliases, which is
 * what makes the two statements' row sets equal.
 *
 * `pd` is `parentTitle`'s source and is read **at query time**, never stored:
 * `Job.originTitle`'s rule, so renaming a parent is reflected on its threads'
 * rows immediately and a deleted parent reads as `null` rather than as a stale
 * copy of a title that no longer exists (CONTRACT-011). The alias is not `p`
 * because the folder filter's correlated subquery already binds that name.
 */
const ROW_FROM_SQL = `${FROM_SQL}
  LEFT JOIN anchors an ON an.doc_id = t.parent_id AND an.anchor_id = t.anchor_id
  LEFT JOIN turns lt ON lt.thread_id = t.id AND lt.ts = t.last_ts
  LEFT JOIN documents pd ON pd.id = t.parent_id`;

/**
 * `NULL` for a row that is not a thread, the fragment's own value otherwise —
 * the row-shaped twin of the "thread-only filters no-op" rule. The fragment is
 * spliced verbatim rather than restated, so the column and the filter that
 * selects on it are the same SQL.
 */
const threadOnly = (sql: string): string => `CASE WHEN t.id IS NULL THEN NULL ELSE ${sql} END`;

/**
 * `unreadThreads` (CONTRACT-012): how many of *this document's own* threads are
 * currently unread, so a document row carries the aggregate its unread pill
 * needs without the list issuing one `?parent=<id>&type=thread&unread=true` per
 * row — the N+1 the deferral that filed this field named by name.
 *
 * A correlated subquery, not a change to {@link FROM_SQL}: joining `threads` a
 * second time on `parent_id` would multiply the outer row (a document with four
 * threads is one row of the page, not four) and the COUNT would then disagree
 * with the page. `threads_parent_id` is what keeps it a bounded index seek per
 * row rather than a scan.
 *
 * The subquery re-binds `t` and `s` — precisely the aliases {@link UNREAD_SQL}
 * names — so the aggregate and the per-thread `unread` column are the *same*
 * comparison rather than two copies of it that could drift (SERVER-021's
 * one-source-of-truth rule). `d` still resolves to the outer document, which is
 * what correlates the subquery to the row. A partial mark (`lastSeenTs` before
 * the last turn) therefore counts as unread here exactly as it does there.
 *
 * `0` on a thread row: `t.id IS NOT NULL` outside the subquery is the outer
 * join, so a thread reports the contract's `0` rather than aggregating threads
 * that happen to hang off it. A childless document counts zero rows and reports
 * `0` too — COUNT is never NULL, so the column is never "unknown".
 *
 * Archived threads are excluded, by the same {@link notArchivedSql} fragment the
 * collection query's default lifecycle rule uses (§10). Without it the two sides
 * of the contract's stated equality disagreed the moment a thread was archived:
 * the filtered query dropped it and the pill did not, leaving a document
 * advertising unread work that nothing visible on the board could explain or
 * clear (PR #10 review, finding 4). The exclusion is *fixed* rather than taking
 * the request's `status`/`includeArchived`: the equality the contract states is
 * with the default query, and the pill answers "what is still asking for me",
 * which archiving settles — a chip that widens what a listing *shows* does not
 * revive attention the user already dismissed. A thread's own lifecycle lives on
 * its `documents` row (every thread is a document), which is what `td` joins.
 */
export const UNREAD_THREADS_SQL = `CASE WHEN t.id IS NOT NULL THEN 0 ELSE (
           SELECT COUNT(*) FROM threads t
                  LEFT JOIN seen s ON s.thread_id = t.id
                  JOIN documents td ON td.id = t.id
            WHERE t.parent_id = d.id AND ${notArchivedSql("td")} AND ${UNREAD_SQL}
         ) END`;

/**
 * The §10 thread affordances and the staleness tier, as columns of the page
 * query.
 *
 * `unanswered_forms` (CONTRACT-040) is §10's "a thread holding more than one
 * unanswered form says how many are still open", carried on the row so no list
 * has to fetch each thread to count its forms — a row holds no turns, so a
 * client-side count is one `GET /api/threads/{id}` per row per render.
 *
 * It is {@link UNANSWERED_FORM_COUNT_SQL} **spliced, not restated**, and the
 * `form` entry of {@link NEEDS_REASON_SQL} is `(<that same expression> > 0)`.
 * So this column and the `reason_form` column beside it are one derivation
 * appearing twice in one SELECT, which is what makes the published invariant —
 * non-zero **iff** `attention` contains `form` — true in both directions rather
 * than by two implementations agreeing. The WHERE clause `needs=form` compiles
 * to is that same text again, so a filtered list cannot disagree with the rows
 * in it either.
 *
 * `0` on a document row and on a resolved thread comes from that expression's
 * own `CASE` guard rather than from anything here, and COUNT is never NULL — so
 * the column is a count and never "unknown".
 */
const ROW_COLUMNS = `${STALE_TIER_SQL} AS stale,
         t.parent_id AS parent, pd.title AS parent_title, t.agent AS agent,
         an.exact_text AS anchor_quote,
         t.turn_count AS turn_count, t.last_author AS last_author, lt.body_md AS last_turn,
         ${threadOnly(UNREAD_SQL)} AS unread,
         ${threadOnly(AWAITING_AGENT_SQL)} AS awaiting_agent,
         ${UNREAD_THREADS_SQL} AS unread_threads,
         ${UNANSWERED_FORM_COUNT_SQL} AS unanswered_forms`;

/**
 * The list's aggregate over {@link FTS_HITS_CTE}: one row per document, ranked
 * by its best-matching passage, carrying every matching row's snippets as JSON
 * for the row's `snippets` array. Ranked retrieval aggregates the same hits
 * differently (it wants the best passage, not all of them) — the shared half is
 * the materialization and the bm25 `rank` it selects.
 */
const HITS_CTE = `${FTS_HITS_CTE},
  m AS (
    SELECT doc_id AS id, MIN(rank) AS rank,
           json_group_array(json_object('kind', kind, 'ref', ref, 'title', title, 'body', body)) AS snippets
      FROM hits GROUP BY doc_id
  )`;

const COUNT_MATCH_CTE = "m AS (SELECT DISTINCT doc_id AS id FROM search WHERE search MATCH @q)";

const REASON_COLUMNS = NEEDS_REASONS.map(
  (reason) => `${NEEDS_REASON_SQL[reason]} AS ${reasonColumn(reason)}`,
).join(",\n         ");

interface RawRow {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly path: string;
  readonly status: string;
  readonly tags_json: string;
  readonly created: string | null;
  readonly updated: string | null;
  readonly due: string | null;
  readonly reviewed: string | null;
  readonly evergreen: number;
  readonly origin: string | null;
  readonly excerpt: string;
  readonly stage: string | null;
  readonly last_actor: string;
  readonly sort_order: number | null;
  readonly query_json: string | null;
  readonly board_json: string | null;
  readonly extra_json: string;
  readonly snippets_json: string | null;
  readonly stale: string | null;
  readonly parent: string | null;
  readonly parent_title: string | null;
  readonly agent: string | null;
  readonly anchor_quote: string | null;
  readonly turn_count: number | null;
  readonly last_author: string | null;
  readonly last_turn: string | null;
  readonly unread: number | null;
  readonly awaiting_agent: number | null;
  readonly unread_threads: number;
  readonly unanswered_forms: number;
}

/**
 * The thread columns are NULL exactly when the `threads` LEFT JOIN missed, since
 * every one of them is either `NOT NULL` in that table or wrapped in
 * {@link threadOnly}. `t.parent_id`, `t.last_author`, `an.exact_text` and
 * `lt.body_md` are the four that are also legitimately NULL *for a thread* — a
 * standalone thread, a thread with no turns, a whole-document thread — which is
 * why the contract describes each null as covering both cases.
 */
const asBoolean = (value: number | null): boolean | null => (value === null ? null : value !== 0);

function parseTags(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * A JSON object column back into an object. Both callers store JSON this module
 * itself produced from an already-validated value (`docs/read.ts` and the
 * projection read the file through the same `core/view-frontmatter.ts`), so the
 * fallbacks are for a database written by an older schema or corrupted
 * underneath us — never a normal path.
 */
function parseJsonObject(json: string | null): Record<string, unknown> | null {
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The three board keys out of `documents.board_json` (SPEC.md §9.1), always
 * present on the row.
 *
 * The column holds NULL for the documents — nearly all of them — that carry no
 * board key at all, and the wire says all three fields are present on every
 * response, so NULL unpacks to the absent state of each: no columns, no kanban,
 * not the default-open board. The stored object is already the wire shape (the
 * projection wrote it from the contract's own readers), so nothing here parses
 * or validates it a second time.
 */
function boardFields(json: string | null): Pick<DocRow, "columns" | "kanban" | "defaultOpen"> {
  const stored = parseJsonObject(json);
  return {
    columns: (stored?.["columns"] ?? null) as DocRow["columns"],
    kanban: (stored?.["kanban"] ?? null) as DocRow["kanban"],
    defaultOpen: stored?.["defaultOpen"] === true,
  };
}

function toDocRow(row: RawRow & Record<string, unknown>): DocRow {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    path: row.path,
    // The projection parses `status` with the contract's own enum before
    // inserting, so the column can only hold a declared value.
    status: row.status as DocRow["status"],
    tags: parseTags(row.tags_json),
    created: row.created,
    updated: row.updated,
    due: row.due,
    reviewed: row.reviewed,
    evergreen: row.evergreen !== 0,
    origin: row.origin,
    excerpt: row.excerpt,
    // SPEC.md §5's workflow position, straight off the column the filter reads.
    stage: row.stage,
    // Parsed with the contract's enum for the reason `status` is: the projection
    // only ever writes an `Actor`, so the column can only hold a declared value.
    lastActor: row.last_actor as DocRow["lastActor"],
    // The §10 view and board keys, from the columns the projection filled by
    // parsing the file with the contract's own schemas — so the row and
    // `GET /api/docs/{id}` report one file's frontmatter identically
    // (CONTRACT-011, CONTRACT-074). `board_json` holds the three board keys as
    // one object under their wire spellings, so it is unpacked rather than
    // re-derived.
    order: row.sort_order,
    query: parseJsonObject(row.query_json) as DocRow["query"],
    ...boardFields(row.board_json),
    extra: parseJsonObject(row.extra_json) ?? {},
    // Same reasoning as `status`: the tier is this module's own CASE over the
    // contract's closed enum, and `agent`/`last_author` are parsed with the
    // contract's enums before the projection inserts them, so each column can
    // only hold a declared value.
    stale: row.stale as DocRow["stale"],
    parent: row.parent,
    // Null whenever `parent` is null *and* when the parent no longer resolves —
    // the LEFT JOIN misses a deleted parent. The contract's rule for that second
    // case is an *empty* context cell rather than a raw `doc_*` id: an orphaned
    // thread still has a `parent`, so it is not a standalone thread and must not
    // be labelled as one (CONTRACT-012).
    parentTitle: row.parent_title,
    agent: row.agent as DocRow["agent"],
    anchorQuote: row.anchor_quote,
    turnCount: row.turn_count,
    lastAuthor: row.last_author as DocRow["lastAuthor"],
    // Excerpted by the same rule as `body_excerpt`, so a row's two previews are
    // trimmed and truncated alike rather than by two near-identical helpers.
    lastTurn: row.last_turn === null ? null : bodyExcerpt(row.last_turn),
    unread: asBoolean(row.unread),
    awaitingAgent: asBoolean(row.awaiting_agent),
    // A COUNT, so already a non-negative integer — and `0` on a thread row and
    // on a childless document by the same CASE, never null (CONTRACT-012).
    unreadThreads: row.unread_threads,
    // The count and the `form` reason below it are the same SQL expression, one
    // read through `> 0` (CONTRACT-040): non-zero here iff `attention` carries
    // `form`, in both directions, because there is only one derivation.
    unansweredForms: row.unanswered_forms,
    attention: rowAttention(row),
    snippets: parseSnippets(row.snippets_json),
  };
}

const sortOf = (sort: DocSort, searching: boolean): DocSort =>
  sort === "relevance" && !searching ? DEFAULT_DOC_SORT : sort;

/**
 * Runs the collection query. Exactly two statements execute per call: the page
 * and its total.
 */
export function queryDocs(
  db: ProjectionDb,
  query: DocsQuery,
  nowMs: number,
  thresholds?: StalenessThresholds,
): DocList {
  const compiled = compileFilters(query, nowMs, thresholds);
  const where = whereClause(compiled);

  // `sort=relevance` without `q` is a 400 from the contract's own refinement, so
  // the only way to reach it here is a `q` that carried no indexable token —
  // there is no rank to order by, and the result set is empty regardless.
  const searching = compiled.match !== null;
  const sort: DocSort = sortOf(query.sort, searching);

  const rowsSql = `${searching ? `WITH ${HITS_CTE}\n` : ""}SELECT d.id AS id, d.type AS type, d.title AS title, d.path AS path,
         d.status AS status, d.tags_json AS tags_json, d.created AS created, d.updated AS updated,
         d.due AS due, d.reviewed AS reviewed, d.evergreen AS evergreen, d.origin AS origin,
         d.body_excerpt AS excerpt, d.stage AS stage, d.last_actor AS last_actor,
         d.sort_order AS sort_order, d.query_json AS query_json,
         d.board_json AS board_json, d.extra_json AS extra_json,
         ${searching ? "m.snippets" : "NULL"} AS snippets_json,
         ${ROW_COLUMNS},
         ${REASON_COLUMNS}
  ${ROW_FROM_SQL}
  ${searching ? "JOIN m ON m.id = d.id" : ""}
  ${where}
  ORDER BY ${ORDER_BY[sort]}
  LIMIT @limit OFFSET @offset`;

  const countSql = `${searching ? `WITH ${COUNT_MATCH_CTE}\n` : ""}SELECT COUNT(*) AS total
  ${FROM_SQL}
  ${searching ? "JOIN m ON m.id = d.id" : ""}
  ${where}`;

  compiled.binder.fixed("limit", query.limit);
  compiled.binder.fixed("offset", query.offset);
  const bound = compiled.binder.all();

  const rows = db.prepare(rowsSql).all(paramsFor(rowsSql, bound)) as (RawRow &
    Record<string, unknown>)[];
  const counted = db.prepare(countSql).get(paramsFor(countSql, bound)) as
    { total: number } | undefined;

  return {
    items: rows.map(toDocRow),
    page: { total: counted?.total ?? 0, limit: query.limit, offset: query.offset },
  };
}

/**
 * **Every** document a query matches, as ids — the same collection query with no
 * page and no row columns.
 *
 * §10's whole-result-set selection ("all 412 matching", `docs/selection.ts`) is
 * the one caller: a Save that acts on what a column's query matches has to mean
 * the same set the column would list, so this shares {@link compileFilters} and
 * {@link whereClause} with {@link queryDocs} rather than restating the grammar.
 * It is deliberately the **COUNT** statement's shape — {@link FROM_SQL} and the
 * distinct-hits CTE, none of the page's row joins — because the answer is one
 * column and nothing about a row is needed to compute it.
 *
 * Unpaged on purpose: `limit` and `offset` are how a column shows part of a
 * result set, and this answers what the set *is*. Ordered by id, which is
 * arbitrary but stable — a Save's report order is its own concern, and the
 * query's `sort` decides display order, not membership.
 */
export function queryDocIds(
  db: ProjectionDb,
  query: FilterQuery,
  nowMs: number,
  thresholds?: StalenessThresholds,
): string[] {
  const compiled = compileFilters(query, nowMs, thresholds);
  const searching = compiled.match !== null;
  const sql = `${searching ? `WITH ${COUNT_MATCH_CTE}\n` : ""}SELECT d.id AS id
  ${FROM_SQL}
  ${searching ? "JOIN m ON m.id = d.id" : ""}
  ${whereClause(compiled)}
  ORDER BY d.id ASC`;

  const rows = db.prepare(sql).all(paramsFor(sql, compiled.binder.all())) as { id: string }[];
  return rows.map((row) => row.id);
}

/**
 * Whether **one** document matches a filter set — {@link queryDocIds} asked about
 * a single id, and deliberately built the same way (SERVER-138).
 *
 * §5's coupling rule decides "is this document in a kanban" by the board's own
 * scope query, and §9.2 promises a saved query means one thing wherever it is
 * asked. A membership test written by hand against the row would be a second
 * implementation of `docs/filters.ts` — it would answer differently the first
 * time somebody added a filter, and it would answer differently from the very
 * list the board draws from that same query. So this is the same
 * {@link compileFilters}, the same {@link FROM_SQL} and the same
 * {@link whereClause}, with `d.id = @doc` conjoined. `docs/query.test.ts` pins
 * the parity: for every document in a workspace, this agrees with
 * `GET /api/docs`'s own result set.
 *
 * The `LIMIT 1` is not an optimisation. `FROM_SQL`'s joins are keyed on their
 * tables' primary keys and cannot multiply a row, so the statement returns at
 * most one anyway; it says out loud that the answer is a boolean.
 */
export function matchesQuery(
  db: ProjectionDb,
  query: FilterQuery,
  docId: string,
  nowMs: number,
  thresholds?: StalenessThresholds,
): boolean {
  const compiled = compileFilters(query, nowMs, thresholds);
  // A `q` that carried no indexable token is an empty result set by
  // construction, so no document is in it — including this one.
  if (compiled.emptyByQuery) return false;
  const searching = compiled.match !== null;
  compiled.binder.fixed("doc", docId);
  const sql = `${searching ? `WITH ${COUNT_MATCH_CTE}\n` : ""}SELECT 1 AS matched
  ${FROM_SQL}
  ${searching ? "JOIN m ON m.id = d.id" : ""}
  ${whereClause(compiled)} AND d.id = @doc
  LIMIT 1`;

  return db.prepare(sql).get(paramsFor(sql, compiled.binder.all())) !== undefined;
}
