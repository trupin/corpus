// Rebuilding every row from the workspace's files — the operation that makes
// §9.1's "derived tables only" true and §12's M1 check pass.
//
// One pass, one transaction, shared by `openProjection` (boot: files may have
// changed while the server was down) and by `rebuild` (into a fresh database
// that then replaces `cache.db`). Sharing it is the point: two implementations
// of "files → rows" would drift, and TEST-21's rebuild-equals-incremental
// invariant is exactly the drift detector.

import { REPOPULATED_TABLES } from "./schema.js";
import { enumerateDocuments } from "./roots.js";
import { projectDocument, type ProjectionOutcome } from "./project-document.js";
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

/** What to put in a log field for a thrown value. */
const causeOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Re-derives every row from files. Files are visited in sorted
 * workspace-relative path order, which is what makes duplicate-id resolution
 * and two successive rebuilds deterministic.
 *
 * A file that cannot be projected is recorded and skipped — never partially
 * inserted, and never fatal: one broken document must not take the server down.
 *
 * **That last clause is enforced here, not merely asserted (SERVER-064).** This
 * runs from `openProjection`, i.e. during boot, so a throw is not "the
 * projection is degraded" — it is `corpus server start` reporting that the
 * server exited during startup, over one file in `data/`, with no server left to
 * ask why and no `db doctor` to run. {@link projectDocument} rethrows every read
 * failure that is not `ENOENT` — correctly, because on the *write* path a save
 * that cannot read its own file back must fail loudly — so the boot policy of
 * skipping belongs to this reader, which is the one that knows it is a boot.
 * That is SERVER-063's shape one directory over: the store stays honest, the
 * reader decides.
 *
 * "Never partially inserted" survives the catch because the read is
 * {@link projectDocument}'s first act: a file it cannot read is refused before
 * any row is written, and the insert phase after it is that function's own
 * transaction, which rolls itself back on the way out.
 *
 * The two faults are logged at different levels, as the queue's readers log
 * theirs (`queue/held.ts`, `queue/project.ts`): a document whose *content* is
 * broken is expected residue an operator may already know about (`debug`), while
 * a file the process could not read at all is a workspace fault only an operator
 * can fix — so it is named, with its reason, at `error`, the one level a server
 * running at `silent` still writes. The log line is the whole remedy: the file
 * has to be found by hand.
 *
 * Nothing is moved and nothing is written on either path. **Boot is a read**,
 * and relocating a file the process could not read is not something a boot
 * should attempt.
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
      let outcome: ProjectionOutcome;
      try {
        outcome = projectDocument(db, file.absPath);
      } catch (error) {
        // The path comes from the enumeration rather than from the projection,
        // because the file that could not be read is exactly the file whose
        // contents cannot name it.
        const reason = causeOf(error);
        skipped.push({ path: file.path, reason });
        db.logger.error("skipping unreadable document", { path: file.path, reason });
        continue;
      }
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
          db.logger.debug("skipping document", { path: outcome.path, reason: outcome.reason });
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
    seen: runtime.seen,
    durationMs: Date.now() - startedAt,
    skipped,
  };
}
