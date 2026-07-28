// Closing the window between the boot scan and the watcher going live
// (SERVER-025).
//
// Boot projects the workspace synchronously (`populateFromFiles`, before the
// socket opens) and then starts chokidar with `ignoreInitial: true`. Those two
// facts leave a gap that nothing owned: chokidar's initial walk takes real time,
// and a file written into `data/docs/` *after* the scan read the tree but
// *before* the walk established the watch on its directory is seen by neither.
// The scan has already run, and `ignoreInitial` tells chokidar to say nothing
// about anything the walk finds. The row simply never appears — measured at 290
// ms wide on a 400-document workspace, and the 30 documents written into it were
// still missing a minute later, with `db doctor` reporting `missing_row` for
// each one. Nothing heals it but an unrelated edit to the same file, or a
// restart that happens to miss the window.
//
// So the watcher closes its own window: once it is ready — and therefore once
// every later write *will* produce an event — it asks whether the files and the
// rows still agree, and repopulates if they do not.
//
// Three properties make this affordable enough to run on every boot:
//
// - **The question is cheaper than the answer.** `inspectProjection` is
//   `doctor`'s in-process form, built to a pre-commit hook's budget: it walks
//   the roots, compares size and mtime against `file_hashes`, and on a
//   workspace nothing touched it reads no file bytes and parses no frontmatter.
//   The expensive half — a full `populateFromFiles` — runs only when there is
//   real drift to repair.
// - **Nothing here re-derives rows.** The comparator is `doctor`'s and the
//   repairer is `populateFromFiles`, both already shared with `POST
//   /api/db/rebuild`. A third statement of "files → rows" is exactly the drift
//   this codebase keeps refusing to introduce.
// - **It is off the boot path.** This is registered at attach time and runs
//   whenever `ready` resolves, so it never delays the bind, and a `ready` that
//   never resolves leaves the server exactly where it is today rather than
//   hanging it.

import type { QueueService } from "../queue/index.js";
import type { InvalidationBus } from "../events/index.js";
import type { Logger } from "../logger.js";
import {
  REBUILD_QUERY_KEYS,
  createProjectionQueueMirror,
  inspectProjection,
  populateFromFiles,
  type Drift,
  type DriftKind,
  type ProjectionDb,
} from "../projection/index.js";

/**
 * The drift kinds a repopulate can actually repair, which are also the three
 * shapes the window produces: a file written into it has no row
 * (`missing_row`), a file deleted in it leaves one behind (`orphan_row`), and a
 * file edited in it keeps a row describing the bytes the scan saw
 * (`content_mismatch`).
 *
 * The other three are deliberately not triggers, because they are *states of
 * the workspace* rather than of the projection, and repopulating would neither
 * clear them nor stop them recurring. `unparseable` and `duplicate_id` survive
 * any number of rebuilds — one broken document would otherwise buy a full
 * re-scan and a coarse invalidate on every single boot, forever. And
 * `count_mismatch` concerns the `events` table, whose authority is the queue's
 * own reader (see the mirror rebind below), not this scan.
 */
export const REPAIRABLE_DRIFT_KINDS: readonly DriftKind[] = [
  "missing_row",
  "orphan_row",
  "content_mismatch",
];

const isRepairable = (entry: Drift): boolean => REPAIRABLE_DRIFT_KINDS.includes(entry.kind);

export interface BootCatchUpDeps {
  readonly db: ProjectionDb;
  readonly bus: InvalidationBus;
  /** Rebound after a repopulate, because the queue's reader owns `events`. */
  readonly queue: Pick<QueueService, "attachMirror">;
  readonly logger: Logger;
  /** Resolves once the watcher's initial scan is done and events are live. */
  readonly ready: Promise<void>;
  /**
   * Answers "has this server shut down?". The catch-up resolves after an
   * `await`, so the handle it was given may have been closed in the meantime;
   * touching a closed database would turn a clean shutdown into a crash.
   */
  readonly cancelled: () => boolean;
}

/**
 * Runs the catch-up once `ready` resolves. Returns the promise so a test can
 * await the work rather than sleeping; callers on the boot path deliberately
 * do not.
 */
export async function catchUpOnWatcherReady(deps: BootCatchUpDeps): Promise<void> {
  const { db, bus, queue, logger, ready, cancelled } = deps;
  await ready;
  if (cancelled()) return;

  const report = inspectProjection(db);
  const repairable = report.drift.filter(isRepairable);
  if (repairable.length === 0) {
    logger.debug("boot catch-up found nothing to repair", {
      files: report.stats.files,
      hashed: report.stats.hashed,
      durationMs: report.stats.durationMs,
    });
    return;
  }

  // Written at `info`: this is data that was on disk and invisible until now,
  // and an operator watching a restart should see that it happened.
  logger.info("projection disagreed with the files when the watcher went live; repairing", {
    drift: repairable.length,
    kinds: [...new Set(repairable.map((entry) => entry.kind))],
    paths: repairable.slice(0, 10).map((entry) => entry.path ?? null),
  });

  const populated = populateFromFiles(db);
  // Exactly as at boot (`attachProjection`) and after a rebuild
  // (`POST /api/db/rebuild`): the repopulate derived `events` from the queue
  // directories, and rebinding replaces that with what the queue's own reader
  // will actually find there.
  queue.attachMirror(createProjectionQueueMirror(db));

  // One coarse frame, and only because rows just changed underneath clients
  // that may already be connected — which is the whole of SERVER-025's original
  // premise, landing at the moment it is actually true. `createSseHub` returns
  // early when nothing is subscribed, so a boot nobody was watching costs
  // nothing extra.
  bus.invalidate(REBUILD_QUERY_KEYS);

  logger.info("boot catch-up complete", {
    documents: populated.documents,
    durationMs: populated.durationMs,
  });
}
