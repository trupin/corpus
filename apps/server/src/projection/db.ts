// The projection handle: opening `.corpus/cache.db`, pinning its pragmas, and
// bootstrapping the §9.1 schema.
//
// Every projection function is **synchronous** — `better-sqlite3` is a
// synchronous binding by design — which is what lets a write path project
// inline after writing and before responding (§9.1's read-your-write
// consistency). No projector may ever become `async`.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CorpusError } from "../errors.js";
import { silentLogger, type Logger } from "../logger.js";
import { populateFromFiles } from "./populate.js";
import { META_SCHEMA_VERSION, PROJECTION_DDL, SCHEMA_VERSION } from "./schema.js";

export type SqliteDatabase = Database.Database;
export type SqliteStatement = Database.Statement;

/** How long a writer waits on a locked database before giving up. */
export const BUSY_TIMEOUT_MS = 5000;

export class ProjectionError extends CorpusError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectionError";
  }
}

/** Everything the projection needs from the server config; `ServerConfig` satisfies it. */
export interface ProjectionConfig {
  readonly workspaceRoot: string;
  readonly corpusDir: string;
}

export const CACHE_DB_FILE = "cache.db";

export function cacheDbPath(config: ProjectionConfig): string {
  return join(config.corpusDir, CACHE_DB_FILE);
}

/**
 * An open projection. `prepare` memoizes on the handle: the incremental
 * projectors run the same dozen statements per file, and re-preparing them per
 * document is most of the cost of a rebuild.
 */
export interface ProjectionDb {
  readonly sqlite: SqliteDatabase;
  readonly config: ProjectionConfig;
  readonly path: string;
  readonly logger: Logger;
  prepare(sql: string): SqliteStatement;
  /** Runs `fn` inside a transaction, nesting safely via savepoints. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  close(): void;
}

/**
 * FTS5 is not optional: search over titles, bodies and turn bodies is a §9.1
 * table, and a projection that quietly opened without it would look healthy
 * while every query returned nothing. Probed by building a throwaway virtual
 * table, because `pragma_compile_options` is not reported by every build.
 */
export function assertFts5Available(sqlite: Pick<SqliteDatabase, "exec">): void {
  try {
    sqlite.exec("CREATE VIRTUAL TABLE temp.corpus_fts5_probe USING fts5(probe)");
    sqlite.exec("DROP TABLE temp.corpus_fts5_probe");
  } catch (cause) {
    throw new ProjectionError(
      "this build of better-sqlite3 has no fts5 module; corpus needs fts5 for the `search` table " +
        "(reinstall better-sqlite3, or rebuild it against a SQLite with -DSQLITE_ENABLE_FTS5)",
      { cause },
    );
  }
}

function applyPragmas(sqlite: SqliteDatabase): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
}

function readSchemaVersion(sqlite: SqliteDatabase): number | null {
  try {
    const row = sqlite.prepare("SELECT value FROM meta WHERE key = ?").get(META_SCHEMA_VERSION);
    if (row === undefined || typeof row !== "object") return null;
    const value = (row as { value?: unknown }).value;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    // No `meta` table at all — a database this version has never written.
    return null;
  }
}

/**
 * Removes the `-wal`/`-shm` sidecars of a database. After a rename replaces
 * `cache.db`, the previous database's WAL would otherwise sit next to a file it
 * no longer describes — SQLite would try to recover it into the new one.
 */
export function removeDatabaseSidecars(path: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

/** Removes a database and its WAL sidecars, so the next open starts from nothing. */
export function removeDatabaseFiles(path: string): void {
  rmSync(path, { force: true });
  removeDatabaseSidecars(path);
}

function applySchema(sqlite: SqliteDatabase): void {
  sqlite.exec(PROJECTION_DDL);
  sqlite
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?)")
    .run(META_SCHEMA_VERSION, String(SCHEMA_VERSION));
}

/**
 * Opens the database at `path` with the §9.1 schema in place.
 *
 * A database stamped with a different {@link SCHEMA_VERSION} is **wiped and
 * rebuilt, never migrated**: the projection is derived, so schema evolution
 * costs a rebuild rather than migration code. That rule is what enforces the
 * invariant behind it — nothing durable may ever live only in SQLite.
 */
export function openProjectionDatabase(
  path: string,
  logger: Logger = silentLogger,
): SqliteDatabase {
  let sqlite = new Database(path);
  applyPragmas(sqlite);
  assertFts5Available(sqlite);

  const version = readSchemaVersion(sqlite);
  if (version === SCHEMA_VERSION) return sqlite;

  if (version !== null) {
    logger.info("projection schema changed; rebuilding from files", {
      from: version,
      to: SCHEMA_VERSION,
      path,
    });
  }
  sqlite.close();
  removeDatabaseFiles(path);
  sqlite = new Database(path);
  applyPragmas(sqlite);
  applySchema(sqlite);
  return sqlite;
}

/** Wraps a raw connection in the caching handle every projector takes. */
export function createProjectionDb(
  sqlite: SqliteDatabase,
  config: ProjectionConfig,
  path: string,
  logger: Logger = silentLogger,
): ProjectionDb {
  const statements = new Map<string, SqliteStatement>();
  return {
    sqlite,
    config,
    path,
    logger,
    prepare(sql) {
      const cached = statements.get(sql);
      if (cached !== undefined) return cached;
      const statement = sqlite.prepare(sql);
      statements.set(sql, statement);
      return statement;
    },
    transaction(fn) {
      return sqlite.transaction(fn);
    },
    close() {
      statements.clear();
      if (sqlite.open) sqlite.close();
    },
  };
}

export interface OpenProjectionOptions {
  readonly logger?: Logger;
  /**
   * Re-derive every row from the workspace's files before returning. On by
   * default: a boot that trusted a stale `cache.db` would serve rows for files
   * edited while the server was down.
   */
  readonly populate?: boolean;
}

/**
 * Opens `<corpusDir>/cache.db`, bootstrapping the schema and repopulating from
 * files. Callers register {@link ProjectionDb.close} as a server disposer so the
 * handle goes away with the process.
 *
 * Populating is deliberately in-place rather than a temp-file rebuild: a running
 * server must never have `cache.db` swapped out from under its open handle.
 */
export function openProjection(
  config: ProjectionConfig,
  options: OpenProjectionOptions = {},
): ProjectionDb {
  const logger = options.logger ?? silentLogger;
  mkdirSync(config.corpusDir, { recursive: true });
  const path = cacheDbPath(config);
  const sqlite = openProjectionDatabase(path, logger);
  const db = createProjectionDb(sqlite, config, path, logger);
  if (options.populate !== false) populateFromFiles(db);
  return db;
}

/** Opens an existing `cache.db` read-only — the mode `doctor` uses (§9.1, WAL readers). */
export function openProjectionReadonly(config: ProjectionConfig): ProjectionDb {
  const path = cacheDbPath(config);
  let sqlite: SqliteDatabase;
  try {
    sqlite = new Database(path, { readonly: true, fileMustExist: true });
  } catch (cause) {
    throw new ProjectionError(
      `no projection at ${path}; run \`corpus db rebuild\` to build it from the workspace's files`,
      { cause },
    );
  }
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return createProjectionDb(sqlite, config, path);
}
