// Full rebuild: a brand-new database built from the workspace's files alone,
// then swapped in atomically (SPEC.md §9.1, §15 M1).
//
// The rename is the commit point. An interrupted rebuild therefore leaves the
// previous `cache.db` intact and a leftover temp file, never a half-written
// database — and the next rebuild cleans the leftovers.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { silentLogger, type Logger } from "../logger.js";
import {
  cacheDbPath,
  createProjectionDb,
  openProjectionDatabase,
  removeDatabaseFiles,
  removeDatabaseSidecars,
  CACHE_DB_FILE,
  type ProjectionConfig,
  type ProjectionDb,
} from "./db.js";
import { populateFromFiles, type PopulateReport } from "./populate.js";
import { META_REBUILT_AT } from "./schema.js";

/** Prefix of the temp database a rebuild builds into before renaming it over `cache.db`. */
export const REBUILD_PREFIX = `${CACHE_DB_FILE}.rebuild-`;

export interface RebuildOptions {
  /**
   * Build here and leave it here instead of replacing `cache.db`. This is the
   * mode the pre-push check uses to prove the projection is reconstructible
   * from files alone (§14) without disturbing a running workspace.
   */
  readonly into?: string;
  readonly logger?: Logger;
}

export type RebuildReport = PopulateReport & {
  /** Where the rebuilt database ended up. */
  readonly path: string;
};

/**
 * Copies `chunk_embeddings` out of the projection being replaced and into the
 * one replacing it (SPEC.md §9.1; sprint-021, Open Conflict 5).
 *
 * Every other table a rebuild produces is re-derived from files in
 * milliseconds. An embedding cannot be: it costs a model inference, and a
 * corpus of any size is minutes of CPU. But a chunk's id is a hash of its
 * document, heading path and content, so an embedding computed before the
 * rebuild describes the identical chunk after it — `corpus db rebuild` on an
 * unchanged corpus therefore queues nothing, which is what makes §2.2 rule 1's
 * "restores everything else synchronously and queues semantic re-indexing" a
 * cheap promise rather than an expensive one. `corpus index rebuild` stays the
 * verb that genuinely discards.
 *
 * A rebuild builds into a fresh temp database and commits by renaming it over
 * `cache.db`, so the temp database starts empty and the carry-over has to be
 * explicit: ATTACH the previous file, copy, DETACH — all before the rename,
 * inside the same connection that just wrote the rest.
 *
 * Every reason the previous database might not have the table is a no-op rather
 * than an error: there may be no previous database at all (a first rebuild), it
 * may predate the semantic index (any stamp below 9 — this is exactly the
 * schema bump that introduced it), or it may be unreadable, in which case the
 * rebuild's job — reconstructing from files — is unaffected and losing a cache
 * is the correct cost.
 *
 * The count it returns is **logged, not reported**: {@link RebuildReport} is the
 * wire shape of `POST /api/db/rebuild`, and the contract does not carry this
 * field. It is also copied in `into` mode, where the previous database is not
 * being replaced — the source is always the live `cache.db`, and carrying a
 * cache into a database built beside it costs nothing and keeps one behaviour
 * rather than two.
 */
function carryOverEmbeddings(db: ProjectionDb, previousPath: string): number {
  if (!existsSync(previousPath)) return 0;
  try {
    db.sqlite.prepare("ATTACH DATABASE ? AS prev").run(previousPath);
  } catch (error) {
    db.logger.info("skipping embedding carry-over; previous projection unreadable", {
      path: previousPath,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
  try {
    const table = db.sqlite
      .prepare("SELECT name FROM prev.sqlite_master WHERE type = 'table' AND name = ?")
      .get("chunk_embeddings");
    if (table === undefined) return 0;
    return db.sqlite
      .prepare(
        `INSERT OR IGNORE INTO chunk_embeddings
           (chunk_id, identity, dim, vec, state, failures, updated_ms)
         SELECT chunk_id, identity, dim, vec, state, failures, updated_ms FROM prev.chunk_embeddings`,
      )
      .run().changes;
  } finally {
    db.sqlite.exec("DETACH DATABASE prev");
  }
}

/** Removes leftovers from rebuilds that were interrupted before their rename. */
function cleanStaleRebuilds(corpusDir: string, keep: string): void {
  let names: string[];
  try {
    names = readdirSync(corpusDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(REBUILD_PREFIX)) continue;
    const path = join(corpusDir, name);
    if (path === keep || path.startsWith(`${keep}-`)) continue;
    rmSync(path, { force: true });
  }
}

/**
 * Rebuild the projection from files. Returns the counts it wrote, how long it
 * took, and every file it had to skip.
 */
export function rebuild(config: ProjectionConfig, options: RebuildOptions = {}): RebuildReport {
  const logger = options.logger ?? silentLogger;
  mkdirSync(config.corpusDir, { recursive: true });

  const target = options.into ?? join(config.corpusDir, `${REBUILD_PREFIX}${process.pid}`);
  cleanStaleRebuilds(config.corpusDir, target);
  removeDatabaseFiles(target);

  let report: PopulateReport;
  let embeddingsCarriedOver: number;
  const sqlite = openProjectionDatabase(target, logger);
  const db = createProjectionDb(sqlite, config, target, logger);
  try {
    report = populateFromFiles(db);
    embeddingsCarriedOver = carryOverEmbeddings(db, cacheDbPath(config));
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      META_REBUILT_AT,
      new Date().toISOString(),
    );
  } finally {
    // Closing checkpoints and removes the temp database's own WAL, so what the
    // rename moves is a single self-contained file.
    db.close();
  }

  if (options.into !== undefined) {
    logger.info("projection rebuilt", {
      path: target,
      documents: report.documents,
      embeddingsCarriedOver,
    });
    return { ...report, path: target };
  }

  const destination = cacheDbPath(config);
  renameSync(target, destination);
  removeDatabaseSidecars(destination);
  logger.info("projection rebuilt", {
    path: destination,
    documents: report.documents,
    embeddingsCarriedOver,
  });
  return { ...report, path: destination };
}
