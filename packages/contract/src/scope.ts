/**
 * SPEC.md §7's **scope walk** — the one implementation, published from here
 * because two applications have to answer the same question and neither may
 * import the other (UI-119).
 *
 * ## What a scope is, and why nothing stores one
 *
 * > The **scope** of a designated thread is: the thread itself; every thread
 * > whose parent chain reaches it; every document whose **origin** (§9.2)
 * > reaches it; and every thread on such a document. … **Scope is computed,
 * > never stored.**
 *
 * So membership is a walk **up**, made fresh every time it is asked, and the
 * only two edges it may follow are the two §7 names: a thread's `parent` and a
 * document's `origin`. A thread designated *after* a document was written
 * captures that document retroactively, and releasing a resident needs nothing
 * undone.
 *
 * ## It is a search, not a chain
 *
 * §7's four clauses compose — "every thread on such a document" is the parent
 * edge and the origin edge one after the other — so an artifact can have
 * **both** edges out of it, and a dead end on one says nothing about the other.
 * Following a single `origin ?? parent` chain lost that: once a node had an
 * origin its parent was never consulted again, and since `apps/cli`'s
 * `input.ts` exports `CORPUS_JOB` once per claimed event, *every* agent-created
 * thread has an origin. §7's "every thread on such a document" was therefore
 * unreachable for anything an agent made (SERVER-117, PR #48's review).
 *
 * ## Why this is in the contract and not in either application
 *
 * `apps/server` decides the lane an event is stamped with; `packages/kit`'s
 * composer *states* the same verdict to a person before they post, and since
 * UI-118 a pick a person makes on the strength of that statement reaches the
 * wire verbatim. So the two are not "a rule and a hint about it" — they are one
 * rule read by two consumers, and the version that lived in the kit went on
 * running `origin ?? parent` for a whole release after SERVER-117 deleted it,
 * green in both suites, each file's comments claiming to encode the other's
 * order (UI-119).
 *
 * The alternative — a fixture table run through both implementations, which is
 * what `scripts/stub-server-parity.test.ts` does for anchor resolution — is not
 * available here: no workspace in this repo may import `apps/server` *and*
 * `packages/kit`, and a test that pins two copies only pins the rows somebody
 * thought to write. That parity test's own docblock names the direction —
 * *"a rule that becomes shared code should lose its fixture"* — and this is that
 * move, taken for the same reason CONTRACT-044 moved §6's turn-heading grammar
 * here.
 *
 * What did **not** move: reading the nodes. The server reads its projection, the
 * kit reads the board's cache, and the shapes of those reads are as different as
 * the failures they can have. {@link ScopeWalkLookup} is the seam, and it is
 * three-valued for exactly that reason (below).
 */

import { ORCHESTRATOR_LANE } from "./schemas/lane.js";

/**
 * One node of the graph: the two edges out of it, and whether it is a lane in
 * its own right.
 *
 * A thread *is* a document (§6), so one node type answers for both kinds and the
 * walk never needs to know which it is looking at. `parent` is null for a
 * document and for a standalone thread alike; `designated` is only ever true for
 * a standalone thread, because §7's standalone rule is applied by whoever writes
 * the designation — not here.
 */
export interface ScopeWalkNode {
  readonly parent: string | null;
  readonly origin: string | null;
  readonly designated: boolean;
}

/**
 * A node the corpus does not hold: a deleted thread, an id from another
 * workspace, a hand-edited frontmatter naming nothing. **A dead end on its own
 * branch and never a verdict about the artifact** — the search continues with
 * what it has not looked at yet.
 */
export const SCOPE_NODE_ABSENT = "absent";

/**
 * A node the caller **has not read**, which is not the same claim as
 * {@link SCOPE_NODE_ABSENT} and must never be collapsed into it.
 *
 * The server never answers this: a projection read either finds the row or
 * proves it is not there. A client does, constantly — the board holds the
 * documents it has opened and nothing else — and answering "absent" for a node
 * it merely has not fetched would let a walk conclude *orchestrator* from a read
 * that has not landed. That is the unevidenced claim UI-098 removed from the
 * console, one grain down, so the walk stops and says which id it stopped on.
 */
export const SCOPE_NODE_UNREAD = "unread";

/** What a lookup may answer about one id. */
export type ScopeWalkLookup = (
  id: string,
) => ScopeWalkNode | typeof SCOPE_NODE_ABSENT | typeof SCOPE_NODE_UNREAD;

/** The walk reached a designated scope: this lane's resident answers. */
export interface ScopeWalkLane {
  readonly kind: "lane";
  readonly lane: string;
}

