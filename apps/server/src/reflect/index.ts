/**
 * `reflect` — SPEC.md §7's reflection over the whole corpus (rider 9,
 * 2026-08-22).
 *
 * The surface: the clock file, the quiet-window timer, the two routes and the
 * service that ties them together. Nothing outside `reflect/` imports the
 * internal modules directly.
 */

export {
  EMPTY_REFLECT_STATE,
  REFLECT_FILE,
  advanceClock,
  readReflectState,
  recordAwaitingDigest,
  serializeReflectState,
  writeReflectState,
} from "./clock.js";
export type { AwaitingDigest, ReflectClockState } from "./clock.js";
export { mountReflectRoutes } from "./routes.js";
export { createReflectScheduler, minutesToMs } from "./scheduler.js";
export type { ReflectAttempt, ReflectScheduler, ReflectSchedulerOptions } from "./scheduler.js";
export {
  NO_DIGEST_LOG_LINE,
  REFLECT_ASK_SOURCE,
  REFLECT_QUIET_SOURCE,
  createReflectService,
} from "./service.js";
export type { RecordJobLine, ReflectService, ReflectServiceOptions } from "./service.js";
export { countUnreflected, findLiveReflection, resolveDigest } from "./status.js";
