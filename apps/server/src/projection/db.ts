// The projection handle: opening `.corpus/cache.db`, pinning its pragmas, and
// bootstrapping the §9.1 schema.
//
// Every projection function is **synchronous** — `better-sqlite3` is a
// synchronous binding by design — which is what lets a write path project
// inline after writing and before responding (§9.1's read-your-write
// consistency). No projector may ever become `async`.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
   * help: `createServer` hands this one object to the document routes, the job
   * service, the watcher and the queue's mirror at mount time,
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

/** A brand-new database at `path`, with the §9.1 schema and this build's stamp. */
function createProjectionFile(path: string): SqliteDatabase {
  const sqlite = new Database(path);
  applyPragmas(sqlite);
  applySchema(sqlite);
  return sqlite;
}

/**
 * Copies `chunk_embeddings` out of the projection being replaced and into the
 * one replacing it (SPEC.md §9.1; sprint-021, Open Conflict 5).
 *
 * Every other table a replacement produces is re-derived from files in
 * milliseconds. An embedding cannot be: it costs a model inference, and a
 * corpus of any size is minutes of CPU. But a chunk's id is a hash of its
 * document, heading path and content, so an embedding computed before the
 * replacement describes the identical chunk after it — which is what makes
 * §2.2 rule 1's "restores everything else synchronously and queues semantic
 * re-indexing" a cheap promise rather than an expensive one. `corpus index
 * rebuild` stays the verb that genuinely discards.
 *
 * **Both replacements of a projection go through here**, because both destroy
 * the same thing for the same reason: `corpus db rebuild`, which builds into a
 * temp database and renames it over `cache.db`, and a **schema change noticed
 * at boot** ({@link openProjectionDatabase}), which now does the same rather
 * than deleting `cache.db` where it stands. Boot is the path that matters most:
 * `db rebuild` is a thing an operator chose to run, while a schema bump is
 * something an upgrade does to a workspace unasked — and before this, a bump as
 * small as dropping a table nothing reads cost every upgrading user their whole
 * semantic index.
 *
 * A replacement always builds a *fresh* database, so the carry-over has to be
 * explicit: ATTACH the previous file, copy, DETACH — all before the rename,
 * inside the same connection that owns the replacement.
 *
 * Every reason the previous database might not yield the table is a no-op
 * rather than an error, because the replacement's job — reconstructing from
 * files — is unaffected and losing a cache is the correct cost. There may be no
 * previous database at all; it may be unreadable; it may predate the semantic
 * index (any stamp below 9); and — reachable only from the boot path, where the
 * previous database was written by a *different build* — its `chunk_embeddings`
 * may not have the columns this schema reads, which fails on the copy rather
 * than on the lookup.
 *
 * The count it returns is **logged, not reported**: `RebuildReport` is the wire
 * shape of `POST /api/db/rebuild`, and the contract does not carry this field.
 */
