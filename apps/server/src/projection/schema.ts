// The derived SQLite schema (SPEC.md §9.1). Column names and spellings are the
// spec's, verbatim — the projection is the one place files and rows have to
// agree, and a renamed column here silently breaks every reader downstream.
//
// Nothing durable lives only in this database: every table is reconstructible
// from the workspace's files (§9.1, §15 M1). That invariant is why a schema
// change wipes and rebuilds instead of migrating — see `db.ts`.

/**
 * Bumped whenever {@link PROJECTION_DDL} changes in a way an existing database
 * would not otherwise pick up — the rows a reader would see, or the plan it
 * would get for reading them. A database stamped with a different value is
 * dropped and rebuilt from files, so there is deliberately no migration path;
 * the corollary is that a DDL change no bump accompanies reaches new workspaces
 * only, which for an index is a silent, permanent performance split.
 *
 * 4 → 5 (CONTRACT-014): the DDL is unchanged, but the *derivation* of
 * `turns.has_form` is — the contract settled the fence grammar (a CommonMark
 * subset; see `@corpus/contract`'s `schemas/form.ts`), so values computed under
 * the old regex can be stale (a form quoted inside an outer example block was
 * counted; a mid-line closer was accepted). "Alters the rows a reader would
 * see" includes how a stored value is computed, not only its column.
 *
 * 5 → 6 (SERVER-030): `events.blocked_on` — the document whose edit lock a
 * `deferred` event is waiting for (SPEC.md §7, CONTRACT-021). It is read
 * straight off the event file, so an existing projection needs nothing but the
 * rebuild this bump triggers.
 *
 * 6 → 7 (SERVER-032): `turns.form_answered` — whether the form an agent turn
 * carries has been answered yet. Derived from the thread file like everything
 * else here (`core/form.ts`'s `readThreadForms` replays the turns), so an
 * existing projection needs nothing but the rebuild this bump triggers.
 *
 * 7 → 8 (wave-3 audit FIX 12): the `turns_unanswered_form` partial index. No
 * column moves and no stored value changes — the bump is here because an index
 * only reaches a database at `CREATE`, so without it every workspace built
 * before this version would keep paying the full turn-row scan `needs=form`
 * used to force.
 *
 * 8 → 9 (SERVER-042): the semantic index's first three tables — `chunks`,
 * `chunk_search` and `chunk_embeddings` (§9.1's "Semantic index" block). New
 * tables, so an existing projection has none of them; there is, as always, no
 * migration — the stamp mismatch wipes and rebuilds, and every chunk row is
 * re-derived from the files by the same projector that writes it incrementally.
 * `chunk_embeddings` is the one table a rebuild *carries over* rather than
 * re-derives (see {@link REPOPULATED_TABLES}), and that carry-over is keyed by
 * content-addressed chunk id, so it survives this bump too — a v8 database has
 * no such table, and the copy is skipped.
 *
 * 9 → 10 (SERVER-055): no DDL change — `anchors.resolved_offset` is now computed
 * with the **whole** §6 resolution ladder instead of its exactness tier, so the
 * values a v9 database holds are a strict subset of the ones this projector
 * writes. Nothing migrates them (an offset is derived from the file), and
 * without the bump a workspace would keep reporting threads detached that the
 * reader resolves until something happened to touch each file.
 */
export const SCHEMA_VERSION = 10;

/** `meta` keys this module owns. */
export const META_SCHEMA_VERSION = "schema_version";
export const META_REBUILT_AT = "rebuilt_at";

/** The §9.1 tables, plus `file_hashes` (drift bookkeeping, not a queryable surface). */
export const PROJECTION_TABLES = [
  "documents",
  "threads",
  "anchors",
  "turns",
  "events",
  "seen",
  "jobs",
  "locks",
  "links",
  "search",
  "chunks",
  "chunk_search",
  "chunk_embeddings",
  "meta",
  "file_hashes",
] as const;

export type ProjectionTable = (typeof PROJECTION_TABLES)[number];

/**
 * Tables cleared by a full repopulation, in an order that would still be valid
 * if foreign keys were ever declared (children first). `meta` survives — it
 * carries the schema stamp the wipe decision is made from.
 *
 * **`chunk_embeddings` is deliberately absent** (sprint-021, Open Conflict 5).
 * Every other table here is re-derivable from the files in milliseconds; an
 * embedding is not — it costs a model inference, and a 40k-chunk corpus is
 * minutes of CPU. Because a chunk's id is a hash of its document, heading path
 * and content (`semantic/chunker.ts`), an embedding computed before a rebuild
 * re-attaches to the identical chunk after it: a `corpus db rebuild` on an
 * unchanged corpus therefore queues *nothing*. `corpus index rebuild` stays the
 * verb that genuinely discards them, and orphaned rows — embeddings whose chunk
 * no longer exists — are collected separately rather than by this wipe.
 */
