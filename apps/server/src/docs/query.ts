// `GET /api/docs` — the single collection query behind every list in the
// product (SPEC.md §9.2, §11): board columns, the search overlay, the Attention
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

import {
  DEFAULT_DOC_SORT,
  NEEDS_REASONS,
  type DocList,
  type DocRow,
  type DocSort,
  type DocsQuery,
} from "@corpus/contract";
import { normalizeInstant } from "../core/time.js";
import type { ProjectionDb } from "../projection/index.js";
import {
  parseSnippets,
  SNIPPET_CLOSE,
  SNIPPET_ELLIPSIS,
  SNIPPET_OPEN,
  SNIPPET_TOKENS,
  toFtsMatchExpression,
} from "./fts.js";
import {
  ANY_REASON_SQL,
  NEEDS_REASON_SQL,
  reasonColumn,
  rowAttention,
  UNREAD_SQL,
} from "./needs.js";
import { atOrBeyondSql, stalenessCutoffs, tierParam } from "./staleness.js";

/** Where documents live, and therefore what `folder` is relative to (SPEC.md §4). */
export const DOCS_ROOT = "data/docs";

/**
 * Serialized `created`/`updated` for a document that carries neither. The
 * projection stores NULL (a hand-written `SKILL.md` legitimately has no
 * timestamps, SPEC.md §7) but `DocRow` declares both non-nullable, so a row has
 * to say *something*. The epoch is chosen over the file's mtime because it is
 * identical in every clone; staleness deliberately does **not** read it — an
 * unknown age is not an old one (see `staleness.ts`).
 */
export const UNDATED_INSTANT = "1970-01-01T00:00:00Z";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DUE_WEEK_DAYS = 7;

/**
 * Collects bind values under stable names. `paramsFor` then hands each prepared
 * statement exactly the subset it mentions — better-sqlite3 rejects a bound name
 * the SQL does not use, and the row query and the count query never mention the
 * same set.
 */
class Binder {
  private readonly values: Record<string, unknown> = {};
  private sequence = 0;

  /** Binds under a generated name; returns the `@placeholder` to splice into SQL. */
  next(prefix: string, value: unknown): string {
    const name = `${prefix}_${String(this.sequence)}`;
    this.sequence += 1;
    this.values[name] = value;
    return `@${name}`;
  }

  /** Binds under a fixed name, for fragments that spell the placeholder themselves. */
  fixed(name: string, value: unknown): void {
    this.values[name] = value;
  }

  all(): Readonly<Record<string, unknown>> {
    return this.values;
  }
}

const PLACEHOLDER = /@[A-Za-z_][A-Za-z0-9_]*/g;

function paramsFor(sql: string, bound: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const used = new Set((sql.match(PLACEHOLDER) ?? []).map((name) => name.slice(1)));
  return Object.fromEntries(Object.entries(bound).filter(([name]) => used.has(name)));
}

/** Comma-separated values OR within one parameter (SPEC.md §9.2's grammar). */
function csv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

const LIKE_SPECIAL = /[\\%_]/g;

/** Escapes a LIKE prefix so a folder named `q_1` cannot match `q11`. */
function likePrefix(value: string): string {
  return `${value.replace(LIKE_SPECIAL, (char) => `\\${char}`)}%`;
}

/**
 * `folder` is accepted as a bare name (`finance`), with the root spelled out
 * (`data/docs/finance`), with a trailing slash, or as `/` for the root itself.
 * Returns the workspace-relative path prefix every match must start with.
 */
export function folderPathPrefix(folder: string): string {
  let relative = folder.trim().replace(/^\/+|\/+$/g, "");
  if (relative === DOCS_ROOT) relative = "";
  else if (relative.startsWith(`${DOCS_ROOT}/`)) relative = relative.slice(DOCS_ROOT.length + 1);
  return relative === "" ? `${DOCS_ROOT}/` : `${DOCS_ROOT}/${relative}/`;
}

