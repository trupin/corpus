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
  SCOPE_PAGE_SIZE,
  walkScope,
  type DocStatus,
  type Lane,
  type ScopeMember,
  type ScopeMemberVia,
  type ScopeWalkLookup,
  type ScopeWalkNode,
} from "@corpus/contract";
import { originDocumentOf, resolveOrigin } from "../core/provenance.js";
import type { LaneReleased } from "./lanes.js";
import { unknownLaneScope, unknownRecipient } from "../errors.js";
import type { ProjectionDb } from "../projection/index.js";
import type { ScopeRootLookup } from "./lanes.js";

/**
 * One left join answers for both kinds of node, because a thread *is* a document
 * (§6): `parent_id` is null for a document and for a standalone thread alike,
 * and `resident_designated` is only ever 1 on a standalone thread, since the
 * projection applies §7's standalone rule when it writes the column.
 *
 * **`resident_designated`, never `resident_name`** (SHARED-048, SERVER-121).
 * Routing asks whether the conversation is designated; which profile it was
 * designated with says *how* that agent works and nothing about what it owns, so
 * a general residency — no profile, `resident_name` NULL — is a lane exactly as
 * a profiled one is. The left join makes the column NULL for a plain document,
 * which is why the comparison below is `=== 1` rather than a truthiness test.
 */
const NODE_SQL = `
  SELECT threads.parent_id AS parentId,
         documents.origin AS origin,
         threads.resident_designated AS designated
  FROM documents
  LEFT JOIN threads ON threads.id = documents.id
  WHERE documents.id = ?`;

type NodeRow = {
  readonly parentId: string | null;
  readonly origin: string | null;
  readonly designated: number | null;
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
    return { parent: row.parentId, origin: row.origin, designated: row.designated === 1 };
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
 *
 * **Three things lean on this one predicate** — this function, the lane walk
 * above, `assertRecipientResolvable`'s `422` and `assertScopeIsLane`'s refusal
 * of a park — which is why it asks `resident_designated` and not
 * `resident_name`: since SHARED-048 a designation may name no profile, and a
 * predicate keyed on the profile would have made a general resident's lane
 * unroutable, unaddressable and unparkable at once, silently.
 */
export function isDesignatedRoot(db: ProjectionDb, id: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS ok FROM threads WHERE id = ? AND parent_id IS NULL AND resident_designated = 1",
    )
    .get(id) as { ok: number } | undefined;
  return row !== undefined;
}

/**
 * Has this lane's conversation been released? (SPEC.md §7's rider signed
 * 2026-08-25, SERVER-153.)
 *
 * **`isDesignatedRoot`, negated — and it is worth saying why that is enough.** A
 * lane is a designated root thread. So a lane that is no longer a designated
 * root is one whose designation went away, which is exactly what release means.
 * The orchestrator's own lane is never released: it is not a thread, so the
 * query finds nothing and the caller never asks about it anyway.
 *
 * A thread **deleted** outright answers the same way, and that is right rather
 * than incidental: its events have no owner and nobody is coming for them, so
 * they belong to the orchestrator by the same reasoning a release does.
 *
 * Nothing here consults liveness, and that is the difference between this and
 * the fallback it replaces (SERVER-152): a listener that is absent has not been
 * released, and no amount of absence releases it.
 */
export function createReleasedLaneLookup(db: ProjectionDb): LaneReleased {
  return (lane: Lane): boolean => lane !== ORCHESTRATOR_LANE && !isDesignatedRoot(db, lane);
}

/**
 * How many of a released lane's events the orchestrator is still working
 * (CONTRACT-089, SERVER-153) — `0` when none, which is the ordinary case.
 *
 * **This is the one seam the no-fallback rule leaves.** Release makes a lane's
 * pending events the orchestrator's; designating again while it is mid-way
 * through them would put a listener on the lane alongside it, and the same turns
 * get answered twice.
 *
 * **A replacement can never be refused by this, and that is not a special
 * case.** SPEC.md §7 makes designating a thread that already has a resident a
 * replacement rather than a conflict — and a thread that has a resident is not
 * released, so the orchestrator cannot be holding its events at all. The refusal
 * fires only where the thread has no resident, which is exactly where a
 * replacement is not what is happening. There is no sequence that deadlocks.
 */
