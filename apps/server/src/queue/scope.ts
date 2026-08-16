// The walk `queue/lanes.ts` defers to: from an event to the designated root
// thread whose scope it falls in (SPEC.md §7, SERVER-111).
//
// ## What a scope is, and why nothing stores one
//
// > The **scope** of a designated thread is: the thread itself; every thread
// > whose parent chain reaches it; every document whose **origin** (§9.2)
// > reaches it; and every thread on such a document. … **Scope is computed,
// > never stored.**
//
// So a thread designated *after* a document was created captures that document
// retroactively — the origin was recorded when the document was written, not
// when it became interesting — and releasing a resident needs nothing undone.
// The consequence for this module is that membership is a walk **up**, made
// fresh on every enqueue, and the only two edges it may follow are the two §7
// names: a thread's `parent`, and a document's `origin`.
//
// ## Why it reads the projection and not the corpus
//
// This runs on the enqueue path, which is every message anyone posts. §9.2's
// `origin` and §7's `resident` are both projected columns for exactly this
// reason (SERVER-109 put the resident there and said so), so a step of the walk
// is one indexed SQLite read on a primary key rather than a file open. Nothing
// is cached: the chains are one to three links in practice, and a cache keyed to
// anything longer than a single call could serve a designation the same request
// just changed.

import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
import { originDocumentOf, resolveOrigin } from "../core/provenance.js";
import { unknownRecipient } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import type { ScopeRootLookup } from "./lanes.js";

/**
 * One node of the walk: the two edges out of it, and whether it is a lane in its
 * own right.
 *
 * Every thread is also a row in `documents` (a thread *is* a document, §6), so
 * one left join answers for both kinds of node and the walk needs no prior
 * knowledge of which it is looking at. `parentId` is null for a document and for
 * a standalone thread alike; `designated` is only ever true for a standalone
 * thread, because the projection applies §7's standalone rule when it writes the
 * column.
 */
interface ScopeNode {
  readonly parentId: string | null;
  readonly origin: string | null;
  readonly designated: boolean;
}

const NODE_SQL = `
  SELECT threads.parent_id AS parentId,
         documents.origin AS origin,
         threads.resident_name AS residentName
  FROM documents
  LEFT JOIN threads ON threads.id = documents.id
  WHERE documents.id = ?`;

type NodeRow = {
  readonly parentId: string | null;
  readonly origin: string | null;
  readonly residentName: string | null;
};

/**
 * Where an event's own conversation starts: the thread its payload names, or —
 * when it names only a document, which is `doc.edited`'s shape — that document.
 *
 * Both halves come from `core/provenance.ts`, which is the same pair the *origin*
 * stamp is read with (SERVER-110). They must agree: a document filed into one
 * scope while its follow-up work queues on another is a resident that owns the
 * artifact and never hears about it. This is the reuse the issue asks for — the
 * walk below is a different question (scope membership) that had no reader
 * before, not a second copy of that one.
 */
const startOf = (payload: Record<string, unknown>): string | null =>
  resolveOrigin(payload) ?? originDocumentOf(payload);

/**
 * Binds the walk to an open projection.
 *
 * **Cycles terminate at the orchestrator.** `origin` is written once by the
 * first write that names a job and `parent` by a create, so the graph is acyclic
 * by construction — but §5 makes the *files* the source of truth, and a
 * hand-edited pair of frontmatters can name each other. A visited set costs one
 * `Set` per enqueue and turns "the server hangs on a malformed workspace" into
 * "that event goes to the orchestrator", which is the same answer every other
 * unresolvable case gets.
 */
export function createLaneScopeLookup(db: ProjectionDb): ScopeRootLookup {
  return (payload: Record<string, unknown>): Lane => {
    let current = startOf(payload);
    const visited = new Set<string>();
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const row = db.prepare(NODE_SQL).get(current) as NodeRow | undefined;
      // A payload naming a document this workspace does not hold — a deleted
      // thread, an id from another corpus — falls in no scope, which is the
      // orchestrator's lane. Refusing the enqueue over it would lose the work.
      if (row === undefined) return ORCHESTRATOR_LANE;
      const node: ScopeNode = {
        parentId: row.parentId,
        origin: row.origin,
        designated: row.residentName !== null,
      };
      if (node.designated) return current;
      // **An artifact's own `origin` outranks its parent**, and the parent chain
      // is followed only where there is no origin to follow. The two edges name
      // different scopes for exactly one artifact — a thread an agent opened on
      // a document belonging to some *other* conversation, while naming its own
      // job — and §7 arbitrates that case on origin: "an artifact belongs to at
      // most one scope: origin is single-valued and written once, by the first
      // write that names a job, so a second scope cannot claim what a first
      // already holds".
      //
      // The decisive reason is `core/provenance.ts`'s invariant, which this walk
      // shares a starting point with: the origin stamped on an artifact and the
      // lane its follow-up work is queued on must agree, because "a document
      // filed into one scope while its follow-up work is queued on another is a
      // resident that owns the artifact and never hears about it". Taking the
      // parent first would produce that exact state.
      //
      // It costs the ordinary case nothing: a comment a *person* leaves on a
      // document names no job, so it carries no origin and reaches its parent's
      // scope by the second edge — which is §7's "a conversation that produces a
      // draft, and a comment left on that draft, reach the same agent".
      current = node.origin ?? node.parentId;
    }
    return ORCHESTRATOR_LANE;
  };
}

/**
 * Is `id` a lane a message may be addressed to — a **designated root thread**?
 *
 * The server-side half of the contract's `422 unknown_recipient`: a thread id is
 * a thread id on the wire, so "this thread is not a designated root" is a
 * refusal only a workspace can make. Both failures answer the same way on
 * purpose — a thread that does not exist and a thread with no resident are both
 * "that is not a lane", and telling them apart would make the refusal an
 * existence oracle over the corpus.
 */
export function isDesignatedRoot(db: ProjectionDb, id: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS ok FROM threads WHERE id = ? AND parent_id IS NULL AND resident_name IS NOT NULL",
    )
    .get(id) as { ok: number } | undefined;
  return row !== undefined;
}

/**
 * Refuses a `recipient` that names no lane, before anything is written
 * (SPEC.md §7, CONTRACT-051's `422 unknown_recipient`).
 *
 * **Omitting one is not naming a wrong one.** An absent recipient is the
 * ordinary case — the lane follows from where the message was posted — so it
 * passes without a lookup. `orchestrator` always resolves: it is the lane that
 * exists whether or not anything is designated.
 *
 * Refused rather than ignored, for the reason a bad `job` is: the composer only
 * offers live lanes, but a pick can go stale between the roster read and the
 * post, and quietly routing it elsewhere would answer the person from an agent
 * they did not address. Refused *before* the write for the reason the contract
 * states as part of the refusal — "nothing was written" — so the caller can
 * resend the same message with a different recipient rather than discover it was
 * posted to the wrong agent.
 */
export function assertRecipientResolvable(db: ProjectionDb, recipient: Lane | undefined): void {
  if (recipient === undefined || recipient === ORCHESTRATOR_LANE) return;
  if (!isDesignatedRoot(db, recipient)) throw unknownRecipient(recipient);
}
