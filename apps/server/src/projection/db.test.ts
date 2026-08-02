import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUSY_TIMEOUT_MS,
  ProjectionError,
  assertFts5Available,
  cacheDbPath,
  openProjection,
  openProjectionDatabase,
  openProjectionReadonly,
  removeDatabaseFiles,
  type ProjectionConfig,
} from "./db.js";
import { META_SCHEMA_VERSION, PROJECTION_TABLES, SCHEMA_VERSION } from "./schema.js";

/**
 * §9.1's column lists, retyped from the spec rather than imported from the DDL:
 * a test that read the same constant the code did would only prove the code
 * agrees with itself.
 *
 * `documents` carries five columns past §9.1's list, retyped from CONTRACT-011
 * for the same reason: §11 makes a board column a pinned view document, so
 * `pinned` is a `GET /api/docs` filter and `order` one of its sorts, and the
 * board reads every view's `query`, `column` and plugin keys off the same
 * bounded response rather than one follow-up read per column.
 */
const SPEC_COLUMNS: Record<string, readonly string[]> = {
  documents: [
    "id",
    "type",
    "title",
    "path",
    "status",
    "tags_json",
    "created",
    "updated",
    "due",
    "reviewed",
    "evergreen",
    "body_excerpt",
    "pinned",
    "sort_order",
    "query_json",
    "column_ref",
    "extra_json",
  ],
  threads: [
    "id",
    "parent_id",
    "status",
    "agent",
    "anchor_id",
    "title",
    "created",
    "updated",
    "turn_count",
    "last_author",
    "last_ts",
  ],
  anchors: ["doc_id", "anchor_id", "exact_text", "prefix", "suffix", "resolved_offset"],
  // `has_form` and `form_answered` are past §9.1's list, retyped from
  // SERVER-029 and SERVER-032: §6's form grammar is a regex plus a YAML parse
  // and an answer is paired with its form by the options that parse yields, so
  // `needs=form` cannot ask either question in SQL and reads columns the
  // projector filled instead.
  turns: ["thread_id", "idx", "author", "ts", "body_md", "has_form", "form_answered"],
  events: ["id", "type", "status", "created", "payload_json", "blocked_on"],
  seen: ["thread_id", "last_seen_ts"],
  jobs: ["event_id", "status", "started", "updated", "last_line"],
  locks: ["doc_id", "holder", "acquired", "ttl"],
  links: ["from_id", "to_id"],
  // §9.1's "semantic index" bullet, in three tables (SERVER-042): the chunks a
  // document splits into, their chunk-granular FTS copy — used to address a
  // hit, never to rank one — and the embeddings, keyed by content-addressed
  // chunk id so they outlive the document projector and a `db rebuild` alike.
  chunks: [
    "ref",
    "ord",
    "chunk_id",
    "doc_id",
    "kind",
    "heading_path",
    "start_offset",
    "end_offset",
    "char_length",
  ],
  chunk_embeddings: ["chunk_id", "identity", "dim", "vec", "state", "failures", "updated_ms"],
  meta: ["key", "value"],
  file_hashes: ["path", "hash", "size", "mtime_ms"],
};

/** Virtual tables, whose FTS5 shadow tables are the only extras the schema creates. */
const FTS_TABLES = ["search", "chunk_search"] as const;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s004-db-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeConfig(): ProjectionConfig {
  const workspaceRoot = join(root, "ws");
  mkdirSync(join(workspaceRoot, "data", "docs"), { recursive: true });
  return { workspaceRoot, corpusDir: join(workspaceRoot, ".corpus") };
}

const writeDoc = (config: ProjectionConfig, id: string): void => {
  writeFileSync(
    join(config.workspaceRoot, "data", "docs", `${id}.md`),
    `---\nid: ${id}\ntype: note\ntitle: T\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\nBody.\n`,
    "utf8",
  );
};

/**
 * The DDL a **version 6** build wrote, frozen here character for character
 * (wave-3 audit TEST 18). It is deliberately a literal and not `PROJECTION_DDL`
 * with a line taken out: the point of the fixture is a database this build has
 * never touched, and one derived from today's constant would follow every future
 * change and stop being one. `turns` has no `form_answered`; `events` already
 * has `blocked_on` (that was 5 → 6). Never edit it — a v6 database is a fact
 * about the past.
 */
