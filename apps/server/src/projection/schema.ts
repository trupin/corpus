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
 */
export const SCHEMA_VERSION = 1;

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
  body_excerpt TEXT NOT NULL
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
CREATE INDEX threads_parent_id ON threads (parent_id);
CREATE INDEX turns_thread_idx ON turns (thread_id, idx);
CREATE INDEX links_to_id ON links (to_id);
CREATE INDEX anchors_doc_id ON anchors (doc_id);
`;
