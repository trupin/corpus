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
// ## It is a search, not a chain
//
// §7's four clauses compose — "every thread on such a document" is the parent
// edge and the origin edge one after the other — so an artifact can have **both**
// edges out of it, and a dead end on one says nothing about the other. Following
// a single `origin ?? parentId` chain lost that: once a node had an origin its
// parent was never consulted again, even where the origin chain ended at nothing
// designated, and since `apps/cli/src/input.ts` exports `CORPUS_JOB` once per
// claimed event, *every* agent-created thread has an origin. §7's "every thread
// on such a document" was therefore unreachable for anything an agent made
// (SERVER-117, PR #48's review). The walk below is a search over both edges.
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
 * The edges out of a node, **in the order §7 sanctions them**.
 *
 * The two can name different scopes for exactly one artifact: a thread an agent
 * opened on a document belonging to some *other* conversation while its
 * `CORPUS_JOB` was set, which carries `parent` and `origin` at once. **The parent
 * wins** (user decision, 2026-08-17, overturning SHARED-044's provisional
 * adjudication on PR #48's review), for three reasons worth keeping written down:
 *
 * 1. **§7 names `origin` as a scope edge only for documents.** Its enumeration
 *    is "the thread itself; every thread whose parent chain reaches it; every
 *    *document* whose origin reaches it; and every thread on such a document" —
 *    so a *thread*'s routes into a scope are the parent chain and being a thread
 *    on a document in scope. Ranking a thread's own origin above both would
 *    invent a third route and put it first.
 * 2. **Origin-first has no beneficial case.** Every other divergence is not one:
 *    a standalone thread a job opened has no parent, so nothing is ranked; a
 *    thread whose parent is already in the writer's scope agrees either way; and
 *    a summons agrees because §7 reads lane and origin off different things. The
 *    only input where the answers differ is a thread an agent opened on another
 *    scope's document — where origin-first **annexes that conversation**, and §7
 *    says of the one crossing it does sanction that "answering a question does
 *    not annex the thread it was asked in".
 * 3. **An annexation has no remedy.** §7 offers `corpus doc detach` for a
 *    mis-filed document; an annexed thread has nothing, and the annexation is
 *    permanent — whereas the override §7 does sanction "never persists past the
 *    message it was set on".
 *
 * A thread's own origin is still an edge, just the second one: a thread *is* a
 * document (§6), so a standalone thread a job opened reaches its scope by §7's
 * document clause, which is the case where nothing is being ranked at all.
 */
const edgesOf = (node: ScopeNode): readonly string[] =>
  [node.parentId, node.origin].filter((edge): edge is string => edge !== null);

/**
 * Binds the walk to an open projection.
 *
 * **A preorder depth-first search over {@link edgesOf}, first designated node
 * wins.** The parent branch is explored to its end — *through* the origin edges
 * of the documents along it, which is how §7's "every thread on such a document"
 * is reached at all — before the starting thread's own origin is tried. So
 * "nearest" is nearest along §7's route for a thread, not fewest hops.
 *
 * **Every dead end is a dead end on its branch only.** An id this workspace does
 * not hold, a node with no edges, a cycle: each ends that branch and the search
 * continues with what it has not looked at yet. Only an exhausted search is "this
 * falls in no scope", which is the orchestrator's lane. Refusing the enqueue over
 * an unresolvable id would lose the work instead.
 *
 * **Termination, now that the search can branch.** A node is expanded at most
 * once: `visited` is checked and set when an id is **popped**, so the second
 * arrival is dropped whether it came round a cycle or down the other branch of a
 * diamond. Only an expansion pushes, and it pushes at most two ids, so the
 * frontier receives at most twice as many ids as there are distinct nodes and
 * every iteration removes one — the loop is bounded by the corpus and not by the
 * shape of the graph, which matters because §5 makes the *files* the source of
 * truth and a hand-edited pair of frontmatters can name each other. Note what is
 * **not** relied on: not acyclicity, not that the two edges are disjoint, and not
 * that a branch is finite. Iterative rather than recursive for the neighbouring
 * reason — the depth is a property of the corpus, not of this code.
 */
export function createLaneScopeLookup(db: ProjectionDb): ScopeRootLookup {
  return (payload: Record<string, unknown>): Lane => {
    const start = startOf(payload);
    if (start === null) return ORCHESTRATOR_LANE;
    // A stack, so the edge pushed last is followed first — hence `edgesOf`
    // reversed, which puts the parent branch on top.
    const frontier: string[] = [start];
    const visited = new Set<string>();
    for (let current = frontier.pop(); current !== undefined; current = frontier.pop()) {
      if (visited.has(current)) continue;
      visited.add(current);
      const row = db.prepare(NODE_SQL).get(current) as NodeRow | undefined;
      if (row === undefined) continue;
      const node: ScopeNode = {
        parentId: row.parentId,
        origin: row.origin,
        designated: row.residentName !== null,
      };
      if (node.designated) return current;
      for (const edge of [...edgesOf(node)].reverse()) frontier.push(edge);
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