export function carryOverEmbeddings(
  target: SqliteDatabase,
  previousPath: string,
  logger: Logger = silentLogger,
): number {
  if (!existsSync(previousPath)) return 0;
  try {
    target.prepare("ATTACH DATABASE ? AS prev").run(previousPath);
  } catch (error) {
    logger.info("skipping embedding carry-over; previous projection unreadable", {
      path: previousPath,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
  try {
    const table = target
      .prepare("SELECT name FROM prev.sqlite_master WHERE type = 'table' AND name = ?")
      .get("chunk_embeddings");
    if (table === undefined) return 0;
    return target
      .prepare(
        `INSERT OR IGNORE INTO chunk_embeddings
           (chunk_id, identity, dim, vec, state, failures, updated_ms)
         SELECT chunk_id, identity, dim, vec, state, failures, updated_ms FROM prev.chunk_embeddings`,
      )
      .run().changes;
  } catch (error) {
    logger.info("skipping embedding carry-over; previous `chunk_embeddings` does not fit", {
      path: previousPath,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 0;
  } finally {
    target.exec("DETACH DATABASE prev");
  }
}

/**
 * Suffix of the fresh database a schema change builds *beside* the one it
 * supersedes, before renaming it into place.
 */
const SUPERSEDING_SUFFIX = ".superseding-";

/** Removes leftovers from schema changes interrupted before their rename. */
function cleanStaleSuperseding(path: string): void {
  const directory = dirname(path);
  const prefix = `${basename(path)}${SUPERSEDING_SUFFIX}`;
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(prefix)) rmSync(join(directory, name), { force: true });
  }
}

/**
 * Replaces a database this build cannot read with an empty one it can, keeping
 * what a replacement is not entitled to throw away.
 *
 * Built beside the old file and renamed over it, rather than deleting in place,
 * for one reason: {@link carryOverEmbeddings} needs the previous database to
 * still exist when the new one is ready to receive from it. The rename is also
 * the commit point — a crash before it leaves the old database untouched and
 * the operator no worse off than a retry, and a crash after it leaves a
 * complete new database — where a delete-then-create had a window in which the
 * workspace had no projection at all.
 */
function supersedeProjectionFile(path: string, logger: Logger): void {
  cleanStaleSuperseding(path);
  const staging = `${path}${SUPERSEDING_SUFFIX}${String(process.pid)}`;
  try {
    const fresh = createProjectionFile(staging);
    let carried: number;
    try {
      carried = carryOverEmbeddings(fresh, path, logger);
    } finally {
      fresh.close();
    }
    renameSync(staging, path);
    // The superseded database's WAL, now sitting beside a file it no longer
    // describes — the same sidecar sweep a rebuild's rename does.
    removeDatabaseSidecars(path);
    if (carried > 0) {
      logger.info("carried semantic embeddings across the schema change", { carried, path });
    }
  } catch (error) {
    removeDatabaseFiles(staging);
    throw error;
  }
}

/**
 * Opens the database at `path` with the §9.1 schema in place.
 *
 * A database stamped with a different {@link SCHEMA_VERSION} is **replaced and
 * repopulated, never migrated**: the projection is derived, so schema evolution
 * costs a rebuild rather than migration code. That rule is what enforces the
 * invariant behind it — nothing durable may ever live only in SQLite.
 *
 * **`chunk_embeddings` is the one thing that invariant does not cover, and it
 * is carried across** (see {@link carryOverEmbeddings}). An embedding is
 * derived from a chunk, but not in milliseconds, so "rebuildable" is not the
 * same as "cheap to lose" for it — which is why `POST /api/db/rebuild` has
 * carried them since sprint-021 and why a boot-time schema change, the
 * replacement nobody asked for, must not be the destructive one.
 *
 * An **unstamped** database is deleted rather than superseded: no build of
 * corpus has ever written one, so it is an empty file or a corrupt one, and
 * there is nothing in it to name.
 */
export function openProjectionDatabase(
  path: string,
  logger: Logger = silentLogger,
): SqliteDatabase {
  const sqlite = new Database(path);
  applyPragmas(sqlite);
  assertFts5Available(sqlite);

  const version = readSchemaVersion(sqlite);
  if (version === SCHEMA_VERSION) return sqlite;
  sqlite.close();

  if (version === null) {
    removeDatabaseFiles(path);
    return createProjectionFile(path);
  }

  logger.info("projection schema changed; rebuilding from files", {
    from: version,
    to: SCHEMA_VERSION,
    path,
  });
  supersedeProjectionFile(path, logger);
  const reopened = new Database(path);
  applyPragmas(reopened);
  return reopened;
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

/**
 * Opens an existing `cache.db` read-only — the mode `doctor` uses (§9.1, WAL
 * readers).
 *
 * **The schema stamp is checked here too, and can only be refused** (wave-3
 * audit FIX 16). {@link openProjectionDatabase} answers a stamp mismatch by
 * wiping and rebuilding; a read-only handle cannot, and it must not pretend the
 * question does not arise: `doctor` compares files against rows, and a database
 * this version's queries only *partly* fit answers that comparison with garbage
 * — a `v6` database has no `turns.form_answered` at all, yet every column
 * `checkDocuments` reads is still there, so the report came back **clean** for a
 * projection the server would have thrown away on sight. A wrong "projection is
 * clean" is worse than no answer, because it is the answer somebody acts on. So
 * the mismatch is a refusal naming the repair, in the same shape as the
 * missing-file refusal above — and the repair is the same one the server
 * performs for itself at boot.
 */
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

    const version = readSchemaVersion(sqlite);
    if (version !== SCHEMA_VERSION) {
      sqlite.close();
      throw new ProjectionError(
        `the projection at ${path} was built by a different version of corpus ` +
          `(schema ${version === null ? "unstamped" : String(version)}, this build reads ` +
          `${String(SCHEMA_VERSION)}); run \`corpus db rebuild\` to rebuild it from the ` +
          "workspace's files, or start the server, which rebuilds a stale projection at boot",
      );
    }
    return sqlite;
  };
  return createProjectionDb(open(), config, path, silentLogger, open);
}
