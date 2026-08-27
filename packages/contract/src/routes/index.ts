import { getAgentRoster } from "./agents.js";
import { getAttachment } from "./attachments.js";
import { reorderBoards } from "./boards.js";
import { applyBulkAction } from "./bulk.js";
import { capture } from "./capture.js";
import { checkDocuments } from "./check.js";
import { doctorDb, rebuildDb } from "./db.js";
import { getDocDiff } from "./doc-diff.js";
import { patchDoc } from "./doc-patch.js";
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
import { archiveFolder, deleteFolder, renameFolder, unarchiveFolder } from "./folders.js";
import { respondToForm } from "./forms.js";
import { getHealth } from "./health.js";
import { getIndexStatus, rebuildIndex } from "./index-maintenance.js";
import { abandonJob, appendJobLog, getJobLog, listJobs, retryJob } from "./jobs.js";
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
import { askReflection, getReflectStatus, setReflectQuiet } from "./reflect.js";
import { searchCorpus } from "./search.js";
import { createSkill } from "./skills.js";
import { createThread } from "./thread-create.js";
import { reattachThread } from "./thread-reattach.js";
import { designateResident, releaseResident } from "./thread-resident.js";
import { getThreadScope } from "./thread-scope.js";
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
import { getVocabulary } from "./vocabulary.js";
import { checkUpgrade, startUpgrade } from "./upgrade.js";

export * from "./agents.js";
export * from "./attachments.js";
export * from "./boards.js";
export * from "./bulk.js";
export * from "./capture.js";
export * from "./check.js";
export * from "./db.js";
export * from "./doc-diff.js";
export * from "./doc-patch.js";
export * from "./docs.js";
export * from "./edit-session.js";
export * from "./events.js";
export * from "./folders.js";
export * from "./forms.js";
export * from "./health.js";
export * from "./index-maintenance.js";
export * from "./inventory.js";
export * from "./jobs.js";
export * from "./paths.js";
export * from "./queue.js";
export * from "./reflect.js";
export * from "./dual-media.js";
export * from "./responses.js";
export * from "./search.js";
export * from "./skills.js";
export * from "./thread-create.js";
export * from "./thread-reattach.js";
export * from "./thread-resident.js";
export * from "./thread-scope.js";
export * from "./threads.js";
export * from "./tree.js";
export * from "./vocabulary.js";
export * from "./turn-append.js";
export * from "./upgrade.js";

/**
 * Every route the contract declares, by name. The server registers handlers
 * against these definitions (`app.openapi(contractRoutes.getDoc, handler)`), so
 * it cannot serve a shape the contract does not declare (SPEC.md §9.3).
 *
 * **Order is load-bearing, not cosmetic.** Several resources have a static
 * segment competing with a path parameter for the same position —
 * `/api/queue/{claim-all,reap-stale,halt,resume,status,idle}` against
 * `/api/queue/{id}`. Registering the static
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
 * adjacent is how the pair is found. `patchDoc` follows `updateDoc` for the same
 * reason and in §9.2's own bullet order: the whole-body write and the anchored
 * one belong side by side, because the second exists to be preferred over the
 * first. Nothing competes with it for a position either — it is one segment
 * deeper than `/api/docs/{id}`, where the routes at that depth are `POST`s with
 * distinct static segments. `searchCorpus` follows the document group, where
 * §9.2 lists it.
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
 *
 * `getThreadScope` follows `getThreadContext` for the same reason again: it is
 * the other bounded read off a thread (CONTRACT-068), a `GET` one segment deeper
 * than `/api/threads/{id}` where every other route is a `POST` or a `DELETE`, so
 * `scope` competes with nothing and the position is for the reader.
 *
 * `designateResident` and `releaseResident` close the thread group, after
 * `reattachThread`: they are the last of the thread's user-only acts, and they
 * are a `POST`/`DELETE` pair on one static segment, so the two belong adjacent.
 * `resident` competes with no parameter either — it sits one segment deeper than
 * `/api/threads/{id}`, beside `resolve`, `reopen`, `seen` and `reattach`.
 * `getAgentRoster` follows the whole group and precedes the queue verbs, which
 * is where it belongs in both directions: the roster is what a designation
 * changes and what a `scope` is chosen from.
 *
 * The four **folder acts** sit between `getTree` and `capture`, which is where
 * §9.2's own bullet order puts them: the folder read, then the four acts on a
 * folder. Nothing competes with them for a position — `/api/folders/*` is four
 * fully static paths with no parameter anywhere — so this placement is for the
 * reader.
 *
 * The **board reorder** follows them, and for the same reason in both senses:
 * `/api/boards/order` is a fully static path competing with no parameter, and
 * the folder acts are its nearest neighbours in kind — the only other act whose
 * subject is a set of documents rather than one. It precedes `capture`, which
 * ends the document half of the surface.
 *
 * The two **reflection** routes close the queue group, after `abandonEvent`.
 * That is where they belong in both directions: an ask enqueues a queue event,
 * and the clock is the state the automatic path is decided against. They are one
 * path under two methods and compete with nothing.
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
  patchDoc,
  deleteDoc,
  moveDoc,
  archiveDoc,
  unarchiveDoc,

  searchCorpus,

  getTree,
  getVocabulary,
  renameFolder,
  archiveFolder,
  unarchiveFolder,
  deleteFolder,
  reorderBoards,
  capture,

  createThread,
  getThread,
  getThreadContext,
  getThreadScope,
  appendTurn,
  deleteTurn,
  respondToForm,
  resolveThread,
  reopenThread,
  markThreadSeen,
  reattachThread,
  designateResident,
  releaseResident,

  getAgentRoster,

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

  askReflection,
  getReflectStatus,
  setReflectQuiet,

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
