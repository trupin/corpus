/**
 * `jobs` — the console feed (SPEC.md §7, §11).
 *
 * Every queue event is a job: an append-only `.corpus/jobs/<eventId>.jsonl` of
 * progress lines, a console row whose status is joined from the queue, and the
 * two actions the console offers on a failed one. The live-log loop is §2 rule 3
 * made concrete — the stream announces that a log grew, HTTP carries the lines.
 *
 * This file is the surface: nothing outside `jobs/` imports its modules
 * directly.
 */

export {
  UNKNOWN_INSTANT,
  listJobRows,
  readJobRow,
  recordJobLine,
  resolveOrigin,
} from "./project.js";
export type { JobOrigin } from "./project.js";
export { mountJobRoutes } from "./routes.js";
export { JobService, RETRY_LOG_LINE, createJobService } from "./service.js";
export type { JobServiceOptions } from "./service.js";
export {
  FILE_CAP_NOTICE,
  JOBS_DIR_NAME,
  JobLogStore,
  LINE_TRUNCATION_MARKER,
  LOG_SOURCES,
  MAX_LOG_FILE_BYTES,
  MAX_LOG_LINE_BYTES,
  StoredLogLineSchema,
  toWireLine,
  truncateLine,
} from "./store.js";
export type { AppendInput, AppendOutcome, LogSource, StoredLogLine } from "./store.js";
export { STATED_WEIGHT_PREFIX, createStatedWeightRecorder, statedWeightLine } from "./weight.js";
export type { StatedWeightRecorder, StatedWeightRecorderOptions } from "./weight.js";
