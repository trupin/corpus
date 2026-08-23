import { describe, expect, it } from "vitest";
import {
  closeAllPaths,
  closeCol,
  closeWholePath,
  detachPath,
  docAtKey,
  EMPTY_BOARD_STRIP,
  newPathRight,
  openDocsOn,
  openFromPath,
  openFromView,
  openHereInPath,
  openLoose,
  originDocOf,
  parsePathKey,
  pathColumnCount,
  pathColumnKey,
  pathsOf,
  readBoardStrip,
  reconcileStrip,
  restartPathHere,
  setPathColStack,
  setPathColWidth,
  type BoardStrip,
  type PathItem,
  type QueryItem,
} from "./strip";

/**
 * The acts are the contract `design/navigation.html` prototypes (SPEC.md §10,
 * rider 3), ported as pure functions — which is what makes the loop rule and
 * the replacement rule testable here, without a DOM.
 */

const q = (view: string): QueryItem => ({ kind: "query", view, scroll: 0, nav: [] });

function board(items: readonly (QueryItem | PathItem)[], seq = 100): BoardStrip {
  return { seq, strip: items };
}

const views = (b: BoardStrip): readonly string[] =>
  b.strip.map((item) => (item.kind === "query" ? `q:${item.view}` : `p${String(item.id)}`));

describe("keys", () => {
  it("round-trips a path column key, in a space no slot id can reach", () => {
    expect(pathColumnKey(3, 1)).toBe("path:3:1");
    expect(parsePathKey("path:3:1")).toEqual({ pathId: 3, index: 1 });
  });

  it.each(["doc_a", "doc_view#2", "path:", "path:x:0", "path:1:-1", "path:1"])(
    "reads %s as not-a-path-key",
    (key) => {
      expect(parsePathKey(key)).toBeNull();
    },
  );
});

describe("openFromView — a path hangs off the row (rider 3)", () => {
  it("opens a new path directly right of the row's column", () => {
    const result = openFromView(board([q("view_a"), q("view_b")]), "view_a", "doc_x");
    expect(views(result.board)).toEqual(["q:view_a", "p100", "q:view_b"]);
    const path = pathsOf(result.board)[0];
    expect(path?.origin).toEqual({ view: "view_a", doc: "doc_x" });
    expect(path?.cols).toEqual([{ stack: [{ docId: "doc_x", scrollY: 0 }] }]);
    expect(result.focus).toBe("path:100:0");
    expect(result.board.seq).toBe(101);
    expect(result.recentred).toBe(false);
  });

  it("replaces the whole path on a second pick from the same column", () => {
    const first = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const grown = openFromPath(first.board, 100, 0, "doc_y");
    const replaced = openFromView(grown.board, "view_a", "doc_z");
    const path = pathsOf(replaced.board)[0];
    // Same path identity, new root: the chain was replaced, not stacked.
    expect(path?.id).toBe(100);
    expect(path?.origin).toEqual({ view: "view_a", doc: "doc_z" });
    expect(path?.cols).toEqual([{ stack: [{ docId: "doc_z", scrollY: 0 }] }]);
  });

  it("re-centres instead of opening a document already in the path", () => {
    const first = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const grown = openFromPath(first.board, 100, 0, "doc_y");
    const again = openFromView(grown.board, "view_a", "doc_y");
    expect(again.recentred).toBe(true);
    expect(again.focus).toBe("path:100:1");
    // Nothing closed, nothing changed.
    expect(again.board).toBe(grown.board);
  });

  it("carries a reveal on the path's first entry", () => {
    const reveal = { kind: "item", exact: "Call the plumber" } as const;
    const result = openFromView(board([q("view_a")]), "view_a", "doc_x", reveal);
    expect(pathsOf(result.board)[0]?.cols[0]?.stack[0]?.reveal).toEqual(reveal);
  });

  it("lands loose when the named view is not on the strip", () => {
    const result = openFromView(board([q("view_a")]), "view_gone", "doc_x");
    expect(views(result.board)).toEqual(["p100", "q:view_a"]);
    expect(pathsOf(result.board)[0]?.origin).toBeNull();
  });
});

