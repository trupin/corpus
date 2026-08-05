/**
 * `edit` — SPEC.md §4's edit acknowledgment: the loop that lets the agent notice
 * what the *user* wrote.
 *
 * Two halves of one feature. {@link createEditSessionTracker} decides when a
 * user edit session has ended and enqueues exactly one `doc.edited` per session,
 * carrying the session's commit range and change stats and never the diff body;
 * {@link mountDocDiffRoutes} serves the bounded diff an agent fetches once it has
 * decided the change is worth reading.
 *
 * This file is the surface: nothing outside `edit/` imports its internals.
 */

export {
  NO_CHANGE_STATS,
  newestCommitFor,
  parentOf,
  parseShortstat,
  readDocDiff,
  readRangeDiff,
  readRangeStats,
  truncateDiff,
} from "./diff.js";
export type { BoundedDiff, DocDiffDeps } from "./diff.js";
export { mountDocDiffRoutes } from "./routes.js";
export { EDIT_ACK_IDLE_MS, EDIT_EVENT_SOURCE, createEditSessionTracker } from "./sessions.js";
export type {
  EditEnqueue,
  EditEnqueueInput,
  EditSessionTracker,
  EditSessionTrackerOptions,
  EnqueuedEditEvent,
  ObservedCommit,
} from "./sessions.js";