/** The search was exhausted with nothing designated: the orchestrator answers. */
export interface ScopeWalkOrchestrator {
  readonly kind: "orchestrator";
}

/**
 * The walk stopped on a node the caller has not read. Carries the id, so a
 * caller that *can* read it knows what to ask for next and a caller that cannot
 * knows to say nothing rather than name a lane.
 */
export interface ScopeWalkUnread {
  readonly kind: "unread";
  readonly id: string;
}

export type ScopeWalk = ScopeWalkLane | ScopeWalkOrchestrator | ScopeWalkUnread;

/**
 * The edges out of a node, **in the order §7 sanctions them**.
 *
 * The two can name different scopes for exactly one artifact: a thread an agent
 * opened on a document belonging to some *other* conversation while its
 * `CORPUS_JOB` was set, which carries `parent` and `origin` at once. **The
 * parent wins** (user decision, 2026-08-17, overturning SHARED-044's provisional
 * adjudication on PR #48's review), for three reasons worth keeping written
 * down:
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
function edgesOf(node: ScopeWalkNode): readonly string[] {
  return [node.parent, node.origin].filter((edge): edge is string => edge !== null);
}

/**
 * Climbs from `start` to the lane a message posted there is addressed to.
 *
 * `start` is the conversation the message lands in: the thread being replied to,
 * the thread a child comment hangs off, or the document a `doc.edited` names.
 * `null` — nothing at all, which is the global composer's Ask and an event whose
 * payload names no artifact — is the orchestrator without a walk.
 *
 * **A preorder depth-first search over {@link edgesOf}, first designated node
 * wins.** The parent branch is explored to its end — *through* the origin edges
 * of the documents along it, which is how §7's "every thread on such a document"
 * is reached at all — before the starting thread's own origin is tried. So
 * "nearest" is nearest along §7's route for a thread, not fewest hops.
 *
 * **Every dead end is a dead end on its branch only.** An id the corpus does not
 * hold, a node with no edges, a cycle: each ends that branch and the search
 * continues. Only an *exhausted* search is "this falls in no scope", which is
 * the orchestrator's lane. Refusing over an unresolvable id would lose the work
 * instead.
 *
 * **Termination, now that the search can branch.** A node is expanded at most
 * once: `visited` is checked and set when an id is **popped**, so the second
 * arrival is dropped whether it came round a cycle or down the other branch of a
 * diamond. Only an expansion pushes, and it pushes at most two ids, so the
 * frontier receives at most twice as many ids as there are distinct nodes and
 * every iteration removes one — the loop is bounded by the corpus and not by the
 * shape of the graph, which matters because §5 makes the *files* the source of
 * truth and a hand-edited pair of frontmatters can name each other. Note what is
 * **not** relied on: not acyclicity, not that the two edges are disjoint, and
 * not that a branch is finite. Iterative rather than recursive for the
 * neighbouring reason — the depth is a property of the corpus, not of this code.
 *
 * **Unbounded, deliberately.** A step is one indexed read on the server and one
 * cached read in the browser, and a bound is a way for two callers of this
 * function to disagree about a real corpus — which is precisely the defect
 * UI-119 fixed. A caller that must bound its *reads* bounds them where the reads
 * are (`useScopeWalk`), by declining to fetch further; the walk then stops at
 * {@link ScopeWalkUnread}, which withholds, rather than answering something else.
 */
export function walkScope(start: string | null, lookup: ScopeWalkLookup): ScopeWalk {
  if (start === null) return { kind: "orchestrator" };
  // A stack, so the edge pushed last is followed first — hence `edgesOf`
  // reversed, which puts the parent branch on top.
  const frontier: string[] = [start];
  const visited = new Set<string>();
  for (let current = frontier.pop(); current !== undefined; current = frontier.pop()) {
    if (visited.has(current)) continue;
    visited.add(current);
    const node = lookup(current);
    if (node === SCOPE_NODE_UNREAD) return { kind: "unread", id: current };
    if (node === SCOPE_NODE_ABSENT) continue;
    if (node.designated) return { kind: "lane", lane: current };
    for (const edge of [...edgesOf(node)].reverse()) frontier.push(edge);
  }
  return { kind: "orchestrator" };
}

/**
 * The lane a finished walk names, for a caller with nothing to do about an
 * unread node.
 *
 * `undefined` is the withheld answer, and it is not `ORCHESTRATOR_LANE`: a
 * caller that cannot read further must say nothing rather than name the lane a
 * completed walk *might* have reached.
 */
export function laneOfScopeWalk(walk: ScopeWalk): string | undefined {
  if (walk.kind === "lane") return walk.lane;
  return walk.kind === "orchestrator" ? ORCHESTRATOR_LANE : undefined;
}
