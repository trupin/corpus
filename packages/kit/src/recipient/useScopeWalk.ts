import { ORCHESTRATOR_LANE, type Lane } from "@corpus/contract";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCorpusClient, usePendingTurnStore } from "../client/context.js";
import { docQueryOptions } from "../query/useDoc.js";
import { threadQueryOptions } from "../query/useThread.js";
import { MAX_SCOPE_WALK, walkToLane, type ScopeNode, type ScopeWalk } from "./scopeWalk.js";

/**
 * SPEC.md §7's default recipient, computed from what the board already holds.
 *
 * ## It costs nothing on a workspace with no residents
 *
 * A scope root **is** a lane, so a roster with no designated lane means there is
 * no scope to be inside and the answer is the orchestrator with no walk at all —
 * no chain, no queries, no requests. That is the ordinary workspace, and it is
 * why mounting this in five composers on a document with thirty thread cards is
 * free rather than something to be careful about.
 *
 * ## When it does walk, it walks the cache
 *
 * Each node is read through the **same query options** `useDoc` and `useThread`
 * use, so a composer inside a thread card asks for nothing new: the card already
 * holds `useThread(id)` for the parent edge and `useDoc(id)` — the thread *as a
 * document* — for the origin edge, and the reader already holds the parent
 * document. Sharing the options rather than writing a second `queryFn` is not
 * tidiness: two functions under one key is a refetch that answers differently
 * from the mount, and for `threadKey` it would drop the user's own optimistic
 * turn.
 *
 * ## Unread is a state, not a default
 *
 * The chain grows one node per settled read. Until it reaches a verdict the walk
 * answers `unread`, and callers render that as *unknown* rather than as the
 * orchestrator — naming a lane from a read that has not landed is the
 * unevidenced claim UI-098 removed from the console.
 *
 * ## The gap this walk cannot see, and why it is safe
 *
 * `Thread` and `ThreadSummary` carry `parent` but not `origin`, so a thread's
 * own origin is only readable through `GET /api/docs/{id}` — which is why every
 * node is read as a document as well as a thread. Where that document read has
 * not landed, the walk says `unread` rather than following the parent edge
 * alone: following one of two edges would be a *wrong* answer where waiting is
 * merely a slow one. Nothing here reaches the wire on the ordinary path — a
 * default nobody touched is sent by **omitting** `recipient`, so the server's
 * walk is the one that decides — but this verdict is what a person reads before
 * deciding whether to pick, and a pick does reach the wire
 * (`useComposerRecipient`). Degrading to *unknown* is what keeps this walk from
 * talking anybody into or out of a choice on a read that has not landed.
 */

/** A node id names a thread when it carries the thread prefix (SPEC.md §5). */
export function isThreadId(id: string): boolean {
  return id.startsWith("th_");
}

/**
 * The lanes a message can be addressed to, minus the orchestrator's.
 *
 * The orchestrator is never a *scope*: §7 gives it every event that falls in
 * none, so its name could not appear in a parent or origin chain anyway, and
 * excluding it here is what makes "no designated lanes" mean "no walk to do".
 */
export function designatedLanes(lanes: readonly { readonly lane: Lane }[]): readonly Lane[] {
  return lanes.map((row) => row.lane).filter((lane) => lane !== ORCHESTRATOR_LANE);
}

export interface ScopeWalkInput {
  /**
   * The conversation a message posted here lands in: the thread being replied
   * to, the thread a child comment hangs off, or the document a selection
   * comment is on. `null` for the global composer's Ask, whose standalone thread
   * is in no scope by construction.
   */
  readonly start: string | null;
  /** The roster's lanes, or `undefined` while it has not answered. */
  readonly lanes: readonly { readonly lane: Lane }[] | undefined;
}

export function useScopeWalk({ start, lanes }: ScopeWalkInput): ScopeWalk {
  const client = useCorpusClient();
  const pendingTurns = usePendingTurnStore();
  const [chain, setChain] = useState<readonly string[]>(() => (start === null ? [] : [start]));
  const [walkedFrom, setWalkedFrom] = useState<string | null>(start);

  // Reset during render rather than in an effect (React's documented "adjusting
  // state when a prop changes"): a walk left pointing at the previous
  // composer's thread for one paint would name the wrong agent.
  if (walkedFrom !== start) {
    setWalkedFrom(start);
    setChain(start === null ? [] : [start]);
  }

  const designated = new Set(lanes === undefined ? [] : designatedLanes(lanes));
  // Nothing designated anywhere means no scope to be inside; the roster having
  // answered is what makes that a fact rather than an assumption.
  const walking = start !== null && lanes !== undefined && designated.size > 0;
  const nodeIds = walking && walkedFrom === start ? chain : [];
  const threadIds = nodeIds.filter(isThreadId);

  const docs = useQueries({ queries: nodeIds.map((id) => ({ ...docQueryOptions(client, id) })) });
  const threads = useQueries({
    queries: threadIds.map((id) => ({ ...threadQueryOptions(client, pendingTurns, id) })),
  });

  const origins = new Map<string, string | null>();
  nodeIds.forEach((id, index) => {
    const doc = docs[index]?.data;
    if (doc !== undefined) origins.set(id, doc.frontmatter.origin);
  });
  const parents = new Map<string, string | null>();
  threadIds.forEach((id, index) => {
    const thread = threads[index]?.data;
    if (thread !== undefined) parents.set(id, thread.parent);
  });

  const nodes = new Map<string, ScopeNode>();
  for (const id of nodeIds) {
    const origin = origins.get(id);
    if (origin === undefined) continue;
    const parent = isThreadId(id) ? parents.get(id) : null;
    if (parent === undefined) continue;
    nodes.set(id, { origin, parent });
  }

  const walk: ScopeWalk = walking
    ? walkToLane(
        start,
        (id) => nodes.get(id),
        (id) => designated.has(id),
      )
    : { kind: "orchestrator" };

  // Extending the chain is the only side effect: an unread node is one this
  // walk has not asked for yet, and asking for it is what lets the next render
  // answer. `setChain` returning the same array is React's own no-op.
  const unread = walk.kind === "unread" ? walk.id : null;
  useEffect(() => {
    if (unread === null) return;
    setChain((held) =>
      held.includes(unread) || held.length >= MAX_SCOPE_WALK ? held : [...held, unread],
    );
  }, [unread]);

  // The roster is an input to the walk, so a roster that has not answered is a
  // walk that cannot start — not one that ended at the orchestrator.
  if (start !== null && lanes === undefined) return { kind: "unread", id: start };
  return walk;
}
