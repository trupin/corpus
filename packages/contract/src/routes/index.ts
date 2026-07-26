import { streamEvents } from "./events.js";
import { getHealth } from "./health.js";
import { createDoc, getDoc, listDocs, updateDoc } from "./docs.js";
import { claimAll, completeEvent, failEvent, getQueueStatus } from "./queue.js";
import { appendTurn, createThread, getThread } from "./threads.js";

export * from "./docs.js";
export * from "./events.js";
export * from "./health.js";
export * from "./queue.js";
export * from "./responses.js";
export * from "./threads.js";

/**
 * Every route the contract declares, by name. The server registers handlers
 * against these definitions (`app.openapi(contractRoutes.getDoc, handler)`), so
 * it cannot serve a shape the contract does not declare (SPEC.md §9.3).
 */
export const contractRoutes = {
  getHealth,
  listDocs,
  getDoc,
  createDoc,
  updateDoc,
  getThread,
  createThread,
  appendTurn,
  getQueueStatus,
  claimAll,
  completeEvent,
  failEvent,
  streamEvents,
} as const;

export type ContractRouteName = keyof typeof contractRoutes;

/**
 * Registration order, which is also the path order in the generated document —
 * declared explicitly so `openapi.json` is byte-stable across runs.
 */
export const ALL_CONTRACT_ROUTES = Object.values(contractRoutes);
