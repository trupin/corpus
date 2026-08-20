// The derived SQLite schema (SPEC.md §9.1). Column names and spellings are the
// spec's, verbatim — the projection is the one place files and rows have to
// agree, and a renamed column here silently breaks every reader downstream.
//
// Nothing durable lives only in this database: every table is reconstructible
// from the workspace's files (§9.1, §15 M1). That invariant is why a schema
// change replaces and repopulates instead of migrating — see `db.ts`.
//
// `chunk_embeddings` is reconstructible too, but not in milliseconds, so it is
// **carried across** a replacement rather than re-derived by it (see
// `db.ts`'s `carryOverEmbeddings`). That applies to a schema change noticed at
// boot exactly as it does to `corpus db rebuild`: a bump is something an
// upgrade does to a workspace unasked, and it must not be the more destructive
// of the two.

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
 * 5 → 6 (SERVER-030): `events.blocked_on` — the document a `deferred` event is
 * waiting on (SPEC.md §7, CONTRACT-021). It is read
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
 *
 * 10 → 11 (SERVER-055 revert): no DDL change — the ladder above was reverted to
 * its exactness tier, because rung 3 pointed threads at lookalike siblings on
 * every read path (`anchors/resolve.ts`). The bump is forward, never back to 9:
 * a v10 database holds fuzzy offsets this projector would never write, some of
 * them on a passage the anchor's author never commented on, and only a rebuild
 * clears them. A workspace that never ran v10 pays one extra rebuild.
 *
 * 11 → 12 (SERVER-068, widened by PR #28's review): no DDL change, but **two**
 * columns change verdict for bytes already on disk.
 *
 * `turns.form_answered` is now decided by pairing an answer turn with a form
 * **by content** (the contract's `parseFormAnswerBody`, against each open form)
 * instead of by the option string its first line named. A v11 database can
 * therefore hold either verdict for the same bytes, and both directions are
 * visible: a thread wrongly cleared sits out of Attention with a question nobody
 * answered, and a thread wrongly lit has no remaining action that clears it.
 *
 * `turns.has_form` changes too, and that half was missing from this note. The
 * grammar now refuses a newline inside a question or an option, and an option
 * spelled as one of the answer prose's own delimiters (`**Note:**`,
 * `_(left blank)_`, or one of this form's questions) — because such a form
 * posts, answers, and then cannot be read back, leaving an Attention row no
 * action can clear. Those forms no longer parse, so a turn that stored
 * `has_form = 1` under v11 stores `0` under v12 and renders as the broken block
 * §11 asks for. That is the intended outcome: an inert failure rather than a
 * silent, permanent one.
 *
 * Both are derived from the file like everything else here, so the rebuild this
 * bump triggers is the whole migration.
 *
 * 12 → 13 (SERVER-074): `turns.model` — which model wrote an agent turn (§6,
 * §11, CONTRACT-043). A new column, so a v12 database does not have it and no
 * value in one could be carried over; it is read straight off the thread file's
 * `turnModels` frontmatter map, so the rebuild this bump triggers is the whole
 * migration. **No backfill and no guessing**: a turn written before the record
 * existed has no entry, and the rebuild writes `NULL` for it — the same nothing
 * §11 asks a reader to show, never an attribution reconstructed after the fact.
 *
 * 13 → 14 (SERVER-099): the `locks` table is **dropped**. SPEC.md §7's key
 * replaced the per-document edit lock, and §7's own words are "nothing to
 * acquire, nothing to release, nothing to break" — so there is no state left to
 * keep. This is the one bump so far that removes rather than adds, and the
 * replacement is exactly the right migration for it: an upgrading workspace has
 * a populated `locks` table and a `.corpus/locks/` directory full of leases, and
 * the rebuild this bump triggers drops the whole table with the database it
 * lived in. A key is derived from the document and the editing signal is in
 * memory, so nothing replaces the rows.
 *
 * It is also the bump that showed the boot-time replacement to be *more*
 * destructive than `corpus db rebuild` (PR #43 review, MAJOR 2): dropping a
 * table nothing reads cost every upgrading workspace its whole semantic index,
 * because only the explicit rebuild carried `chunk_embeddings` across. Both
 * paths carry them now, so the cost of this bump is what it says it is.
 *
 * 15 → 16 (SERVER-109): `threads.resident_name` and `threads.resident_doc_id` —
 * SPEC.md §7's resident, the agent a standalone conversation belongs to
 * (SHARED-043). Two new columns, so a v15 database does not have them and no
 * value in one could be carried over; both are read straight off the thread
 * file's `resident` frontmatter, so the rebuild this bump triggers is the whole
 * migration. They are projected rather than read per row because the enqueue
 * path asks "is this root thread designated" for every event (SERVER-111), and
 * that question must cost one SQLite read rather than a file open.
 *
 * 16 → 17 (SERVER-111): `events.lane` — SPEC.md §7's lane, the agent whose work
 * an event is. It mirrors the stamp the queue writes onto the event file, which
 * is where the authority stays; the column exists so the console and the roster
 * can ask "what is on this lane" with a `WHERE` instead of reading every file in
 * five directories. A v16 database has no such column, and every value is
 * re-derivable from the files, so the rebuild this bump triggers is the whole
 * migration — an event written before lanes existed simply has no stamp, and
 * `NOT NULL DEFAULT 'orchestrator'` records the reading `queue/lanes.ts` already
 * gives it.
 *
 * 17 → 18 (SERVER-121): `threads.resident_designated` — SPEC.md §7's rider
 * SHARED-048, *"a resident need not have a profile"*. Designation and profile
 * became two independent questions, and this column is the first: **is this
 * conversation designated at all**, which is what makes it a *lane*. The
 * profile is the other question and stays where it was, in `resident_name` /
 * `resident_doc_id`, both now legitimately NULL on a designated row.
 *
 * A column rather than a reserved value in `resident_name`, deliberately: a
 * sentinel string there would reach the roster, the composer's recipient list
 * and the board badge indistinguishable from a real agent-def titled the same,
 * and `residentOrNull` would have to learn to un-say it in three readers. A v17
 * database does not have the column, and every value is re-derived from the
 * thread file's `resident` frontmatter, so the rebuild this bump triggers is the
 * whole migration — a v17 row was designated exactly when its `resident_name`
 * was set, which is what the re-projection writes.
 *
 * 18 → 19 (SERVER-129): `threads.resident_weight` — SPEC.md §7's rider signed
 * 2026-08-19, *"a resident's weight is set when it is designated, not per
 * message"*. The third independent question about a designation, after "is it a
 * lane" and "which profile": **what does it run at**. A v18 database has no such
 * column, the value is read straight off the thread file's `resident`
 * frontmatter, and a designation written before the rider has no key there — so
 * the rebuild this bump triggers is the whole migration and every carried-over
 * row correctly reads NULL, which is "no level was chosen".
 */
export const SCHEMA_VERSION = 19;

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
 * **`turns.model` is a join the board should not have to reparse a file for**
 * (SERVER-074). The record lives in the thread document's frontmatter keyed by
 * turn timestamp (§6, CONTRACT-043) — locality the file gives up on purpose —
 * and joining a map at the top of a file onto the turn it names is exactly the
 * work a projection exists to have done already. Nullable, and `NULL` is the
 * only honest value for a turn nobody recorded one for: §11 wants nothing shown
 * there, never a placeholder. Derived like every other column here, from the one
 * reader (`core/turn-model.ts`) the write path and the wire also go through.
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
  -- SPEC.md §7 scope / §9.2 provenance (SHARED-043, SERVER-110): the thread this
  -- document came from, or NULL when it came from no job. Projected rather than
  -- read per row because scope membership is computed by walking origin, and a
  -- walk that had to open files would put a read per hop on the enqueue path.
  origin TEXT,
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
  last_ts TEXT,
  -- SPEC.md §7's resident (SHARED-043, SERVER-109), in two independent
  -- questions since the SHARED-048 rider (SERVER-121).
  --
  -- Is this conversation designated -- i.e. is it a lane. 1 for every
  -- designated standalone thread, whether or not a profile was named; 0 for the
  -- threads nobody designated, which is nearly all of them, and for a thread
  -- with a parent whatever its frontmatter says. This is the column
  -- isDesignatedRoot and the scope walk ask, and it is the only one they ask:
  -- "is a lane" and "has a profile" are separate facts, and asking the second
  -- to answer the first is what made a general residency unrepresentable.
  resident_designated INTEGER NOT NULL DEFAULT 0,
  -- Which profile it was designated with, as the file spells it -- NULL for a
  -- general resident, which named none. Both halves, because they answer
  -- different questions: the name is what a person reads and what survives its
  -- agent-def being deleted, the id is what a reader opens. Never set while
  -- resident_designated is 0, and never authoritative about whether a lane
  -- exists.
  resident_name TEXT,
  resident_doc_id TEXT,
  -- What weight it was designated at (SERVER-129, SPEC.md §7's rider signed
  -- 2026-08-19), verbatim from the file -- NULL when the designation chose no
  -- level, which means the launcher decides. A third independent question:
  -- orthogonal to the profile pair, so a general resident may run at a stated
  -- weight and a profiled one at none. Projected for the reason the pair above
  -- is: GET /api/agents builds a row per lane from these columns and must not
  -- open a file per lane to answer what a designation says. Never interpreted
  -- here -- the tier table is the workspace's own skill text.
  resident_weight TEXT
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
  model TEXT,
  PRIMARY KEY (thread_id, ts)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created TEXT,
  payload_json TEXT NOT NULL,
  blocked_on TEXT,
  -- SPEC.md §7's lane (SHARED-043, SERVER-111): whose work this event is —
  -- the orchestrator's, or the id of a designated root thread. A mirror of the
  -- stamp on the event file, which stays authoritative; this column is here so a
  -- reader can filter by lane in SQL rather than by reading five directories.
  -- NOT NULL because the orchestrator's lane is a lane like any other and has a
  -- name: an event file with no stamp reads as the orchestrator's, and the
  -- default writes that reading down rather than inventing a second spelling.
  lane TEXT NOT NULL DEFAULT 'orchestrator'
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