export const REPOPULATED_TABLES = [
  "chunk_search",
  "chunks",
  "search",
  "links",
  "turns",
  "anchors",
  "threads",
  "documents",
  "file_hashes",
  "events",
  "seen",
  "jobs",
  "locks",
] as const satisfies readonly ProjectionTable[];

/**
 * `search` is a **standalone** FTS5 table rather than an external-content one:
 * the indexed text spans two source tables (document bodies and turn bodies),
 * which external content cannot express. The cost is that projectors delete a
 * document's `search` rows before reinserting — which they already do for every
 * other per-document table.
 *
 * Columns are positional for `snippet()`: 0 `ref`, 1 `kind`, 2 `doc_id`,
 * 3 `title`, 4 `body`.
 *
 * **`documents` carries five columns past §9.1's list** — `pinned`,
 * `sort_order`, `query_json`, `column_ref`, `extra_json` (CONTRACT-011,
 * SERVER-026). §9.1 enumerated the columns the queries of the day needed; §11
 * then made a board column *be* a pinned view document, and `pinned` is a
 * `GET /api/docs` filter while `order` is one of its sort keys. A filter and a
 * sort cannot be answered from the files at request time without one read per
 * row — the N+1 the collection query exists to avoid — so they are columns.
 * `query_json`, `column_ref` and `extra_json` ride along because the board
 * reads its whole column set, queries and all, from that one bounded response.
 * Every one of them is still *derived*: `db rebuild` reconstructs all five from
 * frontmatter, and nothing durable lives here. `sort_order` is spelled apart
 * from the frontmatter key because `order` is SQL.
 *
 * **`turns.has_form` is §6's form grammar, evaluated once at projection time**
 * (SERVER-029). `needs=form` has to ask "does this turn carry a form somebody
 * can answer", and that question is a regex over the info string plus a YAML
 * parse plus `FormSchema` — none of which SQLite can express. Answering it in
 * SQL meant approximating it with a substring search, and the approximation
 * disagreed with the answer route in both directions. So the projection stores
 * what `core/form.ts` — the same reader the route uses — decided about the
 * bytes, and the SQL fragment reads a column instead of re-deciding. Derived
 * like everything else here: a rebuild recomputes it from the file.
 *
 * **`turns.form_answered` is the same argument one step further** (SERVER-032).
 * §6 identifies a form by the turn carrying it, so "is anything still waiting
 * for an answer" is a question about *forms*, not about who spoke last — and
 * pairing an answer turn with the form it answers means matching the chosen
 * option against that form's options, which is the same YAML parse SQLite cannot
 * do. `NULL` for every turn that is not an agent turn carrying a form; `0`/`1`
 * for the ones that are. Two columns rather than one because `has_form` answers
 * "can this turn be answered at all" — the question the answer route asks — and
 * `form_answered` answers "has it been"; both are written in one pass from one
 * reading of the thread, so they cannot disagree.
 *
 * **`turns_unanswered_form` is partial because the answer is** (wave-3 audit
 * FIX 12). `needs=form` asks each thread "is any turn of yours an unanswered
 * agent form", and `turns_thread_idx` can only seek the thread — it carries
 * neither flag, so SQLite fetched every turn row of every open thread and tested
 * them one at a time, a cost linear in *conversation length* paid on every
 * `needs=me`. A partial index on `thread_id WHERE has_form = 1 AND
 * form_answered = 0` holds one entry per open question and nothing else: 500
 * threads × 60 turns measured 2.26 ms median before and 0.06 ms after, and it
 * costs a handful of pages because almost no turn qualifies. Its `WHERE` must
 * stay a syntactic match for `docs/needs.ts`'s conjuncts — SQLite only uses a
 * partial index whose condition the query provably implies.
 *
 * **The semantic index is three tables, not one** (SERVER-042, §9.1's "Semantic
 * index" block), and the split is what makes the spec's observable promise —
 * "saving a small change to a large document recomputes only the edited
 * sections" — measurable rather than aspirational:
 *
 * - `chunks` is *projection state*. It is deleted and reinserted wholesale with
 *   its document, exactly like `search`, because {@link projectDocument} maps a
 *   file to rows and a diffing projector would be a second implementation of
 *   that mapping. Its churn is nobody's concern.
 * - `chunk_search` is the same rows' text, chunk-granular, in FTS5 — used
 *   **only to address a hit**, never to rank one. Ranking stays the whole-
 *   document `search` table, bm25 unchanged, so Phase A's ordering, hits and
 *   snippets are byte-identical (sprint-021, Open Conflict 3). What it buys is
 *   the thing document-granular matching cannot answer: which of two
 *   byte-identical passages a query actually matched.
 * - `chunk_embeddings` is *computed state*, keyed by the content-addressed
 *   chunk id and **never touched by the document projector**. An edit three
 *   sections away rewrites every `chunks` row and leaves every embedding
 *   attached, because the untouched sections hash to the same ids. "Pending" is
 *   therefore not a flag anybody writes: it is `chunks` left-joined against
 *   this table, which is a fact about content rather than a record of what some
 *   projector remembered to mark.
 *
 * `chunks` is keyed by `(ref, ord)` rather than by `chunk_id`, because two
 * sections of one document can legitimately hold byte-identical text under the
 * same heading path and therefore share an id — one address, one embedding, two
 * positions. `ref` matches `search.ref` (`<id>` for a document or thread
 * preamble, `<id>#<ts>` for a turn) so both index structures name a passage the
 * same way.
 */
