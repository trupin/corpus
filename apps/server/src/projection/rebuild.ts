// Full rebuild: a brand-new database built from the workspace's files alone,
// then swapped in atomically (SPEC.md §9.1, §12 M1).
//
// The rename is the commit point. An interrupted rebuild therefore leaves the
// previous `cache.db` intact and a leftover temp file, never a half-written
// database — and the next rebuild cleans the leftovers.

import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { silentLogger, type Logger } from "../logger.js";
import {
  cacheDbPath,
  carryOverEmbeddings,
  createProjectionDb,
  openProjectionDatabase,
  removeDatabaseFiles,
  removeDatabaseSidecars,
  CACHE_DB_FILE,
  type ProjectionConfig,
} from "./db.js";
import { populateFromFiles, type PopulateReport } from "./populate.js";
import { META_REBUILT_AT } from "./schema.js";

/** Prefix of the temp database a rebuild builds into before renaming it over `cache.db`. */
export const REBUILD_PREFIX = `${CACHE_DB_FILE}.rebuild-`;

export interface RebuildOptions {
  /**
   * Build here and leave it here instead of replacing `cache.db`. This is the
   * mode the pre-push check uses to prove the projection is reconstructible
   * from files alone (§11) without disturbing a running workspace.
   */
  readonly into?: string;
  readonly logger?: Logger;
}

export type RebuildReport = PopulateReport & {
  /** Where the rebuilt database ended up. */
  readonly path: string;
};

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
  const db = createProjectionDb(sqlite, config, target, logger, () =>
    openProjectionDatabase(target, logger),
  );
  try {
    report = populateFromFiles(db);
    // The source is always the live `cache.db`, `into` mode included: carrying a
    // cache into a database built beside the one it copies from costs nothing
    // and keeps one behaviour rather than two.
    embeddingsCarriedOver = carryOverEmbeddings(db.sqlite, cacheDbPath(config), logger);
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
