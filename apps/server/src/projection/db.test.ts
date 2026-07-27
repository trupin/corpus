import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  turns: ["thread_id", "idx", "author", "ts", "body_md"],
  events: ["id", "type", "status", "created", "payload_json"],
  seen: ["thread_id", "last_seen_ts"],
  jobs: ["event_id", "status", "started", "updated", "last_line"],
  locks: ["doc_id", "holder", "acquired", "ttl"],
  links: ["from_id", "to_id"],
  meta: ["key", "value"],
  file_hashes: ["path", "hash", "size", "mtime_ms"],
};

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
      // FTS5's own shadow tables are the only extras the projection creates.
      const unexpected = tables.filter(
        (name) => !PROJECTION_TABLES.includes(name as never) && !name.startsWith("search_"),
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
