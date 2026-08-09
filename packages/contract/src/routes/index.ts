import { getAttachment } from "./attachments.js";
import { applyBulkAction } from "./bulk.js";
import { capture } from "./capture.js";
import { checkDocuments } from "./check.js";
import { doctorDb, rebuildDb } from "./db.js";
import { getDocDiff } from "./doc-diff.js";
import { flushEditSession } from "./edit-session.js";
import {
  archiveDoc,
  createDoc,
  deleteDoc,
  getDoc,
  listDocs,
  moveDoc,
  relatedDocs,
  unarchiveDoc,
  updateDoc,
} from "./docs.js";
import { streamEvents } from "./events.js";
import { respondToForm } from "./forms.js";
import { getHealth } from "./health.js";
import { getIndexStatus, rebuildIndex } from "./index-maintenance.js";
import { abandonJob, appendJobLog, getJobLog, listJobs, retryJob } from "./jobs.js";
import { acquireLock, breakLock, listLocks, reapLocks, releaseLock } from "./locks.js";
import {
  abandonEvent,
  claimAll,
  completeEvent,
  deferEvent,
  failEvent,
  getQueueStatus,
  haltQueue,
  idleQueue,
  reapStale,
  resumeQueue,
} from "./queue.js";
import { searchCorpus } from "./search.js";
import { createSkill, rollbackSkill } from "./skills.js";
import { createThread } from "./thread-create.js";
import { reattachThread } from "./thread-reattach.js";
import {
  deleteTurn,
  getThread,
  getThreadContext,
  markThreadSeen,
  reopenThread,
  resolveThread,
} from "./threads.js";
import { appendTurn } from "./turn-append.js";
import { getTree } from "./tree.js";
import { checkUpgrade, startUpgrade } from "./upgrade.js";

export * from "./attachments.js";
export * from "./bulk.js";
export * from "./capture.js";
export * from "./check.js";
export * from "./db.js";
export * from "./doc-diff.js";
export * from "./docs.js";
export * from "./edit-session.js";
export * from "./events.js";
export * from "./forms.js";
export * from "./health.js";
export * from "./index-maintenance.js";
export * from "./inventory.js";
export * from "./jobs.js";
export * from "./locks.js";
export * from "./queue.js";
export * from "./dual-media.js";
export * from "./responses.js";
export * from "./search.js";
export * from "./skills.js";
export * from "./thread-create.js";
export * from "./thread-reattach.js";
export * from "./threads.js";
export * from "./tree.js";
export * from "./turn-append.js";
export * from "./upgrade.js";

/**
 * Every route the contract declares, by name. The server registers handlers
 * against these definitions (`app.openapi(contractRoutes.getDoc, handler)`), so
 * it cannot serve a shape the contract does not declare (SPEC.md §9.3).
 *
 * **Order is load-bearing, not cosmetic.** Several resources have a static
 * segment competing with a path parameter for the same position — `/api/locks/
 * reap` against `/api/locks/{docId}`, and `/api/queue/{claim-all,reap-stale,
 * halt,resume,status,idle}` against `/api/queue/{id}`. Registering the static
 * routes first is what makes a document literally named `reap` unambiguous; the
 * failure mode is silent misrouting, so `index.test.ts` holds the order rather
 * than a comment alone. It also fixes the path order of the generated document,
 * which is what makes `openapi.json` byte-stable across runs.
 *
 * `relatedDocs` and `getDocDiff` sit next to `getDoc` for readability rather
 * than for routing: both are `GET`s one segment deeper than `/api/docs/{id}`,
 * and the routes at that depth (`move`, `archive`, `unarchive`,
 * `edit-session/flush`) are `POST`s, so no static segment competes with `{id}`
 * here. `flushEditSession` follows `getDocDiff` for the same readability
 * reason: SPEC.md §4's edit-acknowledgment surface is those two routes — the
 * signal that ends a session and the read that explains it — and keeping them
 * adjacent is how the pair is found. `searchCorpus` follows the document group,
 * where §9.2 lists it.
 *
 * `applyBulkAction` is registered **before** the parameterised document routes
 * for the ordering reason above: `/api/docs/bulk` is a static segment where
 * `/api/docs/{id}` carries a parameter. Nothing competes today — no
 * `POST /api/docs/{id}` exists, and `bulk` matches neither id prefix — but the
 * failure mode is silent misrouting, so it takes the safe position rather than
 * relying on a coincidence of methods, and `index.test.ts` holds the order. It
 * sits beside `createDoc` for readability too: those two are the collection's
 * mutations, where everything below them addresses one document.
 *
 * `getThreadContext` sits directly after `getThread` for the same reason — §9.2
 * lists the context pack in the bullet immediately below the thread read — and
 * likewise not for routing: it is a `GET` one segment deeper than
 * `/api/threads/{id}`, and every other route at that depth is a `POST` or a
 * `DELETE`, so `context` competes with nothing.
 */
export const contractRoutes = {
  getHealth,

  listDocs,
  createDoc,
  applyBulkAction,
  getDoc,
  relatedDocs,
  getDocDiff,
  flushEditSession,
  updateDoc,
  deleteDoc,
  moveDoc,
  archiveDoc,
  unarchiveDoc,

  searchCorpus,

  getTree,
  capture,

  createThread,
  getThread,
  getThreadContext,
  appendTurn,
  deleteTurn,
  respondToForm,
  resolveThread,
  reopenThread,
  markThreadSeen,
  reattachThread,

  getQueueStatus,
  idleQueue,
  claimAll,
  reapStale,
  haltQueue,
  resumeQueue,
  completeEvent,
  failEvent,
  deferEvent,
  abandonEvent,

  listLocks,
  reapLocks,
  acquireLock,
  releaseLock,
  breakLock,

  listJobs,
  getJobLog,
  appendJobLog,
  retryJob,
  abandonJob,

  rebuildDb,
  doctorDb,

  checkDocuments,

  getIndexStatus,
  rebuildIndex,

  createSkill,
  rollbackSkill,

  checkUpgrade,
  startUpgrade,

  streamEvents,
  getAttachment,
} as const;

export type ContractRouteName = keyof typeof contractRoutes;

/**
 * Registration order, which is also the path order in the generated document —
 * declared explicitly so `openapi.json` is byte-stable across runs.
 */
export const ALL_CONTRACT_ROUTES = Object.values(contractRoutes);
