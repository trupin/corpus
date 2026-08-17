// The walk `queue/lanes.ts` defers to: from an event to the designated root
// thread whose scope it falls in (SPEC.md §7, SERVER-111).
//
// ## The walk itself is not here
//
// It is `@corpus/contract`'s {@link walkScope}, and this module is the half that
// is genuinely the server's: turning an event payload into a starting id, and
// reading one node out of the projection. **The traversal moved out** because
// the composer states the same verdict to a person before they post, and since
// UI-118 a pick made on the strength of that statement reaches the wire verbatim
// — so `packages/kit`'s copy was not a hint about this rule, it was this rule,
// and it went on running the `origin ?? parent` chain for a release after
// SERVER-117 deleted it here (UI-119). What §7 sanctions as an edge, in what
// order, and what a dead end costs are all documented there, once.
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

import {
  ORCHESTRATOR_LANE,
  SCOPE_NODE_ABSENT,
  walkScope,
  type Lane,
  type ScopeWalkLookup,
} from "@corpus/contract";
import { originDocumentOf, resolveOrigin } from "../core/provenance.js";
import { unknownLaneScope, unknownRecipient } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import type { ScopeRootLookup } from "./lanes.js";

/**
 * One left join answers for both kinds of node, because a thread *is* a document
 * (§6): `parent_id` is null for a document and for a standalone thread alike,
 * and `resident_name` is only ever set on a standalone thread, since the
 * projection applies §7's standalone rule when it writes the column.
 */
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
 * stamp is read with (SERVER-110). **What must agree is this starting point**:
 * the conversation a job's write files into and the conversation its follow-up
 * work is routed from are the same one, read off the same payload by the same
 * function. Where the walk goes *from* here is this module's question and not
 * that one's — a document created by a job is filed into the job's scope, while
 * a thread hanging on another conversation's document belongs where that
 * document does (below). This is the reuse the issue asks for, not a second copy.
 */
const startOf = (payload: Record<string, unknown>): string | null =>
  resolveOrigin(payload) ?? originDocumentOf(payload);

/**
 * One node, read from the projection.
 *
 * **A row this workspace does not hold is {@link SCOPE_NODE_ABSENT}, never
 * "unread".** The projection is authoritative here: a primary-key miss is proof
 * the corpus has no such artifact, so the branch is dead and the search carries
 * on. `SCOPE_NODE_UNREAD` is the answer a *client* gives about a document
 * it has not fetched, and the server has no such state — which is why the seam
 * distinguishes them rather than folding both into `undefined`.
 */
const projectionLookup =
  (db: ProjectionDb): ScopeWalkLookup =>
  (id: string) => {
    const row = db.prepare(NODE_SQL).get(id) as NodeRow | undefined;
    if (row === undefined) return SCOPE_NODE_ABSENT;
    return { parent: row.parentId, origin: row.origin, designated: row.residentName !== null };
  };

/**
 * Binds `@corpus/contract`'s {@link walkScope} to an open projection.
 *
 * The traversal — parent branch first, both edges, a dead end costing its branch
 * and nothing else — is documented where it lives, and is the identical function
 * the composer states its default from. `unread` is unreachable from
 * {@link projectionLookup}; it is answered as the orchestrator's lane anyway
 * rather than thrown, because a routing decision on the enqueue path must return
 * a lane for every input.
 */
export function createLaneScopeLookup(db: ProjectionDb): ScopeRootLookup {
  const lookup = projectionLookup(db);
  return (payload: Record<string, unknown>): Lane => {
    const walk = walkScope(startOf(payload), lookup);
    return walk.kind === "lane" ? walk.lane : ORCHESTRATOR_LANE;
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

/**
 * Refuses a `scope` that names no lane, **before the request is parked**
 * (SPEC.md §7, SERVER-118).
 *
 * {@link assertRecipientResolvable}'s sibling, one predicate and one refusal
 * apart from it, and it exists because `scope` had none: a thread id is a thread
 * id on the wire, so `LaneSchema` admits every `th_…` and any one of them
 * reached `observePark`. **Parking is what presence *is***, so an admitted
 * non-lane made `QueueStatus.agent.live` true for a grace window while
 * `GET /api/agents` — which lists designated roots and only those — listed
 * nothing live. The contract publishes those two as one observation at two
 * grains (*"`live` is true exactly when some lane of `GET /api/agents` is
 * live"*), and a typo'd or stale `--thread` falsified it in silence, indefinitely
 * if the loop kept re-parking. It is a decision use and not a display: the CLI
 * documents `corpus queue status --json | jq -e '.agent.live'` as a guard before
 * enqueuing work.
 *
 * **Asked at the request, and never re-asked of one already admitted.** A
 * resident released while its listener is parked keeps that park: §7's presence
 * is the held request, and a lane the server is at this moment holding an `idle`
 * open on has somebody listening on it whatever the frontmatter now says. The
 * park ends when its window does, the **re-park** is refused, and the lane leaves
 * presence one grace window later — at which point §7's own fallback hands its
 * already-stamped events to the orchestrator's unscoped claim, so nothing is
 * stranded by the refusal. Ending the in-flight request instead would abort a
 * request for a reason that is not the request's, and dropping the lane from the
 * tracker on release would answer "nobody is listening" about a request the
 * server is listening on. That window — live with no roster row — is
 * CONTRACT-053's, and it stays legal: what this refuses is a lane that was
 * **never** one, not a lane that has stopped being one.
 *
 * Scoped to a **park** rather than to every scoped verb: `claim-all` on a lane
 * that has just lost its resident is how the listener still holding it drains
 * the events already stamped with it, and those events are invisible to the
 * orchestrator until the lane lapses. Refusing there would make them claimable
 * by nobody for a whole grace window — a fix that stranded work in order to
 * tidy a parameter.
 */
export function assertScopeIsLane(db: ProjectionDb, scope: Lane | undefined): void {
  if (scope === undefined || scope === ORCHESTRATOR_LANE) return;
  if (!isDesignatedRoot(db, scope)) throw unknownLaneScope(scope);
}
