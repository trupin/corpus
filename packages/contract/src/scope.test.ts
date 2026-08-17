import { describe, expect, it } from "vitest";
import {
  laneOfScopeWalk,
  SCOPE_NODE_ABSENT,
  SCOPE_NODE_UNREAD,
  walkScope,
  type ScopeWalkLookup,
  type ScopeWalkNode,
} from "./scope.js";

/**
 * SPEC.md §7's scope walk, over graphs written out as literals.
 *
 * This is the whole rule, tested once. `apps/server/src/queue/scope.test.ts`
 * still runs the same shapes through a real projection, because what it is
 * testing there is the *SQL* — that `documents.origin`, `threads.parent_id` and
 * `threads.resident_name` land in the node this walk reads — and
 * `packages/kit`'s tests do the same for the board's caches. Neither re-states
 * the traversal, which is what let the two disagree for a release (UI-119).
 */

/** A corpus: every id it holds, and nothing else exists. */
const corpus =
  (nodes: Readonly<Record<string, ScopeWalkNode>>): ScopeWalkLookup =>
  (id) =>
    nodes[id] ?? SCOPE_NODE_ABSENT;

const node = (edges: Partial<ScopeWalkNode> = {}): ScopeWalkNode => ({
  parent: null,
  origin: null,
  designated: false,
  ...edges,
});

