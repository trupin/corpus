/**
 * `locks` — per-document edit locks (SPEC.md §7).
 *
 * One holder at a time, file-backed under `.corpus/locks/`, evaluated for expiry
 * on every read, projected into the `locks` table and broadcast like any other
 * state. The write-path guard lives here too: it is the one place that turns
 * "somebody else is editing" into the contract's `423`.
 *
 * This file is the surface: nothing outside `locks/` imports its modules
 * directly.
 */

export { actorFromRequest, createLockGuard, createLockGuardMiddleware } from "./guard.js";
export type { LockGuard, LockGuardMiddlewareOptions } from "./guard.js";
export { mountLockRoutes } from "./routes.js";
export {
  LockService,
  TRAILER_LOCK_HOLDER,
  createLockService,
  forceBreakSubject,
} from "./service.js";
export type { BreakResult, LockInvalidate, LockServiceOptions } from "./service.js";
export {
  DEFAULT_LOCK_TTL_SECONDS,
  LOCKS_DIR_NAME,
  LockStore,
  MAX_LOCK_TTL_SECONDS,
  StoredLockSchema,
  clampTtl,
  expiresAtMs,
  isExpired,
  toWireLock,
} from "./store.js";
export type { LockWriteObserver, StoredLock } from "./store.js";
