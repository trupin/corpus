// The predicate builder every read path shares (SPEC.md §9.2, §7 Retrieval
// discipline): the WHERE clause `GET /api/docs` and `GET /api/search` both ask
// with, the FROM its aliases are written against, and the FTS hit
// materialization both rank from.
//
// Extracted from `query.ts` for SERVER-040, and the extraction is the point.
// §9.2 promises ranked retrieval "the same set, with the same semantics
// (including the archived default)" of filters as the collection query, and a
// promise kept by two hand-maintained copies is a promise that expires the day
// someone adds the sixteenth filter. There is one builder; a filter added here
// lands on both endpoints without a second edit, which is what makes the
// parity assertion structural rather than a review note.
//
// The three rules `query.ts` documents still hold, and hold here because this
// is where they are implemented: nothing user-supplied is ever interpolated
// (values bind by name; only this module's own fragments become SQL text),
// thread-only filters no-op for non-thread rows (`t.id IS NULL OR <condition>`),
// and every fragment names only the aliases {@link FROM_SQL} binds.
//
// `isParent` is the one filter that reads a `threads` column *without* that
// guard, on purpose; the reason is at its own site rather than here, because the
// guard is what a reader would otherwise add back.

import type { DocsQuery } from "@corpus/contract";
import { STALE_TIERS } from "@corpus/contract";
import { normalizeInstant } from "../core/time.js";
import { SNIPPET_CLOSE, SNIPPET_ELLIPSIS, SNIPPET_OPEN, SNIPPET_TOKENS } from "./fts.js";
import { toFtsMatchExpression } from "./fts.js";
import { ANY_REASON_SQL, NEEDS_REASON_SQL, UNREAD_SQL } from "./needs.js";
import { atOrBeyondSql, stalenessCutoffs, tierParam } from "./staleness.js";

/** Where documents live, and therefore what `folder` is relative to (SPEC.md §4). */
export const DOCS_ROOT = "data/docs";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DUE_WEEK_DAYS = 7;

/**
 * Collects bind values under stable names. {@link paramsFor} then hands each
 * prepared statement exactly the subset it mentions — better-sqlite3 rejects a
 * bound name the SQL does not use, and the row query and the count query never
 * mention the same set.
 */