describe("openFromPath — a link continues the path right", () => {
  it("truncates everything after the column and appends", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    const three = openFromPath(two.board, 100, 1, "doc_z");
    // Following from the FIRST column replaces everything after it.
    const replaced = openFromPath(three.board, 100, 0, "doc_w");
    expect(pathsOf(replaced.board)[0]?.cols.map((col) => col.stack.at(-1)?.docId)).toEqual([
      "doc_x",
      "doc_w",
    ]);
    expect(replaced.focus).toBe("path:100:1");
  });

  it("stamps the column being left with the scroll it was at", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y", { fromScrollY: 240 });
    expect(pathsOf(two.board)[0]?.cols[0]?.stack.at(-1)?.scrollY).toBe(240);
  });

  it("re-centres on a document already in the path, closing nothing", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    const loop = openFromPath(two.board, 100, 1, "doc_x");
    expect(loop.recentred).toBe(true);
    expect(loop.focus).toBe("path:100:0");
    expect(loop.board).toBe(two.board);
  });
});

describe("openHereInPath — ⌥↵'s in-place navigation", () => {
  it("pushes onto the column's own stack and truncates to its right", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    const here = openHereInPath(two.board, 100, 0, "doc_z");
    const path = pathsOf(here.board)[0];
    expect(path?.cols).toHaveLength(1);
    expect(path?.cols[0]?.stack.map((entry) => entry.docId)).toEqual(["doc_x", "doc_z"]);
    expect(here.focus).toBe("path:100:0");
  });

  it("re-centres on a loop rather than pushing a duplicate", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    const loop = openHereInPath(two.board, 100, 0, "doc_y");
    expect(loop.recentred).toBe(true);
    expect(loop.board).toBe(two.board);
  });
});

describe("openLoose — an open with no origin lands at the left edge", () => {
  it("inserts a loose path before everything", () => {
    const result = openLoose(board([q("view_a"), q("view_b")]), "doc_x");
    expect(views(result.board)).toEqual(["p100", "q:view_a", "q:view_b"]);
    expect(pathsOf(result.board)[0]?.origin).toBeNull();
    expect(result.focus).toBe("path:100:0");
  });

  it("re-centres when any path on the board already shows the document", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const loop = openLoose(one.board, "doc_x");
    expect(loop.recentred).toBe(true);
    expect(loop.focus).toBe("path:100:0");
    expect(loop.board).toBe(one.board);
  });

  it("does not treat a query column's in-place reader as a loop (the rule is per path)", () => {
    const withReader = board([
      { kind: "query", view: "view_a", scroll: 0, nav: [{ docId: "doc_x", scrollY: 0 }] },
    ]);
    const result = openLoose(withReader, "doc_x");
    expect(result.recentred).toBe(false);
    expect(pathsOf(result.board)).toHaveLength(1);
  });
});

describe("restart, new-right, detach", () => {
  it("restartPathHere makes this column the root of a loose path in place", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    const restarted = restartPathHere(two.board, 100, 1);
    const path = pathsOf(restarted.board)[0];
    expect(path?.origin).toBeNull();
    expect(path?.cols).toEqual([{ stack: [{ docId: "doc_y", scrollY: 0 }] }]);
    expect(restarted.focus).toBe("path:100:0");
  });

  it("newPathRight opens a loose sibling rooted at this column's document", () => {
    const one = openFromView(board([q("view_a"), q("view_b")]), "view_a", "doc_x");
    const result = newPathRight(one.board, 100, 0);
    expect(views(result.board)).toEqual(["q:view_a", "p100", "p101", "q:view_b"]);
    const fresh = pathsOf(result.board)[1];
    expect(fresh?.origin).toBeNull();
    expect(fresh?.cols[0]?.stack[0]?.docId).toBe("doc_x");
    // The original keeps its origin: keep means keep.
    expect(pathsOf(result.board)[0]?.origin).not.toBeNull();
  });

  it("detachPath drops the origin and nothing else", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const kept = detachPath(one.board, 100);
    expect(pathsOf(kept)[0]?.origin).toBeNull();
    expect(pathsOf(kept)[0]?.cols).toEqual(pathsOf(one.board)[0]?.cols);
    // Already loose: the same object comes back.
    expect(detachPath(kept, 100)).toBe(kept);
  });
});

