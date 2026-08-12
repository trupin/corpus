/**
 * `watcher` — the out-of-band half of the live-update loop (SPEC.md §2.2 rule 1,
 * §6, §9.1).
 *
 * The server is the sole writer, so this is a *catch-all*, not a write channel:
 * it notices edits Corpus never performed, reconciles their anchors against the
 * last committed version, re-projects the affected files, publishes the query
 * keys that went stale onto the same bus every write path uses — and commits the
 * change for itself, authored `user` (SPEC.md §4, SERVER-090), so a person's edit
 * is never attributed to whoever touched the document next.
 *
 * This file is the surface: nothing outside `watcher/` imports its internal
 * modules directly.
 */

export { attachWatcher } from "./attach.js";
export { createOutOfBandCommitter, outOfBandSubject } from "./commit-out-of-band.js";
export type {
  CommitOutOfBandChanges,
  OutOfBandChange,
  OutOfBandCommitterOptions,
} from "./commit-out-of-band.js";
export { GIT_TIMEOUT_MS, MAX_HEAD_BLOB_BYTES, readHeadVersion } from "./git-head.js";
export type { ReadHeadVersion } from "./git-head.js";
export { WATCH_FILES, WATCH_ROOTS, classifyWatchPath, isIgnoredEntry } from "./paths.js";
export type { WatchTarget } from "./paths.js";
export { reconcileOutOfBandEdit } from "./reconcile-out-of-band.js";
export type { OutOfBandOutcome, ReconcileOutOfBandOptions } from "./reconcile-out-of-band.js";
export { SELF_WRITE_TTL_MS, createSelfWriteRegistry } from "./self-writes.js";
export type { SelfWriteRegistry, SelfWriteRegistryOptions } from "./self-writes.js";
export {
  AWAIT_WRITE_FINISH,
  WATCH_DEBOUNCE_MS,
  WATCH_FLUSH_BUDGET_MS,
  WATCH_MAX_BATCH_MS,
  startWatcher,
} from "./watcher.js";
export type { StartWatcherOptions, WatchEventKind, WatcherHandle } from "./watcher.js";
