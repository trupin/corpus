/**
 * The projection (SPEC.md §9.1): the derived SQLite database at
 * `.corpus/cache.db`, its per-file projectors, a rebuild that reconstructs it
 * from files alone, and a drift check cheap enough for a pre-commit hook.
 *
 * Two invariants hold everything here together:
 *
 * - **Nothing durable lives only in SQLite.** Every row is re-derivable from the
 *   workspace, which is why a schema change wipes and rebuilds instead of
 *   migrating, and why there is no migration code to write.
 * - **Every projector is synchronous.** Write paths project inline after writing
 *   and before responding, which is what gives §9.1's read-your-write
 *   consistency. No projector may become `async`.
 *
 * This file is the surface: nothing outside `projection/` imports its internal
 * modules directly.
 */

export { attachProjection, openWorkspaceProjection } from "./attach.js";
export {
  BUSY_TIMEOUT_MS,
  CACHE_DB_FILE,
  ProjectionError,
  cacheDbPath,
  createProjectionDb,
  openProjection,
  openProjectionDatabase,
  openProjectionReadonly,
  removeDatabaseFiles,
  removeDatabaseSidecars,
  assertFts5Available,
} from "./db.js";
export type {
  OpenProjectionOptions,
  ProjectionConfig,
  ProjectionDb,
  SqliteDatabase,
  SqliteStatement,
} from "./db.js";
export { DRIFT_KINDS, doctor } from "./doctor.js";
export type { Drift, DoctorReport, DriftKind } from "./doctor.js";
export { clearProjection, populateFromFiles } from "./populate.js";
export type { PopulateReport, SkippedFile } from "./populate.js";
export {
  EXCERPT_LENGTH,
  hashContent,
  projectDocument,
  readDocumentIdentity,
  removeDocument,
  syntheticDocumentId,
} from "./project-document.js";
export type { DocumentCounts, DocumentIdentity, ProjectionOutcome } from "./project-document.js";
export {
  JOBS_DIR,
  LOCKS_DIR,
  QUEUE_DIR,
  SEEN_FILE,
  isEventFile,
  listQueueEventFiles,
  projectEvent,
  projectEventFile,
  projectJob,
  projectJobsDir,
  projectLock,
  projectLocksDir,
  projectQueueDir,
  projectRuntime,
  projectSeen,
  removeEvent,
  removeJob,
  removeLock,
} from "./project-runtime.js";
export type { RuntimeCounts } from "./project-runtime.js";
export { createProjectionQueueMirror } from "./queue-mirror.js";
export { REBUILD_PREFIX, rebuild } from "./rebuild.js";
export type { RebuildOptions, RebuildReport } from "./rebuild.js";
export {
  DOCUMENT_ROOTS,
  SKILL_FILENAME,
  classifyPath,
  enumerateDocuments,
  workspaceRelativePath,
} from "./roots.js";
export type { DocumentRoot, EnumeratedFile, RootShape } from "./roots.js";
export {
  META_REBUILT_AT,
  META_SCHEMA_VERSION,
  PROJECTION_DDL,
  PROJECTION_TABLES,
  REPOPULATED_TABLES,
  SCHEMA_VERSION,
} from "./schema.js";
export type { ProjectionTable } from "./schema.js";
