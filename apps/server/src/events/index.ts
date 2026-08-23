/**
 * `events` — the invalidation half of the live-update loop (SPEC.md §2.2 rule 3,
 * §9.2).
 *
 * The bus is the single in-process emitter every write path publishes to; the
 * SSE hub is a subscriber that turns published keys into `invalidate` frames on
 * `GET /events`. Both are pure in-process machinery with no filesystem access,
 * which is why they live inside `createServer` while the watcher — which is
 * filesystem-bound — attaches from `lifecycle.ts`.
 *
 * This file is the surface: nothing outside `events/` imports its internal
 * modules directly.
 */

export { createInvalidationBus } from "./bus.js";
export type { InvalidationBus, InvalidationBusOptions, InvalidationListener } from "./bus.js";
export {
  AGENTS_KEY,
  DOCS_KEY,
  JOBS_KEY,
  QUEUE_KEY,
  REFLECT_KEY,
  TREE_KEY,
  dedupeKeys,
  docKey,
  jobKey,
  threadKey,
  withReflectKey,
} from "./keys.js";
export {
  GREETING_FRAME,
  HEARTBEAT_FRAME,
  HEARTBEAT_INTERVAL_MS,
  createSseHub,
  invalidateFrame,
  mountEventStream,
} from "./sse.js";
export type { SseConnection, SseHub, SseHubOptions } from "./sse.js";