describe("closing", () => {
  function threeCols(): BoardStrip {
    const one = openFromView(board([q("view_a"), q("view_b")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    return openFromPath(two.board, 100, 1, "doc_z").board;
  }

  it("closeCol mid-path truncates this column and everything after it", () => {
    const result = closeCol(threeCols(), 100, 1);
    expect(pathsOf(result.board)[0]?.cols.map((col) => col.stack.at(-1)?.docId)).toEqual(["doc_x"]);
    expect(result.focus).toBe("path:100:0");
  });

  it("closeCol on the first column closes the whole path, focusing the neighbour", () => {
    const result = closeCol(threeCols(), 100, 0);
    expect(pathsOf(result.board)).toHaveLength(0);
    expect(result.focus).toBe("view_a");
  });

  it("closeWholePath is the first column's close", () => {
    expect(closeWholePath(threeCols(), 100)).toEqual(closeCol(threeCols(), 100, 0));
  });

  it("closeAllPaths clears every path on the board and counts them", () => {
    const withLoose = openLoose(threeCols(), "doc_w");
    const result = closeAllPaths(withLoose.board);
    expect(result.closed).toBe(2);
    expect(pathsOf(result.board)).toHaveLength(0);
    expect(result.board.strip.map((item) => (item.kind === "query" ? item.view : ""))).toEqual([
      "view_a",
      "view_b",
    ]);
    expect(result.focus).toBe("view_a");
  });

  it("closeAllPaths on a path-free board changes nothing", () => {
    const b = board([q("view_a")]);
    expect(closeAllPaths(b)).toEqual({ board: b, focus: null, closed: 0 });
  });
});

describe("setPathColStack — the mounted Reader's bridge", () => {
  it("treats an emptied stack as closing the column", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const result = setPathColStack(one.board, 100, 0, []);
    expect(pathsOf(result.board)).toHaveLength(0);
    expect(result.focus).toBe("view_a");
  });

  it("treats a shorter stack as Back: pop, and truncate the path right", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const here = openHereInPath(one.board, 100, 0, "doc_y");
    const grown = openFromPath(here.board, 100, 0, "doc_z");
    const back = setPathColStack(grown.board, 100, 0, [{ docId: "doc_x", scrollY: 0 }]);
    const path = pathsOf(back.board)[0];
    expect(path?.cols).toHaveLength(1);
    expect(path?.cols[0]?.stack.map((entry) => entry.docId)).toEqual(["doc_x"]);
    expect(back.focus).toBe("path:100:0");
  });

  it("treats an equal-length stack as an in-place rewrite: no focus, no truncation", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const grown = openFromPath(one.board, 100, 0, "doc_y");
    const captured = setPathColStack(grown.board, 100, 0, [{ docId: "doc_x", scrollY: 300 }]);
    expect(captured.focus).toBeNull();
    expect(pathsOf(captured.board)[0]?.cols).toHaveLength(2);
    expect(pathsOf(captured.board)[0]?.cols[0]?.stack[0]?.scrollY).toBe(300);
  });
});

describe("setPathColWidth", () => {
  it("stores a width on the one column", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const sized = setPathColWidth(one.board, 100, 0, 520);
    expect(pathsOf(sized)[0]?.cols[0]?.width).toBe(520);
  });
});

