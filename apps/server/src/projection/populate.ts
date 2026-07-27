// Rebuilding every row from the workspace's files — the operation that makes
// §9.1's "derived tables only" true and §15's M1 check pass.
//
// One pass, one transaction, shared by `openProjection` (boot: files may have
// changed while the server was down) and by `rebuild` (into a fresh database
// that then replaces `cache.db`). Sharing it is the point: two implementations
// of "files → rows" would drift, and TEST-21's rebuild-equals-incremental
// invariant is exactly the drift detector.

import { REPOPULATED_TABLES } from "./schema.js";
import { enumerateDocuments } from "./roots.js";
import { projectDocument } from "./project-document.js";
import { projectRuntime } from "./project-runtime.js";
import type { ProjectionDb } from "./db.js";

/** A file that is a document by location but produced no row, and why. */
export type SkippedFile = { readonly path: string; readonly reason: string };

export type PopulateReport = {
  readonly documents: number;
  readonly threads: number;
  readonly turns: number;
  readonly anchors: number;
  readonly links: number;
  readonly events: number;
  readonly jobs: number;
  readonly locks: number;
  readonly seen: number;
  readonly durationMs: number;
  readonly skipped: readonly SkippedFile[];
};

/** Empties every derived table, leaving `meta` (which carries the schema stamp). */
export function clearProjection(db: ProjectionDb): void {
  for (const table of REPOPULATED_TABLES) {
    db.sqlite.exec(`DELETE FROM ${table}`);
  }
}

/**
 * Re-derives every row from files. Files are visited in sorted
 * workspace-relative path order, which is what makes duplicate-id resolution
 * and two successive rebuilds deterministic.
 *
 * A file that cannot be projected is recorded and skipped — never partially
 * inserted, and never fatal: one broken document must not take the server down.
 */
export function populateFromFiles(db: ProjectionDb): PopulateReport {
  const startedAt = Date.now();
  const skipped: SkippedFile[] = [];
  let documents = 0;
  let threads = 0;
  let turns = 0;
  let anchors = 0;
  let links = 0;

  const files = enumerateDocuments(db.config.workspaceRoot);

  db.transaction(() => {
    clearProjection(db);
    for (const file of files) {
      const outcome = projectDocument(db, file.absPath);
      switch (outcome.kind) {
        case "projected":
          documents += 1;
          threads += outcome.counts.threads;
          turns += outcome.counts.turns;
          anchors += outcome.counts.anchors;
          links += outcome.counts.links;
          break;
        case "skipped":
          skipped.push({ path: outcome.path, reason: outcome.reason });
          db.logger.info("skipping document", { path: outcome.path, reason: outcome.reason });
          break;
        case "removed":
          skipped.push({ path: outcome.path, reason: "file disappeared during the rebuild" });
          break;
        case "ignored":
          break;
      }
    }
  })();

  const runtime = db.transaction(() => projectRuntime(db))();

  return {
    documents,
    threads,
    turns,
    anchors,
    links,
    events: runtime.events,
    jobs: runtime.jobs,
    locks: runtime.locks,
    seen: runtime.seen,
    durationMs: Date.now() - startedAt,
    skipped,
  };
}
