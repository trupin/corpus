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
  /**
   * Closes the connection, runs `replaceFile`, then opens a fresh one at the
   * same path — **without replacing this object**.
   *
   * This is the seam `POST /api/db/rebuild` needs. A rebuild commits by renaming
   * a new database over `cache.db`, so every connection open at that moment is
   * left bound to an inode the rename unlinked. Opening a *new* handle would not
   * help: `createServer` hands this one object to the document routes, the lock
   * service, the job service, the watcher and the queue's mirror at mount time,
   * and a second object would leave all of them reading a file that no longer
   * has a name. So the object stays and the connection under it moves.
   *
   * The connection is closed *before* `replaceFile` rather than after, because
   * a rebuild also deletes the destination's `-wal`/`-shm` sidecars: a
   * still-open connection would keep a deleted WAL alive and could recreate it,
   * by path, over the database that just replaced it. Everything here is
   * synchronous, so no request can observe the gap.
   *
   * `replaceFile` throwing still reopens — the rename is the rebuild's commit
   * point, so a failure leaves the previous database intact and reopenable.
   */
  reopenAround<T>(replaceFile: () => T): T;
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

/**
 * Wraps a raw connection in the caching handle every projector takes.
 *
 * `reopen` says how to get a *replacement* connection for the same path; it is a
 * parameter rather than a constant because the read-only handle `doctor` uses
 * must not come back read-write. It is never called for the throwaway handles a
 * rebuild opens over its temp file.
 */
export function createProjectionDb(
  sqlite: SqliteDatabase,
  config: ProjectionConfig,
  path: string,
  logger: Logger = silentLogger,
  reopen: () => SqliteDatabase = () => openProjectionDatabase(path, logger),
): ProjectionDb {
  const statements = new Map<string, SqliteStatement>();
  // Mutable, and read through a getter, so a subsystem that captured this handle
  // follows a reopen instead of holding the closed connection.
  let connection = sqlite;

  const closeConnection = (): void => {
    statements.clear();
    if (connection.open) connection.close();
  };

  return {
    get sqlite() {
      return connection;
    },
    config,
    path,
    logger,
    prepare(sql) {
      const cached = statements.get(sql);
      if (cached !== undefined) return cached;
      const statement = connection.prepare(sql);
      statements.set(sql, statement);
      return statement;
    },
    transaction(fn) {
      return connection.transaction(fn);
    },
    reopenAround(replaceFile) {
      closeConnection();
      try {
        return replaceFile();
      } finally {
        connection = reopen();
      }
    },
    close: closeConnection,
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
  const open = (): SqliteDatabase => {
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
    return sqlite;
  };
  return createProjectionDb(open(), config, path, silentLogger, open);
}
