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
// returns at most `limit` rows, and the address derivation runs over those rows
// alone: one lookup of the indexed text for the document hits that matched in
// their body, one `turns` row per turn hit. A corpus of fifty thousand
// documents and a corpus of fifty cost the same after the ranking.

import type { ProjectionDb } from "../projection/index.js";
import type { SearchHit, SearchQuery, SearchResults } from "@corpus/contract";
import { HEADING_PATH_SEPARATOR } from "@corpus/contract";
import { toOneLine } from "../core/one-line.js";
import { TURN_SEPARATOR } from "../core/turns.js";
import {
  compileFilters,
  FROM_SQL,
  FTS_HITS_CTE,
  paramsFor,
  RELEVANCE_ORDER_BY,
  whereClause,
} from "../docs/index.js";
import { enclosingHeadings, hasMatch, locatePassage, unmarkSnippet } from "./heading-path.js";
import type { UnmarkedSnippet } from "./heading-path.js";

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

/**
 * Reads the text a hit's address is derived from, keyed by `search.ref`.
 *
 * **The projection's own copy of the text is the source, not the file on disk**
 * — the decision SERVER-040 was required to make and state. Three reasons:
 *
 * 1. *It is the text the hit is about.* The snippet, the rank and the heading
 *    path then describe one string. Reading the file instead would address a
 *    passage in whatever the document says **now** while quoting the passage the
 *    index matched, and the two disagree during exactly the window that matters
 *    — the seconds after a save, when the watcher has not caught up.
 * 2. *It is already the right slice.* A thread's `kind='doc'` row indexes only
 *    its preamble (`projection/project-document.ts`), so the scan cannot walk
 *    into a turn and claim its heading; the file would need that boundary
 *    reconstructed here, in a second place.
 * 3. *It costs no filesystem.* No `readFileSync`, no frontmatter parse, no
 *    ENOENT race against a document deleted since it was projected — one
 *    indexed `ref IN (…)` lookup for the whole page.
 *
 * The cost is that the indexed copy is lossy by exactly two characters: U+0002
 * and U+0003, stripped at index time because they are `snippet()`'s own markup
 * (`docs/fts.ts`). Neither can appear in a heading's *name* after stripping, and
 * neither is a line terminator or a `#`, so heading structure is identical in
 * both copies. That is the whole of the difference, and it is invisible in an
 * address.
 *
 * Injectable so a test can count what a request actually read (the `readHead`
 * seam's precedent, SERVER-022).
 */
export type PassageTextLoader = (
  db: ProjectionDb,
  refs: readonly string[],
) => ReadonlyMap<string, string>;

export const loadPassageTexts: PassageTextLoader = (db, refs) => {
  const texts = new Map<string, string>();
  if (refs.length === 0) return texts;
  const placeholders = refs.map((_, index) => `@r${String(index)}`).join(", ");
  const params = Object.fromEntries(refs.map((ref, index) => [`r${String(index)}`, ref]));
  const rows = db
    .prepare(`SELECT ref, body FROM search WHERE ref IN (${placeholders})`)
    .all(params) as { ref: string; body: string }[];
  for (const row of rows) texts.set(row.ref, row.body);
  return texts;
};

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

/**
 * Runs ranked retrieval. Two statements at most beyond the ranking: one text
 * lookup for the document hits that matched in their body, one `turns` seek per
 * turn hit — both bounded by `limit`, never by the corpus.
 */
export function searchCorpus(
  db: ProjectionDb,
  query: SearchQuery,
  nowMs: number,
  loadTexts: PassageTextLoader = loadPassageTexts,
): SearchResults {
  const compiled = compileFilters(query, nowMs);
  // `q` is required and non-empty by the schema, so the only way here is a
  // query that carried no indexable token (`***`). There is nothing to rank and
  // nothing to bind — an empty ranking, exactly as the collection query answers
  // the same input, and never a 500.
  if (compiled.match === null) return { hits: [] };

  compiled.binder.fixed("limit", query.limit);
  const sql = rankedHitsSql(whereClause(compiled));
  const raw = db.prepare(sql).all(paramsFor(sql, compiled.binder.all())) as RawHit[];

  const found = raw.map((row) => ({
    row,
    body: unmarkSnippet(row.body_snippet),
    title: unmarkSnippet(row.title_snippet),
  }));
  // Only the hits whose address actually depends on the text: a turn's heading
  // comes from its `turns` row, and a document that matched in its title alone
  // is addressed by that title.
  const texts = loadTexts(
    db,
    found.filter((hit) => hit.row.kind !== "turn" && hasMatch(hit.body)).map((hit) => hit.row.ref),
  );

  const hits = found.map((hit): SearchHit => ({
    id: hit.row.id,
    title: hit.row.title,
    headingPath: headingPathFor(db, hit.row, hit.body, texts),
    snippet: snippetOf(hit.body, hit.title),
  }));

  // `semanticIndex` is Retrieval Phase B's seam and is **absent** in Phase A:
  // the contract reads an absent field as "the server makes no claim", which is
  // the truth here, where no semantic index exists to be current. Emitting
  // `current` would assert that one is caught up (SPEC.md §9.1) and would be
  // the first line of Phase B machinery written under a Phase A issue.
  return { hits };
}

/**
 * A hit's address, in the three shapes there are (SPEC.md §9.2):
 *
 * - **A turn hit** — the turn's own heading, from the `turns` row.
 * - **A document hit** — the enclosing headings of the matched passage, joined
 *   by the contract's `HEADING_PATH_SEPARATOR`, which is a *display* join: a
 *   heading may contain the separator, so a client prints this and never splits
 *   it.
 * - **Anything with no heading above it** — the document's title, so a hit
 *   always has an address. This covers three real cases at once: a document
 *   whose body opens without a heading, a match in a *title* (there is no
 *   passage in the body to enclose), and a hit on a **thread's preamble** —
 *   the text a thread carries before its first turn, which conventionally has
 *   no headings at all. The preamble case is the one worth naming: it is
 *   neither a turn nor a sectioned document body, and it comes out right here
 *   without a special case because the indexed text for a thread's document row
 *   *is* its preamble, so the scan is bounded to it and finds nothing above.
 */
function headingPathFor(
  db: ProjectionDb,
  row: RawHit,
  body: UnmarkedSnippet,
  texts: ReadonlyMap<string, string>,
): string {
  if (row.kind === "turn") return turnHeading(db, row.ref) ?? row.title;
  const text = texts.get(row.ref);
  if (text === undefined) return row.title;
  const headings = enclosingHeadings(text, locatePassage(text, body));
  return headings.length === 0 ? row.title : headings.join(HEADING_PATH_SEPARATOR);
}
