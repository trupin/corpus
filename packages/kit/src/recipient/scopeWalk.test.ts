import { describe, expect, it } from "vitest";
import { laneOf, MAX_SCOPE_WALK, walkToLane, type ScopeNode } from "./scopeWalk.js";

/**
 * The client's reading of SPEC.md §7's *"posting inside a designated scope
 * addresses that scope's resident; posting anywhere else addresses the
 * orchestrator"*.
 *
 * The table is written against the **server's** walk
 * (`apps/server/src/queue/scope.ts`), edge for edge and in its order, because
 * the two exist to agree: `origin ?? parent`, climbed until a node is a lane,
 * with the node's own designation winning before either edge is followed.
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

  it("follows origin before parent, as the enqueue walk does", () => {
    const nodes = { th_a: { origin: "th_origin", parent: "th_parent" } };
    expect(walkToLane("th_a", graph(nodes), lanes("th_origin", "th_parent"))).toEqual({
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

  it("terminates a hand-edited cycle at the orchestrator", () => {
    // §5 makes the files the source of truth, so a pair of frontmatters can name
    // each other; the server's own walk keeps a visited set for this reason.
    const nodes = {
      th_a: { origin: "th_b", parent: null },
      th_b: { origin: "th_a", parent: null },
    };
    expect(walkToLane("th_a", graph(nodes), lanes("th_root"))).toEqual({ kind: "orchestrator" });
  });

  it("stops climbing at the bound rather than reading forever", () => {
    const nodes: Record<string, ScopeNode> = {};
    for (let index = 0; index < MAX_SCOPE_WALK + 4; index += 1) {
      nodes[`th_${String(index)}`] = { origin: null, parent: `th_${String(index + 1)}` };
    }
    const deep = `th_${String(MAX_SCOPE_WALK + 4)}`;
    expect(walkToLane("th_0", graph(nodes), lanes(deep))).toEqual({ kind: "orchestrator" });
  });
});

describe("laneOf", () => {
  it("names the lane, names the orchestrator, and withholds on unread", () => {
    expect(laneOf({ kind: "lane", lane: "th_root" })).toBe("th_root");
    expect(laneOf({ kind: "orchestrator" })).toBe("orchestrator");
    expect(laneOf({ kind: "unread", id: "th_child" })).toBeUndefined();
  });
});
