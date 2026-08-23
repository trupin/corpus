// `GET /api/search` — ranked retrieval (SPEC.md §7 Retrieval discipline, §9.2).
//
// **Why this exists beside `GET /api/docs?q=&sort=relevance`.** Not for the
// ranking: that ships, and this module reuses it wholesale — the same
// `search MATCH @q` materialization, the same bm25 `rank`, the same `MIN(rank)`
// aggregate, the same filter builder, the same archived default. What is new is
// the *output*: a hit is an **address plus a line of context** — id, title, the
// heading path of the best-matching passage, one snippet line — and never a
// body. The collection query's rows carry frontmatter, attention reasons,
// thread affordances and snippet segment arrays; their cost scales with the
// documents rather than with the answer, and §1's claim that the agent
// "retrieves; it never enumerates" is a claim about that cost.
//
// **Everything derived on read is bounded by `limit`.** The ranked statement
// returns at most `limit` rows — `RETRIEVAL_OVERFETCH_FACTOR × limit` when there
// is a semantic list to fuse with — and the address derivation runs over the
// *answered* page alone: one lookup of the indexed text for the document hits
// that matched in their body, one `turns` row per turn hit. A corpus of fifty
// thousand documents and a corpus of fifty cost the same after the ranking.
//
// **Retrieval Phase B fuses two rankings into this one shape** (SPEC.md §9.1,
// §9.2). The lexical half above is untouched — same statement, same bm25, same
// filters — and a semantic half ranks the same documents by cosine distance
// between the query's embedding and the corpus's chunk vectors. The two ordered
// id lists go through reciprocal-rank fusion (`fusion.ts`) and the result is
// materialized into the *same* four-field hit. Three consequences worth naming:
//
// - **The response shape did not move.** `semanticIndex` is the one addition,
//   and it is a field the contract has carried since CONTRACT-022 precisely so
//   this issue would not have to widen anything.
// - **A workspace with no semantic index answers byte-identically to Phase A.**
//   With no semantic candidates there is one list, RRF over one list re-derives
//   that list, and the lexical statement is bound to the caller's own `limit` —
//   so the disabled path issues the same SQL with the same value and assembles
//   the same rows (TEST-883).
// - **A semantic-only hit is a real hit.** It has no FTS row to take a snippet
//   from, so its address and its line of context come from the chunk that
//   matched — which is the same chunk-granular table the lexical half addresses
//   through, so both halves name a passage the same way.

import type { ProjectionDb } from "../projection/index.js";
import type { SearchHit, SearchQuery, SearchResults } from "@corpus/contract";
import { toOneLine } from "../core/one-line.js";
import { TURN_SEPARATOR } from "../core/turns.js";
import {
  compileFilters,
  FROM_SQL,
  FTS_HITS_CTE,
  paramsFor,
  RELEVANCE_ORDER_BY,
  whereClause,
  type Compiled,
  type StalenessThresholds,
} from "../docs/index.js";
import {
  loadChunkAddresses,
  loadSemanticOnlyHits,
  type ChunkAddressLoader,
  type SemanticRetrieval,
  type SemanticOutcome,
} from "../semantic/index.js";
import { fuseRankings, overFetchLimit } from "./fusion.js";
import { hasMatch, unmarkSnippet } from "./snippet.js";
import type { UnmarkedSnippet } from "./snippet.js";

/**
 * One document per hit, ranked by its best-matching passage, and that passage
 * identified.
 *
 * - `m` is the list's own aggregate, verbatim: `MIN(rank)` per document, so a
 *   document matching in its title, its body and three turns is **one** hit
 *   ranked by its best row rather than five rows of the same document.
 * - `best` names which row that was. `MIN(h.ref)` breaks a rank tie the way
 *   every shipped ordering breaks one — by id, deterministically — so the same
 *   query twice returns the same passage and the same snippet.
 * - The join back to `hits` is by `ref`, the `search` table's unique key (a
 *   document's own row is keyed by its id, a turn's by `<id>#<ts>`), so it
 *   cannot multiply the row.
 */
const rankedHitsSql = (where: string): string => `WITH ${FTS_HITS_CTE},
  m AS (SELECT doc_id AS id, MIN(rank) AS rank FROM hits GROUP BY doc_id),
  best AS (
    SELECT h.doc_id AS id, MIN(h.ref) AS ref
      FROM hits h JOIN m ON m.id = h.doc_id AND h.rank = m.rank
     GROUP BY h.doc_id
  )
SELECT d.id AS id, d.title AS title, h.kind AS kind, h.ref AS ref,
       h.title AS title_snippet, h.body AS body_snippet
  ${FROM_SQL}
  JOIN m ON m.id = d.id
  JOIN best b ON b.id = d.id
  JOIN hits h ON h.ref = b.ref
  ${where}
  ORDER BY ${RELEVANCE_ORDER_BY}
  LIMIT @limit`;