export function drainingCount(db: ProjectionDb, lane: string): number {
  if (isDesignatedRoot(db, lane)) return 0;
  const row = db
    .prepare("SELECT COUNT(*) AS held FROM events WHERE lane = ? AND status = 'in-progress'")
    .get(lane) as { held: number } | undefined;
  return row?.held ?? 0;
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

/**
 * The candidate set the listing below walks: **every document in the corpus**,
 * with both of §7's edges and the designation flag, most recently updated first.
 *
 * The same left join {@link NODE_SQL} makes, read in one pass instead of one
 * primary-key hit per node, and for the reason a listing is not a climb: the
 * climb starts from one artifact and touches the two or three nodes above it,
 * while the inverse has to ask about every artifact there is. Three thousand
 * point reads to answer one question is the shape that turns a read into a
 * problem; one scan of an already-open database is 4 ms (measured, SERVER-130).
 *
 * **The order is the answer's order**, not a convenience: §7's listing puts the
 * most recently updated members first so that a truncated page holds the live
 * end of the scope, and doing it in SQL — over `documents_updated` — is what
 * lets the loop stop as soon as it has one member too many. SQLite sorts NULL
 * below every value, so an undated document falls to the end of a descending
 * sort, which is where a member nothing has ever touched belongs. `id` breaks
 * ties, so two documents written in the same second list in a stable order
 * rather than in whatever order the index happened to yield.
 */
const SCOPE_CANDIDATES_SQL = `
  SELECT documents.id AS id,
         documents.title AS title,
         documents.status AS status,
         documents.origin AS origin,
         threads.id AS threadId,
         threads.parent_id AS parentId,
         threads.resident_designated AS designated
  FROM documents
  LEFT JOIN threads ON threads.id = documents.id
  ORDER BY documents.updated DESC, documents.id ASC`;

type CandidateRow = {
  readonly id: string;
  readonly title: string;
  /** Always one of `DOC_STATUSES`: the projector parses it and defaults (`project-document.ts`). */
  readonly status: DocStatus;
  readonly origin: string | null;
  /** Non-null exactly when this document is a thread — the left join's own answer. */
  readonly threadId: string | null;
  readonly parentId: string | null;
  readonly designated: number | null;
};

/** What `GET /api/threads/{id}/scope` answers with, minus the root's own id. */
export interface ScopeListing {
  readonly members: readonly ScopeMember[];
  readonly truncated: boolean;
}

/**
 * **The inverse of {@link createLaneScopeLookup}**: given a lane, every artifact
 * whose walk lands on it (SPEC.md §7, SERVER-130).
 *
 * ## One walk, run the other way round
 *
 * There is no second rule here and there must never be one. Membership is
 * decided by running the identical {@link walkScope} over each candidate and
 * keeping the ones that answer *this* lane — so what this lists is, by
 * construction, what an event posted on that artifact would be routed by. The
 * cheap-looking alternative (climb `origin ?? parent`, or spread outwards from
 * the root over the two edges reversed) is a second implementation of §7's edge
 * order, which is the defect UI-119 cost a release to find: two copies, green in
 * both suites, each claiming to encode the other's order. `scope-parity.test.ts`
 * holds the two directions against one another over a derived corpus for exactly
 * that reason.
 *
 * `via` is likewise **reported, not re-derived**: a member reaches the scope by
 * its parent when the walk from that parent lands on this lane, and by its
 * origin otherwise. Reading it off the row instead — *"has a parent, therefore
 * `parent`"* — would mislabel a thread whose parent chain dead-ends and whose
 * origin is what actually reached the root.
 *
 * ## A query, and nothing kept
 *
 * §7 makes scope *computed, never stored*, so this is one scan and one map,
 * built and discarded per request: no membership table, nothing for
 * `db rebuild` to reconstruct, and no cache that could answer from a
 * designation the same request has just changed — the reason
 * {@link projectionLookup} keeps none either.
 *
 * What *is* memoised is the walk, for the length of this one call: the node
 * lookup answers from the scan rather than the database, and every verdict is
 * kept by id, so a chain shared by a hundred documents is climbed once and the
 * `via` question re-uses the answer the membership question already computed.
 *
 * ## Bounded, and the bound is honest
 *
 * The loop stops at the first member past {@link SCOPE_PAGE_SIZE} and says
 * `truncated`. It can stop there — rather than counting the whole scope and then
 * slicing — because the candidates arrive in the answer's own order, so a member
 * it never looked at is a member that would have been cut. That is also why
 * there is no `total`: counting is the enumeration the bound exists to prevent.
 *
 * @param root the designated thread, as its own first member (`via: "self"`).
 * The caller has already established that it exists and is designated — those
 * are the route's `404` and `409` — and passing the member rather than the id
 * means this function never has to describe a root it cannot find.
 */
export function listScopeMembers(db: ProjectionDb, root: ScopeMember): ScopeListing {
  const rows = db.prepare(SCOPE_CANDIDATES_SQL).all() as CandidateRow[];

  const nodes = new Map<string, ScopeWalkNode>(
    rows.map((row) => [
      row.id,
      { parent: row.parentId, origin: row.origin, designated: row.designated === 1 },
    ]),
  );
  // A row this scan does not hold is `absent` for {@link projectionLookup}'s
  // reason, one grain out: the scan read every document there is, so a miss is
  // proof the corpus holds no such artifact — a dangling `origin` left by a
  // deletion, or an id from another workspace.
  const lookup: ScopeWalkLookup = (id) => nodes.get(id) ?? SCOPE_NODE_ABSENT;

  const lanes = new Map<string, Lane | null>();
  const laneOf = (id: string): Lane | null => {
    const memo = lanes.get(id);
    // `null` is a remembered verdict — the orchestrator's lane — and only
    // `undefined` means nothing has been asked about this id yet.
    if (memo !== undefined) return memo;
    const walk = walkScope(id, lookup);
    const lane = walk.kind === "lane" ? walk.lane : null;
    lanes.set(id, lane);
    return lane;
  };

  const viaOf = (row: CandidateRow): ScopeMemberVia =>
    row.parentId !== null && laneOf(row.parentId) === root.id ? "parent" : "origin";

  const members: ScopeMember[] = [root];
  let truncated = false;
  for (const row of rows) {
    if (row.id === root.id) continue;
    if (laneOf(row.id) !== root.id) continue;
    if (members.length >= SCOPE_PAGE_SIZE) {
      truncated = true;
      break;
    }
    members.push({
      id: row.id,
      kind: row.threadId === null ? "doc" : "thread",
      title: row.title,
      status: row.status,
      via: viaOf(row),
    });
  }
  return { members, truncated };
}