const V6_DDL = `
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
  payload_json TEXT NOT NULL,
  blocked_on TEXT
);
CREATE TABLE seen (thread_id TEXT PRIMARY KEY, last_seen_ts TEXT NOT NULL);
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
CREATE TABLE links (from_id TEXT NOT NULL, to_id TEXT NOT NULL, PRIMARY KEY (from_id, to_id));
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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

/** A thread whose agent turn carries one unanswered form, on disk. */
const writeFormThread = (config: ProjectionConfig, id: string): void => {
  mkdirSync(join(config.workspaceRoot, "data", "threads"), { recursive: true });
  writeFileSync(
    join(config.workspaceRoot, "data", "threads", `${id}.md`),
    `---\nid: ${id}\ntype: thread\ntitle: Deep\nstatus: open\n---\n\nPreamble.\n\n` +
      "## user · 2026-07-03T09:00:00Z\n\nWhich option?\n\n" +
      "## agent · 2026-07-03T09:01:00Z\n\nHere you go.\n\n" +
      '```form\nprompt: Pick one\noptions:\n  - "a"\n  - "b"\n```\n',
    "utf8",
  );
};

/** Builds a genuine v6 `cache.db` at `config`'s path, with a row in it. */
function writeV6Database(config: ProjectionConfig): void {
  mkdirSync(config.corpusDir, { recursive: true });
  const sqlite = new Database(cacheDbPath(config));
  sqlite.exec(V6_DDL);
  sqlite.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(META_SCHEMA_VERSION, "6");
  // A row a v6 build would have written: the document exists on disk too, so a
  // rebuild that did nothing would look identical to a rebuild that worked.
  sqlite
    .prepare(
      `INSERT INTO documents (id, type, title, path, status, tags_json, created, updated, due,
        reviewed, evergreen, body_excerpt, pinned, sort_order, query_json, column_ref, extra_json)
       VALUES ('doc_v6', 'note', 'stale title', 'data/docs/doc_v6.md', 'open', '[]',
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, NULL, 0, 'Body.', 0, NULL, NULL,
        NULL, '{}')`,
    )
    .run();
  sqlite.close();
}

describe("openProjection", () => {
  it("creates cache.db with exactly the §9.1 tables and columns", () => {
    const config = makeConfig();
    const db = openProjection(config);
    try {
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
          .all() as { name: string }[]
      ).map((row) => row.name);

      for (const table of PROJECTION_TABLES) expect(tables).toContain(table);
      // FTS5's own shadow tables are the only extras the projection creates —
      // one set per virtual table, so the prefixes track the declared ones.
      const shadowPrefixes = FTS_TABLES.map((table) => `${table}_`);
      const unexpected = tables.filter(
        (name) =>
          !PROJECTION_TABLES.includes(name as never) &&
          !shadowPrefixes.some((prefix) => name.startsWith(prefix)),
      );
      expect(unexpected).toEqual([]);

      for (const [table, columns] of Object.entries(SPEC_COLUMNS)) {
        const actual = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
          (row) => row.name,
        );
        expect(actual, `${table} columns`).toEqual([...columns]);
      }

      const searchColumns = (
        db.prepare("PRAGMA table_info(search)").all() as { name: string }[]
      ).map((row) => row.name);
      expect(searchColumns).toEqual(["ref", "kind", "doc_id", "title", "body"]);

      const chunkSearchColumns = (
        db.prepare("PRAGMA table_info(chunk_search)").all() as { name: string }[]
      ).map((row) => row.name);
      expect(chunkSearchColumns).toEqual([
        "chunk_id",
        "ref",
        "doc_id",
        "ord",
        "heading_path",
        "body",
      ]);
    } finally {
      db.close();
    }
  });

  it("opens with the pragmas the design pins", () => {
    const db = openProjection(makeConfig());
    try {
      expect(db.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(db.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(db.sqlite.pragma("busy_timeout", { simple: true })).toBe(BUSY_TIMEOUT_MS);
    } finally {
      db.close();
    }
  });

  it("stamps the schema version and the file lands where cacheDbPath says", () => {
    const config = makeConfig();
    const db = openProjection(config);
    try {
      expect(db.path).toBe(cacheDbPath(config));
      expect(existsSync(cacheDbPath(config))).toBe(true);
      expect(
        (
          db.prepare("SELECT value FROM meta WHERE key = ?").get(META_SCHEMA_VERSION) as {
            value: string;
          }
        ).value,
      ).toBe(String(SCHEMA_VERSION));
    } finally {
      db.close();
    }
  });

  it("wipes and rebuilds from files when the stamped schema version differs", () => {
    const config = makeConfig();
    writeDoc(config, "doc_aaa");

    const first = openProjection(config);
    expect(first.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 1 });
    // A table this version does not know about proves the wipe is a wipe: a
    // migration would have left it standing.
    first.sqlite.exec("CREATE TABLE legacy_leftover (x TEXT)");
    first.prepare("UPDATE meta SET value = ? WHERE key = ?").run("0", META_SCHEMA_VERSION);
    first.close();

    const second = openProjection(config);
    try {
      expect(
        (
          second.prepare("SELECT value FROM meta WHERE key = ?").get(META_SCHEMA_VERSION) as {
            value: string;
          }
        ).value,
      ).toBe(String(SCHEMA_VERSION));
      expect(
        second.prepare("SELECT name FROM sqlite_master WHERE name = 'legacy_leftover'").get(),
      ).toBeUndefined();
      expect(second.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_aaa" }]);
    } finally {
      second.close();
    }
  });

  // Wave-3 audit TEST 18. The test above proves the *stamp* is honoured by
  // rewriting it; this one takes a database whose DDL is genuinely older — no
  // `turns.form_answered` column at all — which is the situation a user upgrading
  // the tool is actually in, and the one every "nothing durable lives only in
  // SQLite" claim is cashed against.
  it("rebuilds a database whose DDL predates this version, filling the new columns from files", () => {
    const config = makeConfig();
    writeV6Database(config);
    writeDoc(config, "doc_v6");
    writeFormThread(config, "th_v6form");

    const before = new Database(cacheDbPath(config), { readonly: true });
    expect(
      (before.prepare("PRAGMA table_info(turns)").all() as { name: string }[]).map((r) => r.name),
    ).toEqual(["thread_id", "idx", "author", "ts", "body_md", "has_form"]);
    before.close();

    const db = openProjection(config);
    try {
      expect(
        (
          db.prepare("SELECT value FROM meta WHERE key = ?").get(META_SCHEMA_VERSION) as {
            value: string;
          }
        ).value,
      ).toBe(String(SCHEMA_VERSION));
      // The column exists and carries what the *file* says, not what the old
      // database did — the v6 row's title was a lie the rebuild had to drop.
      expect(db.prepare("SELECT title FROM documents WHERE id = 'doc_v6'").get()).toEqual({
        title: "T",
      });
      expect(
        db.prepare("SELECT author, has_form, form_answered FROM turns ORDER BY idx").all(),
      ).toEqual([
        { author: "user", has_form: 0, form_answered: null },
        { author: "agent", has_form: 1, form_answered: 0 },
      ]);
      // And the index that arrived with this version is there too, which is the
      // whole reason the bump accompanies it (FIX 12).
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get("turns_unanswered_form"),
      ).toEqual({ name: "turns_unanswered_form" });
    } finally {
      db.close();
    }
  });

  it("repopulates on every open, so files edited while the server was down are picked up", () => {
    const config = makeConfig();
    const first = openProjection(config);
    expect(first.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
    first.close();

    writeDoc(config, "doc_late");
    const second = openProjection(config);
    try {
      expect(second.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_late" }]);
    } finally {
      second.close();
    }
  });

  it("can be opened without populating", () => {
    const config = makeConfig();
    writeDoc(config, "doc_aaa");
    const db = openProjection(config, { populate: false });
    try {
      expect(db.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("caches prepared statements per SQL text", () => {
    const db = openProjection(makeConfig());
    try {
      expect(db.prepare("SELECT 1")).toBe(db.prepare("SELECT 1"));
      expect(db.prepare("SELECT 1")).not.toBe(db.prepare("SELECT 2"));
    } finally {
      db.close();
    }
  });

  it("closes idempotently", () => {
    const db = openProjection(makeConfig());
    db.close();
    expect(() => {
      db.close();
    }).not.toThrow();
    expect(db.sqlite.open).toBe(false);
  });
});

describe("assertFts5Available", () => {
  it("passes on a build that has fts5", () => {
    const db = openProjection(makeConfig());
    try {
      expect(() => {
        assertFts5Available(db.sqlite);
      }).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("fails loudly, naming fts5, when the module is missing", () => {
    const withoutFts5 = {
      exec: () => {
        throw new Error("no such module: fts5");
      },
    };
    expect(() => {
      assertFts5Available(withoutFts5);
    }).toThrow(ProjectionError);
    expect(() => {
      assertFts5Available(withoutFts5);
    }).toThrow(/fts5/);
  });
});

describe("openProjectionReadonly", () => {
  it("reads an existing database without writing to it", () => {
    const config = makeConfig();
    writeDoc(config, "doc_aaa");
    openProjection(config).close();

    const db = openProjectionReadonly(config);
    try {
      expect(db.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_aaa" }]);
      expect(() => db.sqlite.exec("DELETE FROM documents")).toThrow();
    } finally {
      db.close();
    }
  });

  it("says what to run when there is no projection yet", () => {
    const config = makeConfig();
    mkdirSync(config.corpusDir, { recursive: true });
    expect(() => openProjectionReadonly(config)).toThrow(ProjectionError);
    expect(() => openProjectionReadonly(config)).toThrow(/corpus db rebuild/);
  });

  // Wave-3 audit FIX 16. `doctor` is the surface that says "the projection is
  // clean", and it opened a database of any vintage without asking: a v6
  // database still has every column `checkDocuments` reads, so it reported
  // clean for a projection the server would have wiped on sight. A read-only
  // handle cannot repair, so refusing is the only honest answer it has.
  it("refuses a database this build does not read, and names the repair", () => {
    const config = makeConfig();
    writeV6Database(config);
    writeDoc(config, "doc_v6");

    expect(() => openProjectionReadonly(config)).toThrow(ProjectionError);
    expect(() => openProjectionReadonly(config)).toThrow(/schema 6, this build reads/);
    expect(() => openProjectionReadonly(config)).toThrow(/corpus db rebuild/);

    // And the repair works: the server's own open rebuilds, after which the
    // read-only handle opens the same path without complaint.
    openProjection(config).close();
    const db = openProjectionReadonly(config);
    try {
      expect(db.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_v6" }]);
    } finally {
      db.close();
    }
  });

  it("refuses a database with no stamp at all", () => {
    const config = makeConfig();
    mkdirSync(config.corpusDir, { recursive: true });
    const sqlite = new Database(cacheDbPath(config));
    sqlite.exec("CREATE TABLE something_else (x TEXT)");
    sqlite.close();

    expect(() => openProjectionReadonly(config)).toThrow(/unstamped/);
  });
});

describe("ProjectionDb.reopenAround", () => {
  it("moves the connection under the handle, so a captured reference follows", () => {
    const config = makeConfig();
    writeDoc(config, "doc_aaa");
    const db = openProjection(config);
    // What every subsystem holds: the handle object, captured at mount time.
    const captured = db;
    try {
      const before = statSync(db.path).ino;

      db.reopenAround(() => {
        // Stands in for a rebuild's commit: a different database, renamed over
        // the path this handle was opened on.
        const replacement = join(root, "replacement.db");
        removeDatabaseFiles(replacement);
        openProjectionDatabase(replacement).close();
        renameSync(replacement, db.path);
      });

      expect(statSync(db.path).ino).not.toBe(before);
      expect(captured.prepare("SELECT id FROM documents").all()).toEqual([]);
      expect(captured.sqlite.open).toBe(true);
    } finally {
      db.close();
    }
  });

  it("clears the statement cache, which is bound to the closed connection", () => {
    const config = makeConfig();
    writeDoc(config, "doc_aaa");
    const db = openProjection(config);
    try {
      const first = db.prepare("SELECT id FROM documents");
      db.reopenAround(() => undefined);
      const second = db.prepare("SELECT id FROM documents");
      expect(second).not.toBe(first);
      expect(second.all()).toEqual([{ id: "doc_aaa" }]);
    } finally {
      db.close();
    }
  });

  it("reopens even when the replacement throws, because the old file is still there", () => {
    const config = makeConfig();
    writeDoc(config, "doc_aaa");
    const db = openProjection(config);
    try {
      expect(() =>
        db.reopenAround(() => {
          throw new Error("rebuild blew up before its rename");
        }),
      ).toThrow(/blew up/);
      expect(db.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_aaa" }]);
    } finally {
      db.close();
    }
  });

  it("keeps a read-only handle read-only across a reopen", () => {
    const config = makeConfig();
    writeDoc(config, "doc_aaa");
    openProjection(config).close();

    const db = openProjectionReadonly(config);
    try {
      db.reopenAround(() => undefined);
      expect(db.prepare("SELECT id FROM documents").all()).toEqual([{ id: "doc_aaa" }]);
      expect(() => db.sqlite.exec("DELETE FROM documents")).toThrow();
    } finally {
      db.close();
    }
  });
});

describe("openProjectionDatabase", () => {
  it("applies the schema to a brand-new file", () => {
    mkdirSync(join(root, "bare"), { recursive: true });
    const path = join(root, "bare", "x.db");
    const sqlite = openProjectionDatabase(path);
    try {
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 0 });
    } finally {
      sqlite.close();
    }
  });
});

describe("removeDatabaseFiles", () => {
  it("removes the database and its WAL sidecars", () => {
    const config = makeConfig();
    const db = openProjection(config);
    const path = db.path;
    db.close();
    // Written after the close: SQLite mmaps `-shm` while a connection is open,
    // and truncating it under a live handle takes the process down with it.
    writeFileSync(`${path}-wal`, "", "utf8");
    writeFileSync(`${path}-shm`, "", "utf8");

    removeDatabaseFiles(path);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });
});
