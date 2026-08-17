import {
  laneOfScopeWalk,
  SCOPE_NODE_ABSENT,
  SCOPE_NODE_UNREAD,
  walkScope,
  type Lane,
  type ScopeWalk,
  type ScopeWalkLookup,
} from "@corpus/contract";

/**
 * Where a message posted here would go by default — SPEC.md §7's *"Every
 * message has a recipient, and where you post computes it"*, stated in a
 * composer before anything is sent.
 *
 * ## There is no second implementation, and that is the point
 *
 * The traversal is `@corpus/contract`'s {@link walkScope} — **the identical
 * function `apps/server/src/queue/scope.ts` routes with**. What is left here is
 * the seam: turning what the board happens to hold into the node shape that walk
 * reads.
 *
 * There used to be a copy, and this docblock used to justify it: a default
 * nobody touched is sent by *omitting* `recipient`, so a wrong verdict here was
 * only ever a wrong label. That justification stopped being true twice over.
 * UI-118 made an explicit pick reach the wire, and `queue/lanes.ts` returns it
 * verbatim; and the copy had by then been running the `origin ?? parent` chain
 * for a release after SERVER-117 replaced it with a search over both edges —
 * green in both suites, each file's comments claiming to encode the other's
 * order (UI-119). A composer said *"Orchestrator will answer"* about a
 * conversation the server routed to Ana, a person pressed the row they had just
 * read, and Ana never heard about the conversation on the draft she wrote.
 *
 * **What a bug here still does.** It shows the wrong name in a composer, and —
 * because that name is what a person reads before deciding whether to say
 * otherwise — it can talk somebody out of a pick they would have made, or into
 * one they would not, which a pick then puts on the wire
 * (`useComposerRecipient`).
 *
 * ## Scope is the walk, not a marker
 *
 * §7 makes membership *computed, never stored* — nothing carries a scope marker
 * — so this describes the walk rather than restating §7's "at most one scope"
 * guarantee, which is a property of the graph and not something this function
 * checks (SHARED-044; CLI-043 and AGENT-025 word it the same way and pin the
 * absence with a test).
 *
 * ## What the client cannot see, and why it degrades rather than guesses
 *
 * `Thread` and `ThreadSummary` carry `parent` and `resident` but **not**
 * `origin` (`packages/contract/src/schemas/thread.ts`); a thread's origin is
 * only on the wire through `GET /api/docs/{id}`, because a thread is a document
 * (§6). The lookup this walk is given therefore supplies both edges per node
 * from whichever reads the board already holds, and answers `undefined` for a
 * node it has not read — which produces {@link ScopeWalkUnread} rather than a
 * verdict. Unread is not "orchestrator": naming the orchestrator from a read
 * that has not landed is exactly the unevidenced claim UI-098 removed from the
 * console, one grain down. It is also not *absent*: the server's walk treats a
 * row the corpus does not hold as a dead branch and carries on, and the board
 * can only make that claim about a read it has seen refused — which is
 * {@link ScopeNodeLookup}'s third answer.
 */

/** The two edges out of one node of the graph, as the walk reads them. */
export interface ScopeNode {
  /**
   * SPEC.md §9.2's document origin — the thread this document was written
   * *from*, or null. The **second** edge tried: §7 gives a thread its parent
   * chain first (see {@link walkScope}).
   */
  readonly origin: string | null;
  /** The document this thread comments on, or null for a document or a standalone thread. */
  readonly parent: string | null;
}

/**
 * The board's answer about one id, and it has three shapes rather than two.
 *
 * `undefined` is *not read yet* — the board has not fetched this node, and the
 * walk withholds. {@link SCOPE_NODE_ABSENT} is *this corpus does not hold it*,
 * which only a settled `404` can establish, and which the walk treats as a dead
 * branch exactly as the server's projection miss does. Collapsing the two would
 * either invent a claim out of a pending read or strand the walk forever on a
 * dangling `origin` the server would simply have walked past.
 */
export type ScopeNodeLookup = (id: string) => ScopeNode | typeof SCOPE_NODE_ABSENT | undefined;

/** Whether an id names a lane a message can be addressed to — a designated root thread. */
export type LanePredicate = (id: string) => boolean;

export type {
  ScopeWalk,
  ScopeWalkLane,
  ScopeWalkOrchestrator,
  ScopeWalkUnread,
} from "@corpus/contract";
export { SCOPE_NODE_ABSENT } from "@corpus/contract";

/**
 * Climbs from `start` to the lane a message posted there is addressed to.
 *
 * `start` is the conversation the message lands in: the thread being replied to,
 * the thread a child comment hangs off, or the document a selection comment is
 * on. `null` — the global composer's Ask, which creates a standalone thread that
 * is in no scope by construction — is the orchestrator without a walk.
 *
 * **Designation is answered from the roster, ahead of any node read.** That is
 * not a deviation from the server, which asks `resident_name` of the row it has
 * just read: `GET /api/agents` lists designated roots and only those, so an id
 * the roster names *is* a row with a resident, and answering from it lets a
 * composer inside its own designated thread say who answers without waiting on a
 * document fetch. Its edges are never consulted either way — the server returns
 * on `node.designated` before it pushes anything.
 */
export function walkToLane(
  start: string | null,
  lookup: ScopeNodeLookup,
  isLane: LanePredicate,
): ScopeWalk {
  const nodes: ScopeWalkLookup = (id) => {
    if (isLane(id)) return { parent: null, origin: null, designated: true };
    const node = lookup(id);
    if (node === SCOPE_NODE_ABSENT) return SCOPE_NODE_ABSENT;
    if (node === undefined) return SCOPE_NODE_UNREAD;
    return { parent: node.parent, origin: node.origin, designated: false };
  };
  return walkScope(start, nodes);
}

/** The lane a walk names, for a caller that only needs the answer. */
export function laneOf(walk: ScopeWalk): Lane | undefined {
  return laneOfScopeWalk(walk);
}
