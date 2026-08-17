import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";

/**
 * Where a message posted here would go by default — SPEC.md §7's *"Every
 * message has a recipient, and where you post computes it"*, computed on the
 * client for **display only**.
 *
 * ## Why this is a display and never a decision
 *
 * The default is sent by **omitting** `recipient`, so the value this walk
 * produces never reaches the wire. That is the whole reason there can be two
 * implementations of one rule without them drifting: the server's walk
 * (`apps/server/src/queue/scope.ts`) decides, and this one only says out loud
 * what the server is about to decide. A bug here shows the wrong name in a
 * composer; it cannot route a message anywhere.
 *
 * ## Scope is the walk, not a marker
 *
 * §7 makes membership *computed, never stored* — nothing carries a scope marker
 * — so this describes the walk rather than restating §7's "at most one scope"
 * guarantee, which is a property of the graph and not something this function
 * checks (SHARED-044; CLI-043 and AGENT-025 word it the same way and pin the
 * absence with a test).
 *
 * The two edges, and the order, are the server's: `origin ?? parent`, climbed
 * until a node is a lane. A node's own designation wins before either edge is
 * followed, so a designated root reached from below is the answer and its own
 * ancestors are never consulted.
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
 * console, one grain down.
 */

/** The two edges out of one node of the graph, as the server reads them. */
export interface ScopeNode {
  /**
   * SPEC.md §9.2's document origin — the thread this document was written
   * *from*, or null. Followed first, as the server follows it.
   */
  readonly origin: string | null;
  /** The document this thread comments on, or null for a document or a standalone thread. */
  readonly parent: string | null;
}

/** Reads one node from what the board holds. `undefined` means "not read yet". */
export type ScopeNodeLookup = (id: string) => ScopeNode | undefined;

/** Whether an id names a lane a message can be addressed to — a designated root thread. */
export type LanePredicate = (id: string) => boolean;

/** The walk reached a designated scope: this lane's resident answers by default. */
export interface ScopeWalkLane {
  readonly kind: "lane";
  readonly lane: Lane;
}

/** The walk reached the top with nothing designated: the orchestrator answers. */
export interface ScopeWalkOrchestrator {
  readonly kind: "orchestrator";
}

/**
 * The walk stopped on a node the board has not read. Carries the id so a caller
 * that *can* read it — {@link useScopeWalk} — knows what to ask for next, and so
 * a caller that cannot knows to say nothing rather than name a lane.
 */
export interface ScopeWalkUnread {
  readonly kind: "unread";
  readonly id: string;
}

export type ScopeWalk = ScopeWalkLane | ScopeWalkOrchestrator | ScopeWalkUnread;

/**
 * How far the walk will climb before giving up and answering `orchestrator`.
 *
 * A bound rather than a guess: the graph is acyclic by construction (§7 —
 * origin is written once, parent on create), and the visited set below already
 * terminates a hand-edited cycle. What this bounds is *requests*, because each
 * unread node costs the caller a read; a corpus whose comment chains run deeper
 * than this answers with the lane its own enqueue would have chosen only for the
 * first {@link MAX_SCOPE_WALK} levels, and the send is unaffected either way.
 */
export const MAX_SCOPE_WALK = 8;

/**
 * Climbs from `start` to the lane a message posted there is addressed to.
 *
 * `start` is the conversation the message lands in: the thread being replied to,
 * the thread a child comment hangs off, or the document a selection comment is
 * on. `null` — the global composer's Ask, which creates a standalone thread that
 * is in no scope by construction — is the orchestrator without a walk.
 */
export function walkToLane(
  start: string | null,
  lookup: ScopeNodeLookup,
  isLane: LanePredicate,
): ScopeWalk {
  let current = start;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current) && visited.size < MAX_SCOPE_WALK) {
    visited.add(current);
    // A node's own designation wins before either edge is followed — the
    // server's `if (node.designated) return current` read from the other side.
    if (isLane(current)) return { kind: "lane", lane: current };
    const node = lookup(current);
    if (node === undefined) return { kind: "unread", id: current };
    current = node.origin ?? node.parent;
  }
  return { kind: "orchestrator" };
}

/** The lane a walk names, for a caller that only needs the answer. */
export function laneOf(walk: ScopeWalk): Lane | undefined {
  if (walk.kind === "lane") return walk.lane;
  return walk.kind === "orchestrator" ? ORCHESTRATOR_LANE : undefined;
}