/** Calendar date `days` from now, in UTC — never string arithmetic on the ISO text. */
const calendarDate = (nowMs: number, days = 0): string =>
  new Date(nowMs + days * MS_PER_DAY).toISOString().slice(0, 10);

interface Compiled {
  readonly conditions: string[];
  readonly binder: Binder;
  /** The FTS5 expression, or `null` when `q` was absent or carried no token. */
  readonly match: string | null;
  /** True when `q` was present but unsearchable — the result set is empty by construction. */
  readonly emptyByQuery: boolean;
}

function compileFilters(query: DocsQuery, nowMs: number): Compiled {
  const binder = new Binder();
  const conditions: string[] = [];
  const today = calendarDate(nowMs);
  const cutoffs = stalenessCutoffs(nowMs);

  // Referenced by the Attention columns every response carries, so always bound.
  binder.fixed("today", today);
  binder.fixed(`cutoff_${tierParam("stale")}`, cutoffs.stale);

  if (query.type !== undefined) {
    const types = csv(query.type).map((type) => binder.next("type", type));
    conditions.push(types.length === 0 ? "0" : `d.type IN (${types.join(", ")})`);
  }

  // SPEC.md §11: archived documents are organizational, not deleted — they drop
  // out of the default set and come back only when `status` is asked for.
  conditions.push(
    query.status === undefined
      ? "d.status <> 'archived'"
      : `d.status = ${binder.next("status", query.status)}`,
  );

  if (query.tag !== undefined) {
    const tags = csv(query.tag).map((tag) => binder.next("tag", tag.toLowerCase()));
    conditions.push(
      tags.length === 0
        ? "0"
        : `EXISTS (SELECT 1 FROM json_each(d.tags_json) tg WHERE lower(tg.value) IN (${tags.join(", ")}))`,
    );
  }

  if (query.folder !== undefined) {
    // §11 folder scoping: a folder column shows the documents filed there *and*
    // the conversations about them, so a thread inherits its parent's folder.
    const prefix = binder.next("folder", likePrefix(folderPathPrefix(query.folder)));
    conditions.push(
      `(d.path LIKE ${prefix} ESCAPE '\\' OR EXISTS (
         SELECT 1 FROM documents p WHERE p.id = t.parent_id AND p.path LIKE ${prefix} ESCAPE '\\'))`,
    );
  }

  if (query.parent !== undefined) {
    conditions.push(`(t.id IS NULL OR t.parent_id = ${binder.next("parent", query.parent)})`);
  }

  if (query.references !== undefined) {
    conditions.push(
      `EXISTS (SELECT 1 FROM links l WHERE l.from_id = d.id AND l.to_id = ${binder.next("ref", query.references)})`,
    );
  }

  if (query.agent !== undefined) {
    conditions.push(`(t.id IS NULL OR t.agent = ${binder.next("agent", query.agent)})`);
  }

  if (query.author !== undefined) {
    conditions.push(`(t.id IS NULL OR t.last_author = ${binder.next("author", query.author)})`);
  }

  if (query.since !== undefined) {
    // Normalized because the column holds canonical second-precision instants
    // and the comparison is lexicographic: `…T00:00:00.000Z` would sort after
    // its own second and silently drop a matching row.
    const since = normalizeInstant(query.since) ?? query.since;
    conditions.push(`(d.updated IS NOT NULL AND d.updated > ${binder.next("since", since)})`);
  }

  if (query.due !== undefined) {
    // A non-keyword `due` is already a bare `YYYY-MM-DD` — `IsoDateSchema` pins
    // exactly the shape the column holds, so there is nothing to normalize.
    const bound =
      query.due === "overdue"
        ? undefined
        : query.due === "today"
          ? today
          : query.due === "week"
            ? calendarDate(nowMs, DUE_WEEK_DAYS)
            : query.due;
    conditions.push(
      bound === undefined
        ? `(d.due IS NOT NULL AND d.due < ${binder.next("due", today)})`
        : `(d.due IS NOT NULL AND d.due <= ${binder.next("due", bound)})`,
    );
  }

  if (query.stale !== undefined) {
    binder.fixed(`cutoff_${tierParam(query.stale)}`, cutoffs[query.stale]);
    conditions.push(atOrBeyondSql(query.stale));
  }

  if (query.unread !== undefined) {
    conditions.push(
      `(t.id IS NULL OR ${UNREAD_SQL} = ${binder.next("unread", query.unread ? 1 : 0)})`,
    );
  }

  if (query.needs !== undefined) {
    conditions.push(query.needs === "me" ? ANY_REASON_SQL : NEEDS_REASON_SQL[query.needs]);
  }

  const match = query.q === undefined ? null : toFtsMatchExpression(query.q);
  if (match !== null) binder.fixed("q", match);

  return { conditions, binder, match, emptyByQuery: query.q !== undefined && match === null };
}