describe("derivations", () => {
  it("originDocOf names the row the column's path hangs off, and only that", () => {
    const one = openFromView(board([q("view_a"), q("view_b")]), "view_a", "doc_x");
    expect(originDocOf(one.board, "view_a")).toBe("doc_x");
    expect(originDocOf(one.board, "view_b")).toBeNull();
    const loose = detachPath(one.board, 100);
    expect(originDocOf(loose, "view_a")).toBeNull();
  });

  it("openDocsOn is every top: path columns and in-place readers alike", () => {
    const withReader = board([
      { kind: "query", view: "view_a", scroll: 0, nav: [{ docId: "doc_r", scrollY: 0 }] },
    ]);
    const one = openFromView(withReader, "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    expect([...openDocsOn(two.board)].sort()).toEqual(["doc_r", "doc_x", "doc_y"]);
  });

  it("docAtKey answers for both kinds of key", () => {
    const withReader = board([
      { kind: "query", view: "view_a", scroll: 0, nav: [{ docId: "doc_r", scrollY: 0 }] },
    ]);
    const one = openFromView(withReader, "view_a", "doc_x");
    expect(docAtKey(one.board, "view_a")).toBe("doc_r");
    expect(docAtKey(one.board, "path:100:0")).toBe("doc_x");
    expect(docAtKey(one.board, "path:9:0")).toBeNull();
  });

  it("pathColumnCount counts reader columns across every path", () => {
    const one = openFromView(board([q("view_a")]), "view_a", "doc_x");
    const two = openFromPath(one.board, 100, 0, "doc_y");
    const three = openLoose(two.board, "doc_z");
    expect(pathColumnCount(three.board)).toBe(3);
  });
});

describe("reconcileStrip — the prototype's boardState, ported", () => {
  it("keeps query items in the board's order and creates the missing ones", () => {
    const b = board([q("view_b"), q("view_a")]);
    const next = reconcileStrip(b, ["view_a", "view_b", "view_c"]);
    expect(next.strip.map((item) => (item.kind === "query" ? item.view : "?"))).toEqual([
      "view_a",
      "view_b",
      "view_c",
    ]);
  });

  it("keeps a path in place relative to the column before it", () => {
    const one = openFromView(board([q("view_a"), q("view_b")]), "view_a", "doc_x");
    const next = reconcileStrip(one.board, ["view_b", "view_a"]);
    expect(views(next)).toEqual(["q:view_b", "q:view_a", "p100"]);
  });

  it("re-anchors a dead column's paths to the surviving column on their left", () => {
    const one = openFromView(board([q("view_a"), q("view_b")]), "view_b", "doc_x");
    const next = reconcileStrip(one.board, ["view_a"]);
    // view_b left the board; its path survives, after view_a (the user's
    // 2026-08-22 decision: the path stays where it is).
    expect(views(next)).toEqual(["q:view_a", "p100"]);
  });

  it("keeps a loose path at the left edge", () => {
    const one = openLoose(board([q("view_a")]), "doc_x");
    const next = reconcileStrip(one.board, ["view_a", "view_b"]);
    expect(views(next)).toEqual(["p100", "q:view_a", "q:view_b"]);
  });

  it("returns the same object when nothing changed", () => {
    const one = openFromView(board([q("view_a"), q("view_b")]), "view_a", "doc_x");
    expect(reconcileStrip(one.board, ["view_a", "view_b"])).toBe(one.board);
  });
});

describe("readBoardStrip", () => {
  it("answers empty for anything that is not a strip", () => {
    for (const value of [null, 4, "strip", { strip: "nope" }]) {
      expect(readBoardStrip(value)).toEqual(EMPTY_BOARD_STRIP);
    }
  });

  it("drops a stored path whose columns are all unreadable", () => {
    const read = readBoardStrip({
      seq: 5,
      strip: [{ kind: "path", id: 1, origin: null, cols: [{ stack: [] }, "x"] }],
    });
    expect(read.strip).toEqual([]);
  });

  it("drops an origin that does not name both a view and a doc", () => {
    const read = readBoardStrip({
      seq: 5,
      strip: [
        {
          kind: "path",
          id: 1,
          origin: { view: "view_a" },
          cols: [{ stack: [{ docId: "doc_x" }] }],
        },
      ],
    });
    expect(pathsOf(read)[0]?.origin).toBeNull();
  });
});
