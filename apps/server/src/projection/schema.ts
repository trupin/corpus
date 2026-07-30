// The derived SQLite schema (SPEC.md §9.1). Column names and spellings are the
// spec's, verbatim — the projection is the one place files and rows have to
// agree, and a renamed column here silently breaks every reader downstream.
//
// Nothing durable lives only in this database: every table is reconstructible
// from the workspace's files (§9.1, §15 M1). That invariant is why a schema
// change wipes and rebuilds instead of migrating — see `db.ts`.

/**
 * Bumped whenever {@link PROJECTION_DDL} changes in any way that alters the
 * rows a reader would see. A database stamped with a different value is dropped
 * and rebuilt from files, so there is deliberately no migration path.
 *
 * 4 → 5 (CONTRACT-014): the DDL is unchanged, but the *derivation* of
 * `turns.has_form` is — the contract settled the fence grammar (a CommonMark
 * subset; see `@corpus/contract`'s `schemas/form.ts`), so values computed under
 * the old regex can be stale (a form quoted inside an outer example block was
 * counted; a mid-line closer was accepted). "Alters the rows a reader would
 * see" includes how a stored value is computed, not only its column.
 */
export const SCHEMA_VERSION = 5;

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
  "meta",
  "file_hashes",
] as const;

export type ProjectionTable = (typeof PROJECTION_TABLES)[number];

/**
 * Tables cleared by a full repopulation, in an order that would still be valid
 * if foreign keys were ever declared (children first). `meta` survives — it
 * carries the schema stamp the wipe decision is made from.
 */
export const REPOPULATED_TABLES = [
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
  PRIMARY KEY (thread_id, ts)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  created TEXT,
  payload_json TEXT NOT NULL
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

CREATE INDEX documents_type ON documents (type);
CREATE INDEX documents_status ON documents (status);
CREATE INDEX documents_updated ON documents (updated);
CREATE INDEX documents_created ON documents (created);
CREATE INDEX documents_due ON documents (due);
CREATE INDEX documents_pinned ON documents (pinned);
CREATE INDEX threads_parent_id ON threads (parent_id);
CREATE INDEX threads_last_ts ON threads (last_ts);
CREATE INDEX turns_thread_idx ON turns (thread_id, idx);
CREATE INDEX links_to_id ON links (to_id);
CREATE INDEX anchors_doc_id ON anchors (doc_id);
CREATE INDEX events_status ON events (status);
`;