/** Every ordering ends in `d.id` so paging over ties is stable (TEST-49). */
const ORDER_BY: Readonly<Record<DocSort, string>> = {
  updated: "d.updated ASC, d.id ASC",
  "-updated": "d.updated DESC, d.id ASC",
  created: "d.created ASC, d.id ASC",
  "-created": "d.created DESC, d.id ASC",
  due: "d.due IS NULL, d.due ASC, d.id ASC",
  title: "d.title COLLATE NOCASE ASC, d.id ASC",
  // FTS5 `rank` is a bm25 score: more negative is a better match.
  relevance: "m.rank ASC, d.id ASC",
};

const FROM_SQL = `FROM documents d
  LEFT JOIN threads t ON t.id = d.id
  LEFT JOIN seen s ON s.thread_id = d.id`;

/**
 * `snippet()` is an FTS5 auxiliary function and refuses to run in an aggregate
 * or correlated context, so the hits are materialized first — the `MATERIALIZED`
 * hint is load-bearing, not a performance note: without it SQLite flattens the
 * subquery into the aggregate and the statement fails to run at all.
 */
const HITS_CTE = `hits AS MATERIALIZED (
    SELECT doc_id, kind, ref, rank,
           snippet(search, 3, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '${SNIPPET_ELLIPSIS}', ${String(SNIPPET_TOKENS)}) AS title,
           snippet(search, 4, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '${SNIPPET_ELLIPSIS}', ${String(SNIPPET_TOKENS)}) AS body
      FROM search WHERE search MATCH @q
  ),
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
  readonly excerpt: string;
  readonly snippets_json: string | null;
}

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
    created: row.created ?? UNDATED_INSTANT,
    updated: row.updated ?? UNDATED_INSTANT,
    due: row.due,
    reviewed: row.reviewed,
    evergreen: row.evergreen !== 0,
    excerpt: row.excerpt,
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
export function queryDocs(db: ProjectionDb, query: DocsQuery, nowMs: number): DocList {
  const compiled = compileFilters(query, nowMs);

  // Never empty: the archived rule contributes a condition whatever else the
  // caller asked for.
  const conditions = [...compiled.conditions];
  if (compiled.emptyByQuery) conditions.push("0");
  const where = `WHERE ${conditions.join("\n    AND ")}`;

  // `sort=relevance` without `q` is a 400 from the contract's own refinement, so
  // the only way to reach it here is a `q` that carried no indexable token —
  // there is no rank to order by, and the result set is empty regardless.
  const searching = compiled.match !== null;
  const sort: DocSort = sortOf(query.sort, searching);

  const rowsSql = `${searching ? `WITH ${HITS_CTE}\n` : ""}SELECT d.id AS id, d.type AS type, d.title AS title, d.path AS path,
         d.status AS status, d.tags_json AS tags_json, d.created AS created, d.updated AS updated,
         d.due AS due, d.reviewed AS reviewed, d.evergreen AS evergreen, d.body_excerpt AS excerpt,
         ${searching ? "m.snippets" : "NULL"} AS snippets_json,
         ${REASON_COLUMNS}
  ${FROM_SQL}
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