interface RawHit {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly ref: string;
  readonly title_snippet: string;
  readonly body_snippet: string;
}

/** A turn row's identity, as `search.ref` encodes it: `<threadId>#<ts>`. */
const splitTurnRef = (ref: string): { readonly threadId: string; readonly ts: string } | null => {
  const hash = ref.indexOf("#");
  return hash < 0 ? null : { threadId: ref.slice(0, hash), ts: ref.slice(hash + 1) };
};

/**
 * A turn hit's address is its own heading — `<author> · <ts>`, the H2 §6 pins —
 * and it is built from the `ref` plus the `turns` row, so **no text is read at
 * all** for a turn hit. The `##` markers are dropped for the same reason a
 * document section's are: the path is the heading's name, not its markdown.
 */
function turnHeading(db: ProjectionDb, ref: string): string | null {
  const parts = splitTurnRef(ref);
  if (parts === null) return null;
  const row = db
    .prepare("SELECT author FROM turns WHERE thread_id = @thread AND ts = @ts")
    .get({ thread: parts.threadId, ts: parts.ts }) as { author: string } | undefined;
  return row === undefined ? null : `${row.author} ${TURN_SEPARATOR} ${parts.ts}`;
}

/**
 * The line of context. `snippet()` marks matched terms with two control
 * characters and returns a *segment* shape to the collection query; retrieval's
 * snippet is a plain single line, so the markers are consumed here and never
 * serialized — a U+0002 reaching the agent's one-line-per-hit output would
 * corrupt a surface that never expected one.
 *
 * The body's window is preferred when the body matched; a document that matched
 * only in its title gets its title's window, which is the passage there is.
 */
function snippetOf(body: UnmarkedSnippet, title: UnmarkedSnippet): string {
  return toOneLine(hasMatch(body) || !hasMatch(title) ? body.text : title.text);
}

/** One lexical row, with its two snippet columns already unmarked. */
interface FoundHit {
  readonly row: RawHit;
  readonly body: UnmarkedSnippet;
  readonly title: UnmarkedSnippet;
}

export interface SearchDeps {
  /**
   * Injectable so a test can count what a request actually read — the seam the
   * chunk address lookup has held since SERVER-042.
   */
  readonly loadAddresses?: ChunkAddressLoader | undefined;
  /**
   * Retrieval's semantic half. Absent, ranking is lexical and the response says
   * `disabled` — the honest word for a server with no semantic index wired,
   * which is what a unit test constructing this function directly has.
   */
  readonly semantic?: SemanticRetrieval | undefined;
  /**
   * The workspace's staleness ramp (SPEC.md §5, SERVER-133). §9.2 promises a
   * saved query means one thing wherever it is asked, so ranked retrieval reads
   * the same configured thresholds the collection query does. Omitted, the
   * shipped 30/90/180.
   */
  readonly staleness?: StalenessThresholds | undefined;
}

/** The answer when there is nothing to rank; the state word is still owed. */
const emptyResults = (outcome: SemanticOutcome): SearchResults => ({
  hits: [],
  semanticIndex: outcome.state,
});

const DISABLED: SemanticOutcome = { state: "disabled", docs: [] };

/**
 * Runs ranked retrieval.
 *
 * Beyond the ranking statement and the semantic scan: one chunk address lookup
 * for the document hits that matched in their body, one `turns` seek per turn
 * hit, and — only when the semantic half promoted a document the lexical half
 * never saw — one lookup of those chunks' text. Every one of them is bounded by
 * the answered page, never by the corpus.
 */
