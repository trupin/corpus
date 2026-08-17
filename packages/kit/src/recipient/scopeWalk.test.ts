import { SCOPE_NODE_ABSENT } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { laneOf, walkToLane, type ScopeNode } from "./scopeWalk.js";

/**
 * The client's reading of SPEC.md §7's *"posting inside a designated scope
 * addresses that scope's resident; posting anywhere else addresses the
 * orchestrator"*.
 *
 * The traversal itself is `@corpus/contract`'s `walkScope` and is tested there
 * — the same function the server routes with, which is what UI-119 changed so
 * that this table and the enqueue path could no longer answer differently. What
 * is tested here is the seam: the board's three-valued lookup, the roster
 * standing in for a node read, and the shapes a composer actually meets.
 *
 * The case list is the one this file has always had. What moved is the
 * expectations: it used to certify `origin ?? parent`, in a docblock that said
 * *"in its order, because the two exist to agree"*, months after SERVER-117 had
 * replaced that with a parent-first search over both edges.
 */

const graph = (nodes: Readonly<Record<string, ScopeNode>>) => (id: string) => nodes[id];
const lanes =
  (...ids: readonly string[]) =>
  (id: string) =>
    ids.includes(id);

describe("walkToLane", () => {
  it("addresses the orchestrator from nowhere at all — the global Ask", () => {
    expect(walkToLane(null, graph({}), lanes("th_root"))).toEqual({ kind: "orchestrator" });
  });

  it("addresses the scope's resident when the message lands on the lane itself", () => {
    // Nothing has been read: the roster alone establishes that this id is a
    // designated root, so the composer can say who answers without a fetch.
    const walk = walkToLane("th_root", graph({}), lanes("th_root"));
    expect(walk).toEqual({ kind: "lane", lane: "th_root" });
  });

  it("does not consult the lane's own edges — designation wins first", () => {
    // A designated root with a parent is only reachable by hand-editing, and the
    // server answers it the same way: `if (node.designated) return current`.
    const nodes = { th_root: { origin: "th_other", parent: "doc_x" } };
    expect(walkToLane("th_root", graph(nodes), lanes("th_root", "th_other"))).toEqual({
      kind: "lane",
      lane: "th_root",
    });
  });

  it("climbs a child thread's parent chain to the scope's root", () => {
    const nodes = {
      th_child: { origin: null, parent: "th_mid" },
      th_mid: { origin: null, parent: "th_root" },
    };
    expect(walkToLane("th_child", graph(nodes), lanes("th_root"))).toEqual({
      kind: "lane",
      lane: "th_root",
    });
  });

  it("climbs a document's origin into the conversation that produced it", () => {
    // §7's point: "a conversation that produces a draft, and a comment left on
    // that draft, reach the same agent".
    const nodes = { doc_draft: { origin: "th_root", parent: null } };
    expect(walkToLane("doc_draft", graph(nodes), lanes("th_root"))).toEqual({
      kind: "lane",
      lane: "th_root",
    });
  });

  it("reaches the same lane from a comment on that document", () => {
    const nodes = {
      th_comment: { origin: null, parent: "doc_draft" },
      doc_draft: { origin: "th_root", parent: null },
    };
    expect(walkToLane("th_comment", graph(nodes), lanes("th_root"))).toEqual({
      kind: "lane",
      lane: "th_root",
    });
  });

  it("follows parent before origin, as the enqueue walk does", () => {
    // This case has not moved and its answer has: it used to expect `th_origin`,
    // under a name that said "as the enqueue walk does" while the enqueue walk
    // had been answering `th_parent` since SERVER-117. §7 gives a *thread* its
    // parent chain and being a thread on a document in scope; its own origin is
    // neither, and putting it first annexes the conversation it was opened on.
    const nodes = { th_a: { origin: "th_origin", parent: "th_parent" } };
    expect(walkToLane("th_a", graph(nodes), lanes("th_origin", "th_parent"))).toEqual({
      kind: "lane",
      lane: "th_parent",
    });
  });

  it("still reaches the origin when the parent branch reaches nothing designated", () => {
    // The other half of the same case, and the half a chain could not express:
    // preferring the parent is not abandoning the origin.
    const nodes = {
      th_a: { origin: "th_origin", parent: "doc_loose" },
      doc_loose: { origin: null, parent: null },
    };
    expect(walkToLane("th_a", graph(nodes), lanes("th_origin"))).toEqual({
      kind: "lane",
      lane: "th_origin",
    });
  });

  it("addresses the orchestrator when the chain reaches the top designated by nobody", () => {
    const nodes = {
      th_child: { origin: null, parent: "doc_note" },
      doc_note: { origin: null, parent: null },
    };
    expect(walkToLane("th_child", graph(nodes), lanes("th_root"))).toEqual({
      kind: "orchestrator",
    });
  });

  it("reports the node it has not read rather than guessing the orchestrator", () => {
    // The distinction UI-098 exists about, one grain down: "we have not read
    // this" is not "there is nothing here".
    expect(walkToLane("th_child", graph({}), lanes("th_root"))).toEqual({
      kind: "unread",
      id: "th_child",
    });
  });

  it("reports the *next* unread node once the first has been read", () => {
    const nodes = { th_child: { origin: null, parent: "doc_draft" } };
    expect(walkToLane("th_child", graph(nodes), lanes("th_root"))).toEqual({
      kind: "unread",
      id: "doc_draft",
    });
  });

  it("asks for the parent before the origin, so the fetch order is §7's too", () => {
    const nodes = { th_c: { origin: "th_o", parent: "doc_p" } };
    expect(walkToLane("th_c", graph(nodes), lanes("th_root"))).toEqual({
      kind: "unread",
      id: "doc_p",
    });
  });

  it("terminates a hand-edited cycle at the orchestrator", () => {
    // §5 makes the files the source of truth, so a pair of frontmatters can name
    // each other; the walk keeps a visited set for this reason.
    const nodes = {
      th_a: { origin: "th_b", parent: null },
      th_b: { origin: "th_a", parent: null },
    };
    expect(walkToLane("th_a", graph(nodes), lanes("th_root"))).toEqual({ kind: "orchestrator" });
  });

  it("walks a chain far deeper than the old bound of eight", () => {
    // The bound used to live in this function and answered `orchestrator` at
    // exhaustion — a confident wrong name a person could press. It is now a read
    // budget in `useScopeWalk`, and what exhausting it produces there is
    // `unread`, which withholds.
    const nodes: Record<string, ScopeNode> = {};
    for (let index = 0; index < 30; index += 1) {
      nodes[`th_${String(index)}`] = { origin: null, parent: `th_${String(index + 1)}` };
    }
    expect(walkToLane("th_0", graph(nodes), lanes("th_30"))).toEqual({
      kind: "lane",
      lane: "th_30",
    });
  });

  describe("a node the board has read and the corpus does not hold", () => {
    const missing = (nodes: Readonly<Record<string, ScopeNode>>) => (id: string) =>
      id in nodes ? nodes[id] : SCOPE_NODE_ABSENT;

    it("treats a settled 404 as a dead branch and still follows the other edge", () => {
      const nodes = {
        th_c: { origin: "th_gone", parent: "doc_draft" },
        doc_draft: { origin: "th_root", parent: null },
      };
      expect(walkToLane("th_c", missing(nodes), lanes("th_root"))).toEqual({
        kind: "lane",
        lane: "th_root",
      });
    });

    it("answers the orchestrator only when every branch is absent or undesignated", () => {
      const nodes = { th_c: { origin: "th_gone", parent: "doc_gone" } };
      expect(walkToLane("th_c", missing(nodes), lanes("th_root"))).toEqual({
        kind: "orchestrator",
      });
    });

    it("withholds where the same graph is merely unread", () => {
      // The pair that makes the third value load-bearing: identical graph, one
      // lookup that has seen the refusal and one that has not.
      const nodes = { th_c: { origin: "th_gone", parent: "doc_gone" } };
      expect(walkToLane("th_c", graph(nodes), lanes("th_root"))).toEqual({
        kind: "unread",
        id: "doc_gone",
      });
    });
  });
});

describe("laneOf", () => {
  it("names the lane, names the orchestrator, and withholds on unread", () => {
    expect(laneOf({ kind: "lane", lane: "th_root" })).toBe("th_root");
    expect(laneOf({ kind: "orchestrator" })).toBe("orchestrator");
    expect(laneOf({ kind: "unread", id: "th_child" })).toBeUndefined();
  });
});