describe("walkScope", () => {
  it("answers the orchestrator for a message that starts nowhere", () => {
    expect(walkScope(null, corpus({}))).toEqual({ kind: "orchestrator" });
  });

  it("answers the lane a message posted in it lands on", () => {
    const graph = corpus({ th_root: node({ designated: true }) });
    expect(walkScope("th_root", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("does not consult a designated node's own edges", () => {
    // The server's `if (node.designated) return current`, before anything is
    // pushed: a designated root reached from below is the answer, and its own
    // ancestors are never asked.
    const graph = corpus({
      th_root: node({ designated: true, parent: "doc_x", origin: "th_other" }),
      th_other: node({ designated: true }),
    });
    expect(walkScope("th_root", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("climbs a child thread's parent chain to the scope's root", () => {
    const graph = corpus({
      th_child: node({ parent: "th_mid" }),
      th_mid: node({ parent: "th_root" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_child", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("climbs a document's origin into the conversation that produced it", () => {
    // §7's point: "a conversation that produces a draft, and a comment left on
    // that draft, reach the same agent".
    const graph = corpus({
      doc_draft: node({ origin: "th_root" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("doc_draft", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("reaches the same lane from a comment on that document", () => {
    const graph = corpus({
      th_comment: node({ parent: "doc_draft" }),
      doc_draft: node({ origin: "th_root" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_comment", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("stops at the nearest designated thread rather than the one above it", () => {
    // §7: "an artifact belongs to at most one scope".
    const graph = corpus({
      doc_leaf: node({ origin: "th_inner" }),
      th_inner: node({ origin: "th_outer", designated: true }),
      th_outer: node({ designated: true }),
    });
    expect(walkScope("doc_leaf", graph)).toEqual({ kind: "lane", lane: "th_inner" });
  });

  it("answers the orchestrator when the search is exhausted with nothing designated", () => {
    const graph = corpus({ th_child: node({ parent: "doc_note" }), doc_note: node() });
    expect(walkScope("th_child", graph)).toEqual({ kind: "orchestrator" });
  });

  it("answers the orchestrator for an id the corpus does not hold at all", () => {
    expect(walkScope("th_gone", corpus({}))).toEqual({ kind: "orchestrator" });
  });
});

/**
 * The ten shapes of the one artifact that carries **both** edges: a thread an
 * agent opened on some document while its `CORPUS_JOB` was set. Ported from
 * `apps/server/src/queue/scope.test.ts` case for case (SERVER-117, PR #48's
 * review), because these are the inputs where the deleted `origin ?? parent`
 * chain and this search give different answers — and where the client's copy of
 * it was still answering after the server had stopped (UI-119).
 *
 * The rule the block states, decided by the user 2026-08-17: **for a thread the
 * parent chain wins, and the walk falls back rather than concluding "no
 * scope".**
 */
describe("a thread whose parent and origin point at different scopes", () => {
  it("keeps a thread with the scope of the document it hangs on, not the job that opened it", () => {
    // §7: "answering a question does not annex the thread it was asked in."
    const graph = corpus({
      th_opened: node({ parent: "doc_theirs", origin: "th_mine" }),
      doc_theirs: node({ origin: "th_theirs" }),
      th_theirs: node({ designated: true }),
      th_mine: node({ designated: true }),
    });
    expect(walkScope("th_opened", graph)).toEqual({ kind: "lane", lane: "th_theirs" });
  });

  it("reaches the resident when the origin chain dead-ends and the parent chain does not", () => {
    // PR #48's reproduction, and UI-119's: the subagent opened `th_c` on Ana's
    // draft with its job set, from an ordinary orchestrator thread `th_q`.
    const graph = corpus({
      th_c: node({ parent: "doc_draft", origin: "th_q" }),
      doc_draft: node({ origin: "th_root" }),
      th_root: node({ designated: true }),
      th_q: node(),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("falls back to the origin when the parent chain dead-ends", () => {
    const graph = corpus({
      th_opened: node({ parent: "doc_loose", origin: "th_root" }),
      doc_loose: node(),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_opened", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("routes to the orchestrator only when both edges dead-end", () => {
    const graph = corpus({
      th_c: node({ parent: "doc_loose", origin: "th_q" }),
      doc_loose: node(),
      th_q: node(),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "orchestrator" });
  });

  it("answers once when both edges reach the same root", () => {
    const graph = corpus({
      th_c: node({ parent: "doc_draft", origin: "th_root" }),
      doc_draft: node({ origin: "th_root" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("treats a missing origin as a dead branch and still follows the parent", () => {
    const graph = corpus({
      th_c: node({ parent: "doc_draft", origin: "th_gone" }),
      doc_draft: node({ origin: "th_root" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("treats a missing parent as a dead branch and still follows the origin", () => {
    const graph = corpus({
      th_c: node({ parent: "doc_gone", origin: "th_root" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("prefers a distant parent chain over a designated thread one origin hop away", () => {
    // "Nearest" is measured along §7's route for a thread, not in hops.
    const graph = corpus({
      th_c: node({ parent: "doc_p", origin: "th_near" }),
      doc_p: node({ origin: "th_mid" }),
      th_mid: node({ parent: "doc_q" }),
      doc_q: node({ origin: "th_far" }),
      th_far: node({ designated: true }),
      th_near: node({ designated: true }),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "lane", lane: "th_far" });
  });

  it("escapes a cycle on the origin branch and answers from the parent branch", () => {
    // §5 makes the files the source of truth, so either branch can be a
    // hand-edited loop. A cycle costs that branch and nothing else.
    const graph = corpus({
      th_a: node({ parent: "doc_draft", origin: "th_b" }),
      th_b: node({ origin: "th_a" }),
      doc_draft: node({ origin: "th_root" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_a", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("escapes a cycle on the parent branch and answers from the origin branch", () => {
    const graph = corpus({
      th_c: node({ parent: "doc_loop", origin: "th_root" }),
      doc_loop: node({ origin: "th_c" }),
      th_root: node({ designated: true }),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("terminates when both edges converge on one undesignated node", () => {
    // Both branches meeting is what makes the visited set a termination
    // argument rather than a cycle patch: the node is expanded once.
    const graph = corpus({
      th_c: node({ parent: "doc_p", origin: "th_j" }),
      doc_p: node({ origin: "th_j" }),
      th_j: node(),
    });
    expect(walkScope("th_c", graph)).toEqual({ kind: "orchestrator" });
  });

  it("terminates on a two-node cycle with no other edge to try", () => {
    const graph = corpus({ th_a: node({ origin: "th_b" }), th_b: node({ origin: "th_a" }) });
    expect(walkScope("th_a", graph)).toEqual({ kind: "orchestrator" });
  });
});

/**
 * The third answer, which only a client ever gives. The server's projection
 * proves absence; a browser can only say "I have not read this", and the
 * difference is a claim it would otherwise be making about a lane.
 */
describe("a lookup that has not read a node", () => {
  it("stops and names the node rather than guessing", () => {
    expect(walkScope("th_child", () => SCOPE_NODE_UNREAD)).toEqual({
      kind: "unread",
      id: "th_child",
    });
  });

  it("names the *next* unread node once the first has been read", () => {
    const graph: ScopeWalkLookup = (id) =>
      id === "th_child" ? node({ parent: "doc_draft" }) : SCOPE_NODE_UNREAD;
    expect(walkScope("th_child", graph)).toEqual({ kind: "unread", id: "doc_draft" });
  });

  it("stops on the parent branch before reading the origin branch at all", () => {
    // Order matters for what gets fetched, not only for the verdict: an unread
    // parent must be asked for before the origin is even considered.
    const asked: string[] = [];
    const graph: ScopeWalkLookup = (id) => {
      asked.push(id);
      return id === "th_c" ? node({ parent: "doc_p", origin: "th_o" }) : SCOPE_NODE_UNREAD;
    };
    expect(walkScope("th_c", graph)).toEqual({ kind: "unread", id: "doc_p" });
    expect(asked).toEqual(["th_c", "doc_p"]);
  });

  it("is not absence: an unread origin withholds where a missing one falls back", () => {
    const known: Record<string, ScopeWalkNode> = {
      th_c: node({ parent: "doc_loose", origin: "th_far" }),
      doc_loose: node(),
    };
    const unread: ScopeWalkLookup = (id) => known[id] ?? SCOPE_NODE_UNREAD;
    expect(walkScope("th_c", unread)).toEqual({ kind: "unread", id: "th_far" });
    expect(walkScope("th_c", corpus(known))).toEqual({ kind: "orchestrator" });
  });
});

describe("laneOfScopeWalk", () => {
  it("names the lane, names the orchestrator, and withholds on unread", () => {
    expect(laneOfScopeWalk({ kind: "lane", lane: "th_root" })).toBe("th_root");
    expect(laneOfScopeWalk({ kind: "orchestrator" })).toBe("orchestrator");
    expect(laneOfScopeWalk({ kind: "unread", id: "th_child" })).toBeUndefined();
  });
});