export async function searchCorpus(
  db: ProjectionDb,
  query: SearchQuery,
  nowMs: number,
  deps: SearchDeps = {},
): Promise<SearchResults> {
  const loadAddresses = deps.loadAddresses ?? loadChunkAddresses;
  const compiled = compileFilters(query, nowMs, deps.staleness);

  // `q` is required and non-empty by the schema, so the only way here is a
  // query that carried no indexable token (`***`). There is nothing to rank and
  // nothing to bind — an empty ranking, exactly as the collection query answers
  // the same input, and never a 500. The semantic half is not consulted either:
  // a string with no searchable token is not a question the index can answer,
  // and embedding punctuation would return the corpus in an arbitrary order.
  if (compiled.match === null) {
    return emptyResults(
      deps.semantic === undefined ? DISABLED : { state: await deps.semantic.state(), docs: [] },
    );
  }

  // Before the lexical statement, because its `LIMIT` depends on the answer:
  // fusion needs candidates past `limit` (premise correction C6), and a
  // workspace with no semantic index must issue the Phase A statement with the
  // Phase A value.
  const semantic =
    deps.semantic === undefined
      ? DISABLED
      : await deps.semantic.forQuery(query.q, scopeOf(compiled), overFetchLimit(query.limit));

  const fetchLimit = semantic.docs.length === 0 ? query.limit : overFetchLimit(query.limit);
  compiled.binder.fixed("limit", fetchLimit);
  const sql = rankedHitsSql(whereClause(compiled));
  const raw = db.prepare(sql).all(paramsFor(sql, compiled.binder.all())) as RawHit[];

  const found = new Map<string, FoundHit>();
  for (const row of raw) {
    found.set(row.id, {
      row,
      body: unmarkSnippet(row.body_snippet),
      title: unmarkSnippet(row.title_snippet),
    });
  }

  // One list means the list itself: RRF over a single ranking re-derives its
  // order exactly, so this is the same sequence Phase A returned.
  const ranked =
    semantic.docs.length === 0
      ? raw.slice(0, query.limit).map((row) => row.id)
      : fuseRankings(
          [raw.map((row) => row.id), semantic.docs.map((match) => match.id)],
          query.limit,
        ).map((entry) => entry.id);

  const lexical = ranked.flatMap((id) => {
    const hit = found.get(id);
    return hit === undefined ? [] : [hit];
  });
  // Only the hits whose address actually depends on a chunk: a turn's heading
  // comes from its `turns` row, and a document that matched in its title alone
  // is addressed by that title.
  const addresses = loadAddresses(
    db,
    lexical
      .filter((hit) => hit.row.kind !== "turn" && hasMatch(hit.body))
      .map((hit) => hit.row.ref),
    compiled.match,
  );
  const semanticOnly = loadSemanticOnlyHits(
    db,
    semantic.docs.filter((match) => !found.has(match.id) && ranked.includes(match.id)),
  );

  const hits = ranked.flatMap((id): SearchHit[] => {
    const hit = found.get(id);
    if (hit !== undefined) {
      return [
        {
          id: hit.row.id,
          title: hit.row.title,
          headingPath: headingPathFor(db, hit.row, addresses),
          snippet: snippetOf(hit.body, hit.title),
        },
      ];
    }
    const only = semanticOnly.get(id);
    return only === undefined ? [] : [only];
  });

  // Present from Retrieval Phase B onwards, on both envelopes, always: the
  // contract reads an *absent* field as "the server makes no claim", and this
  // server now has one to make — including `disabled`, which is a claim rather
  // than a silence (SPEC.md §9.1's local-first default is an honest state, not
  // an error). The Phase A tests that pinned the absence flip here deliberately.
  return { hits, semanticIndex: semantic.state };
}

/**
 * The filter predicate handed to the semantic scan.
 *
 * It is the *same* compiled clause the lexical statement is about to run, so
 * §9.2's "the same set, with the same semantics (including the archived
 * default)" holds across both halves by construction — an archived document
 * cannot be a semantic hit on an endpoint that excludes it lexically, and a new
 * filter reaches both halves without a second edit. The bound values are handed
 * over whole; each statement's own `paramsFor` keeps the subset it names.
 */
function scopeOf(compiled: Compiled): { where: string; params: Record<string, unknown> } {
  // `whereClause` prefixes `WHERE `, which the scan supplies itself.
  const clause = whereClause(compiled);
  return { where: clause.slice("WHERE ".length), params: { ...compiled.binder.all() } };
}

/**
 * A hit's address, in the three shapes there are (SPEC.md §9.2):
 *
 * - **A turn hit** — the turn's own heading, from the `turns` row. §9.2 says
 *   "for a hit in a thread turn, the turn's heading", full stop: a turn's
 *   chunks nest under that heading, but the address a turn hit reports is the
 *   heading itself, and it is built from the `ref` plus one row seek.
 * - **A document hit** — the heading path of the chunk that matched, recorded
 *   at projection time and joined by the contract's `HEADING_PATH_SEPARATOR`,
 *   which is a *display* join: a heading may contain the separator, so a client
 *   prints this and never splits it.
 * - **Anything with no heading above it** — the document's title, so a hit
 *   always has an address. This covers three real cases at once: a document
 *   whose body opens without a heading, a match in a *title* (there is no
 *   passage in the body to address), and a hit on a **thread's preamble** —
 *   the text a thread carries before its first turn, which conventionally has
 *   no headings at all. The first case the chunker itself answers, since a
 *   chunk with no heading above it records the document's title as its path;
 *   the other two arrive here as a ref the address lookup found nothing for,
 *   because there was no body match to find a chunk with.
 */
function headingPathFor(
  db: ProjectionDb,
  row: RawHit,
  addresses: ReadonlyMap<string, string>,
): string {
  if (row.kind === "turn") return turnHeading(db, row.ref) ?? row.title;
  return addresses.get(row.ref) ?? row.title;
}