export const PROJECTION_DDL = `
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  created TEXT,
  updated TEXT,
  due TEXT,
  reviewed TEXT,
  evergreen INTEGER NOT NULL,
  body_excerpt TEXT NOT NULL,
  pinned INTEGER NOT NULL,
  sort_order REAL,
  query_json TEXT,
  column_ref TEXT,
  extra_json TEXT NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  status TEXT NOT NULL,
  agent TEXT NOT NULL,
  anchor_id TEXT,
  title TEXT NOT NULL,
  created TEXT,
  updated TEXT,
  turn_count INTEGER NOT NULL,
  last_author TEXT,
  last_ts TEXT
);

CREATE TABLE anchors (
  doc_id TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  exact_text TEXT NOT NULL,
  prefix TEXT NOT NULL,
  suffix TEXT NOT NULL,
  resolved_offset INTEGER,
  PRIMARY KEY (doc_id, anchor_id)
);

CREATE TABLE turns (
  thread_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  author TEXT NOT NULL,
  ts TEXT NOT NULL,
  body_md TEXT NOT NULL,
  has_form INTEGER NOT NULL,
  form_answered INTEGER,
  PRIMARY KEY (thread_id, ts)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created TEXT,
  payload_json TEXT NOT NULL,
  blocked_on TEXT
);

CREATE TABLE seen (
  thread_id TEXT PRIMARY KEY,
  last_seen_ts TEXT NOT NULL
);

CREATE TABLE jobs (
  event_id TEXT PRIMARY KEY,
  status TEXT,
  started TEXT,
  updated TEXT,
  last_line TEXT
);

CREATE TABLE locks (
  doc_id TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired TEXT NOT NULL,
  ttl INTEGER NOT NULL
);

CREATE TABLE links (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE file_hashes (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL
);

CREATE VIRTUAL TABLE search USING fts5(
  ref UNINDEXED,
  kind UNINDEXED,
  doc_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE chunks (
  ref TEXT NOT NULL,
  ord INTEGER NOT NULL,
  chunk_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  char_length INTEGER NOT NULL,
  PRIMARY KEY (ref, ord)
);

CREATE TABLE chunk_embeddings (
  chunk_id TEXT PRIMARY KEY,
  identity TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vec BLOB,
  state TEXT NOT NULL,
  failures INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
);

CREATE VIRTUAL TABLE chunk_search USING fts5(
  chunk_id UNINDEXED,
  ref UNINDEXED,
  doc_id UNINDEXED,
  ord UNINDEXED,
  heading_path UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX documents_type ON documents (type);
CREATE INDEX documents_status ON documents (status);
CREATE INDEX documents_updated ON documents (updated);
CREATE INDEX documents_created ON documents (created);
CREATE INDEX documents_due ON documents (due);
CREATE INDEX documents_pinned ON documents (pinned);
CREATE INDEX threads_parent_id ON threads (parent_id);
CREATE INDEX threads_last_ts ON threads (last_ts);
CREATE INDEX turns_thread_idx ON turns (thread_id, idx);
CREATE INDEX turns_unanswered_form ON turns (thread_id) WHERE has_form = 1 AND form_answered = 0;
CREATE INDEX links_to_id ON links (to_id);
CREATE INDEX anchors_doc_id ON anchors (doc_id);
CREATE INDEX events_status ON events (status);
CREATE INDEX chunks_doc_id ON chunks (doc_id);
CREATE INDEX chunks_chunk_id ON chunks (chunk_id);
`;