export class Binder {
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

export function paramsFor(
  sql: string,
  bound: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
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

/**
 * §11's default lifecycle rule — "archived documents are organizational, not
 * deleted, and drop out of the default set" — as one fragment parameterized by
 * the row it judges. Written once because it is applied in the places that must
 * agree: the collection query's own WHERE clause, the `unreadThreads` aggregate
 * whose contract is to equal the count that clause returns, and the related set
 * (`GET /api/docs/{id}/related`), which §9.2 says excludes archived neighbours
 * "like every list".
 */
export const notArchivedSql = (alias: string): string => `${alias}.status <> 'archived'`;

/**
 * The two optional rows every filter fragment may name beside `d`, as joins a
 * statement can append to a `documents` alias it reached its own way.
 *
 * Split out of {@link FROM_SQL} for the semantic scan (SERVER-045), which starts
 * from `chunk_embeddings` and reaches `documents` through the chunk rather than
 * selecting from it: it still has to end up with the same `t` and `s` in scope,
 * or a thread-only filter would be a SQL error on one endpoint and a predicate
 * on the other.
 */
export const DOC_FILTER_JOINS = `LEFT JOIN threads t ON t.id = d.id
  LEFT JOIN seen s ON s.thread_id = d.id`;

/**
 * What every filtered read selects from. The WHERE clause the builder returns
 * names `d`, `t` and `s` and nothing else, which is what lets three different
 * statements — the page, its COUNT, and ranked retrieval — share one set of
 * conditions while joining whatever their own rows additionally need.
 */
export const FROM_SQL = `FROM documents d
  ${DOC_FILTER_JOINS}`;

/**
 * The FTS5 hits, materialized once per statement.
 *
 * `snippet()` is an FTS5 auxiliary function and refuses to run in an aggregate
 * or correlated context, so the hits are materialized first — the `MATERIALIZED`
 * hint is load-bearing, not a performance note: without it SQLite flattens the
 * subquery into the aggregate and the statement fails to run at all.
 *
 * `rank` is FTS5's bm25 score (more negative is a better match), and it is the
 * *only* ranking in the product: the collection query's `sort=relevance` and
 * ranked retrieval both order by an aggregate of this column. The columns are
 * addressed positionally — 3 is `title`, 4 is `body` in the `search` table's
 * declaration (`projection/schema.ts`) — so the two consumers cannot disagree
 * about which snippet is which.
 */
export const FTS_HITS_CTE = `hits AS MATERIALIZED (
    SELECT doc_id, kind, ref, rank,
           snippet(search, 3, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '${SNIPPET_ELLIPSIS}', ${String(SNIPPET_TOKENS)}) AS title,
           snippet(search, 4, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '${SNIPPET_ELLIPSIS}', ${String(SNIPPET_TOKENS)}) AS body
      FROM search WHERE search MATCH @q
  )`;

/**
 * The one relevance ordering in the product: FTS5's bm25 `rank` (more negative
 * is a better match), aggregated per document by the statement that spells
 * {@link FTS_HITS_CTE}, then `d.id` so ties are stable — the convention every
 * shipped ordering follows. `GET /api/docs?sort=relevance` and `GET /api/search`
 * both order by this string, so there is no second ranking to drift from.
 */
export const RELEVANCE_ORDER_BY = "m.rank ASC, d.id ASC";

export interface Compiled {
  readonly conditions: string[];
  readonly binder: Binder;
  /** The FTS5 expression, or `null` when `q` was absent or carried no token. */
  readonly match: string | null;
  /** True when `q` was present but unsearchable — the result set is empty by construction. */
  readonly emptyByQuery: boolean;
}

/**
 * Everything {@link compileFilters} reads: the §9.2 filter set plus `q`.
 *
 * Written as the collection query's own type minus the three parameters ranked
 * retrieval does not carry (`sort`, `limit`, `offset` are ordering and paging,
 * not predicates), so a filter added to the contract's shared `docFilterShape`
 * reaches this builder as a type error rather than as silence. `pinned` and
 * `isParent` stay optional here because `GET /api/docs` declares them and
 * `/api/search` does not — the builder simply finds them absent, which is what
 * lets one builder serve an endpoint whose query type is the smaller of the two
 * without ranked retrieval growing a filter §9.2 never signed for it.
 */
export type FilterQuery = Omit<DocsQuery, "sort" | "limit" | "offset">;

export function compileFilters(query: FilterQuery, nowMs: number): Compiled {
  const binder = new Binder();
  const conditions: string[] = [];
  const today = calendarDate(nowMs);
  const cutoffs = stalenessCutoffs(nowMs);

  // Referenced by the Attention columns and the staleness tier every response
  // carries, so always bound. `paramsFor` then hands each statement only the
  // cutoffs its own SQL spells — the COUNT query mentions none of them unless a
  // filter put one in the WHERE clause.
  binder.fixed("today", today);
  for (const tier of STALE_TIERS) binder.fixed(`cutoff_${tierParam(tier)}`, cutoffs[tier]);

  if (query.type !== undefined) {
    const types = csv(query.type).map((type) => binder.next("type", type));
    conditions.push(types.length === 0 ? "0" : `d.type IN (${types.join(", ")})`);
  }

  // SPEC.md §11: archived documents are organizational, not deleted — they drop
  // out of the default set and come back only when they are asked for. There are
  // two ways to ask and they mean different things (CONTRACT-012): `status`
  // *narrows* to one lifecycle state, so `status=archived` is archived and
  // nothing else, while `includeArchived` *widens* the default into the union the
  // board's "include archived" chip promises. `status` replaces the default
  // outright, which is why `includeArchived` alongside it is a documented no-op
  // rather than a second filter — nothing below reads it in that case.
  //
  // The union is spelled `1` rather than by pushing nothing, so this rule always
  // contributes a condition: `conditions` is never empty and the WHERE clause
  // always parses, whatever else the caller asked for.
  conditions.push(
    query.status !== undefined
      ? `d.status = ${binder.next("status", query.status)}`
      : query.includeArchived === true
        ? "1"
        : notArchivedSql("d"),
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

  if (query.stale !== undefined) conditions.push(atOrBeyondSql(query.stale));

  if (query.unread !== undefined) {
    conditions.push(
      `(t.id IS NULL OR ${UNREAD_SQL} = ${binder.next("unread", query.unread ? 1 : 0)})`,
    );
  }

  // Not thread-only: any document may carry `pinned`, though only a view
  // renders as a column (SPEC.md §11). `pinned=true&type=view&sort=order` is
  // the board's entire column set, in one bounded query. Ranked retrieval does
  // not declare it (a board concern, not a retrieval one), so this branch is
  // simply never taken there.
  if (query.pinned !== undefined) {
    conditions.push(`d.pinned = ${binder.next("pinned", query.pinned ? 1 : 0)}`);
  }

  // `isParent` — "is this document a child of something?" (CONTRACT-042). The
  // one structural filter, and deliberately **not** thread-only, which is the
  // whole reason it is not written with the `t.id IS NULL OR …` guard the four
  // filters above carry.
  //
  // The guard exists because `parent=<id>`, `agent=…`, `author=…` and `unread=…`
  // ask questions only a thread row can answer, so a `documents`-only row must
  // fall through rather than be judged. This question every row answers: a note
  // has no parent, and that null is a fact about the note rather than a missing
  // join. It is the same null the row itself reports — `query.ts` selects
  // `t.parent_id AS parent` through this very LEFT JOIN — so the filter and the
  // field can only ever agree, and a standalone note nothing hangs off matches
  // `isParent=true` exactly like a top-level document that has ten threads.
  // The filter asks what a document is *under*, never what is under it.
  //
  // `isParent=false` includes an orphaned thread whose parent document was
  // deleted: `t.parent_id` still names one, and §9.2 already treats such a row
  // as parented-but-unresolvable (`parentTitle` reads null while `parent` does
  // not), so excluding it here would make the filter disagree with the field.
  //
  // `parent=<id>` alongside `isParent=true` never arrives: `DocsQuerySchema`
  // refuses that pair with a 400 before the handler runs (CONTRACT-042), because
  // `parent`'s thread-only guard passes every non-thread row unconditionally and
  // the intersection would be every root non-thread document — a plausible
  // answer to a question nobody asked. Nothing here re-checks it; the refusal is
  // the contract's, so there is one rule rather than two that could drift.
  //
  // Neither branch binds a value: the boolean chooses between two of this
  // module's own fragments, and nothing user-supplied becomes SQL text.
  if (query.isParent !== undefined) {
    conditions.push(query.isParent ? "t.parent_id IS NULL" : "t.parent_id IS NOT NULL");
  }

  if (query.needs !== undefined) {
    conditions.push(query.needs === "me" ? ANY_REASON_SQL : NEEDS_REASON_SQL[query.needs]);
  }

  const match = query.q === undefined ? null : toFtsMatchExpression(query.q);
  if (match !== null) binder.fixed("q", match);

  return { conditions, binder, match, emptyByQuery: query.q !== undefined && match === null };
}

/**
 * The WHERE clause for a compiled filter set. Never empty: the archived rule
 * contributes a condition whatever else the caller asked for, and an
 * unsearchable `q` contributes the `0` that makes the empty result set explicit
 * rather than accidental.
 */
export function whereClause(compiled: Compiled): string {
  const conditions = [...compiled.conditions];
  if (compiled.emptyByQuery) conditions.push("0");
  return `WHERE ${conditions.join("\n    AND ")}`;
}
