/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage";
import {
  BOARD_STATE_VERSION,
  BOARD_STORAGE_KEY,
  EMPTY_BOARD_STATE,
  openDocId,
  pruneBoards,
  readBoardLocalState,
  useBoardLocalState,
  writeBoardLocalState,
  type BoardLocalState,
} from "./useBoardLocalState";
import type { QueryItem, StripItem } from "./strip";

/**
 * The v4 shape: each board's slice is its **strip** (UI-149) — an ordered list
 * of query columns and paths. `strip` is `unknown[]`-typed and the result is
 * asserted into the type, because several cases below deliberately store a
 * shape the reader must repair, and a helper that refused them could not build
 * the fixtures those cases are about.
 */
const BOARD = "board_1";
const blob = (strip: unknown[], board: string | null = null, seq = 1): BoardLocalState =>
  ({
    version: BOARD_STATE_VERSION,
    board,
    boards: { [BOARD]: { seq, strip } },
  }) as unknown as BoardLocalState;

const q = (view: string, scroll = 0, nav: unknown[] = []): unknown => ({
  kind: "query",
  view,
  scroll,
  nav,
});

/** The stored strip of one board, for assertions. */
function stripOf(state: BoardLocalState, board = BOARD): readonly StripItem[] {
  return state.boards[board]?.strip ?? [];
}

function queryItem(state: BoardLocalState, view: string): QueryItem | undefined {
  return stripOf(state).find(
    (item): item is QueryItem => item.kind === "query" && item.view === view,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("readBoardLocalState", () => {
  it("reads back what was written", () => {
    const storage = memoryStorage();
    writeBoardLocalState(
      blob([q("doc_a", 120, [{ docId: "doc_x", scrollY: 40 }])], BOARD),
      storage,
    );
    expect(readBoardLocalState(storage)).toEqual(
      blob([q("doc_a", 120, [{ docId: "doc_x", scrollY: 40 }])], BOARD),
    );
  });

  it("stores browser-local state and nothing else", () => {
    const storage = memoryStorage();
    writeBoardLocalState(blob([q("doc_a", 40, [{ docId: "doc_x", scrollY: 0 }])], BOARD), storage);
    const written = storage.getItem(BOARD_STORAGE_KEY) ?? "";
    // The review-blocking rule of SPEC.md §10: no query, no order, no column
    // identity beyond the id whose scroll this is, and no document content.
    // Paths are browser-local by rider 3, exactly like navigation stacks.
    expect(written).toBe(
      '{"version":4,"board":"board_1","boards":{"board_1":{"seq":1,"strip":' +
        '[{"kind":"query","view":"doc_a","scroll":40,"nav":[{"docId":"doc_x","scrollY":0}]}]}}}',
    );
    for (const forbidden of ["order", "title", "body", "pinned", "folder"]) {
      expect(written).not.toContain(forbidden);
    }
  });

  it("round-trips a path — origin, columns, a chosen width", () => {
    const storage = memoryStorage();
    const path = {
      kind: "path",
      id: 3,
      origin: { view: "doc_a", doc: "doc_x" },
      cols: [{ stack: [{ docId: "doc_x", scrollY: 12 }], width: 520 }],
    };
    writeBoardLocalState(blob([q("doc_a"), path], BOARD, 4), storage);
    expect(readBoardLocalState(storage)).toEqual(blob([q("doc_a"), path], BOARD, 4));
  });

  it.each([
    ["nothing stored", null],
    ["garbage", "}{ not json"],
    ["a JSON scalar", '"nope"'],
    // The v1 shape (`open: string | null`) cannot express a stack; discarded.
    ["a version-1 blob", '{"version":1,"columns":{"doc_a":{"scroll":9,"open":"doc_x"}}}'],
    // The v2 shape had one column map and no board above it. Discarded (UI-148).
    [
      "a version-2 blob",
      '{"version":2,"columns":{"doc_a":{"scroll":9,"nav":[{"docId":"doc_x","scrollY":0}]}}}',
    ],
    // The v3 shape mapped columns by slot id and could not say where a path
    // sits. Discarded by the same precedent, at the same cost (UI-149).
    [
      "a version-3 blob",
      '{"version":3,"board":"board_1","boards":{"board_1":{"columns":' +
        '{"doc_a":{"scroll":40,"nav":[]}}}}}',
    ],
  ])("degrades to defaults on %s", (_case, raw) => {
    const storage = memoryStorage(raw === null ? {} : { [BOARD_STORAGE_KEY]: raw });
    expect(readBoardLocalState(storage)).toEqual(EMPTY_BOARD_STATE);
  });

  it("repairs individual strip items rather than dropping the whole blob", () => {
    const storage = memoryStorage({
      [BOARD_STORAGE_KEY]: JSON.stringify(
        blob([
          { kind: "query", view: "doc_a", scroll: "lots", nav: "nope" },
          { kind: "query" }, // no view — dropped
          4,
          null,
          { kind: "path", id: 1, origin: null, cols: [] }, // no columns — dropped
        ]),
      ),
    });
    expect(stripOf(readBoardLocalState(storage))).toEqual([
      { kind: "query", view: "doc_a", scroll: 0, nav: [] },
    ]);
  });

  it("drops nav entries that name nothing", () => {
    const storage = memoryStorage({
      [BOARD_STORAGE_KEY]: JSON.stringify(
        blob([
          q("doc_a", 0, [{ docId: "doc_x", scrollY: "far" }, { docId: "" }, 7, { scrollY: 3 }]),
        ]),
      ),
    });
    expect(queryItem(readBoardLocalState(storage), "doc_a")?.nav).toEqual([
      { docId: "doc_x", scrollY: 0 },
    ]);
  });

  /**
   * A restored blob's `seq` must clear every stored path id, or the next path
   * would mint a duplicate key. A damaged seq re-derives from the paths.
   */
  it("repairs a seq that no longer clears the stored path ids", () => {
    const storage = memoryStorage({
      [BOARD_STORAGE_KEY]: JSON.stringify(
        blob(
          [{ kind: "path", id: 9, origin: null, cols: [{ stack: [{ docId: "doc_x" }] }] }],
          null,
          "soon" as unknown as number,
        ),
      ),
    });
    expect(readBoardLocalState(storage).boards[BOARD]?.seq).toBe(10);
  });

  /**
   * UI-037. A reveal is a pending *instruction*, and it rides the entry into
   * storage because it outlives the click that made it. What must not survive
   * is an instruction nobody can make sense of.
   */
  it("reads back a pending reveal of either kind", () => {
    const storage = memoryStorage();
    writeBoardLocalState(
      blob([
        q("doc_a", 0, [
          {
            docId: "doc_x",
            scrollY: 0,
            reveal: { kind: "item", exact: "Call the plumber", prefix: "before" },
          },
        ]),
        q("doc_b", 0, [
          { docId: "doc_y", scrollY: 0, reveal: { kind: "thread", threadId: "th_1" } },
        ]),
      ]),
      storage,
    );
    const read = readBoardLocalState(storage);
    expect(queryItem(read, "doc_a")?.nav[0]?.reveal).toEqual({
      kind: "item",
      exact: "Call the plumber",
      prefix: "before",
    });
    expect(queryItem(read, "doc_b")?.nav[0]?.reveal).toEqual({ kind: "thread", threadId: "th_1" });
  });

  it.each([
    ["an unknown kind", { kind: "anchor", exact: "x" }],
    ["an item with no text to find", { kind: "item" }],
    ["a thread naming no thread", { kind: "thread" }],
    ["a scalar", "item"],
    ["null", null],
  ])("drops a stored reveal that is %s, keeping the entry", (_case, reveal) => {
    const storage = memoryStorage({
      [BOARD_STORAGE_KEY]: JSON.stringify(blob([q("doc_a", 0, [{ docId: "doc_x", reveal }])])),
    });
    expect(queryItem(readBoardLocalState(storage), "doc_a")?.nav).toEqual([
      { docId: "doc_x", scrollY: 0 },
    ]);
  });

  it("ignores a boards field that is not an object", () => {
    const storage = memoryStorage({
      [BOARD_STORAGE_KEY]: JSON.stringify({ version: BOARD_STATE_VERSION, boards: 5 }),
    });
    expect(readBoardLocalState(storage)).toEqual(EMPTY_BOARD_STATE);
  });

  it("ignores a chosen board that is not a non-empty string", () => {
    for (const board of [5, "", null, { id: "x" }]) {
      const storage = memoryStorage({
        [BOARD_STORAGE_KEY]: JSON.stringify({ version: BOARD_STATE_VERSION, board, boards: {} }),
      });
      expect(readBoardLocalState(storage).board).toBeNull();
    }
  });

  it("survives storage that throws on every access", () => {
    const storage = throwingStorage();
    expect(readBoardLocalState(storage)).toEqual(EMPTY_BOARD_STATE);
    expect(() => {
      writeBoardLocalState(EMPTY_BOARD_STATE, storage);
    }).not.toThrow();
  });

  it("survives no storage at all", () => {
    expect(readBoardLocalState(null)).toEqual(EMPTY_BOARD_STATE);
    expect(() => {
      writeBoardLocalState(EMPTY_BOARD_STATE, null);
    }).not.toThrow();
  });
});

describe("openDocId", () => {
  it("is the deepest entry, or null for a column showing its list", () => {
    expect(openDocId({ scroll: 0, nav: [] })).toBeNull();
    expect(
      openDocId({
        scroll: 0,
        nav: [
          { docId: "doc_a", scrollY: 10 },
          { docId: "doc_b", scrollY: 0 },
        ],
      }),
    ).toBe("doc_b");
  });
});

describe("pruneBoards", () => {
  const state: BoardLocalState = {
    version: BOARD_STATE_VERSION,
    board: "board_1",
    boards: {
      board_1: { seq: 1, strip: [{ kind: "query", view: "doc_a", scroll: 1, nav: [] }] },
      board_2: { seq: 1, strip: [{ kind: "query", view: "doc_b", scroll: 2, nav: [] }] },
    },
  };

  it("drops the local half of a board that no longer exists", () => {
    expect(Object.keys(pruneBoards(state, ["board_2"]).boards)).toEqual(["board_2"]);
  });

  /**
   * The **chosen** board is left alone: it is checked against the live list on
   * every render, and clearing it here would turn a board that is merely still
   * loading into a browser that never chose one.
   */
  it("leaves the chosen board id alone even when it is not live", () => {
    expect(pruneBoards(state, ["board_2"]).board).toBe("board_1");
  });

  it("returns the same object when nothing was dropped", () => {
    expect(pruneBoards(state, ["board_1", "board_2"])).toBe(state);
  });
});

describe("useBoardLocalState", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("remembers a scroll position and a navigation stack across a remount", () => {
    const first = renderHook(() => useBoardLocalState());
    act(() => {
      first.result.current.setScroll(BOARD, "doc_a", 220);
      first.result.current.setNav(BOARD, "doc_a", [
        { docId: "doc_note", scrollY: 300 },
        { docId: "doc_rates", scrollY: 0 },
      ]);
    });
    first.unmount();

    const second = renderHook(() => useBoardLocalState());
    expect(second.result.current.forColumn(BOARD, "doc_a")).toEqual({
      scroll: 220,
      nav: [
        { docId: "doc_note", scrollY: 300 },
        { docId: "doc_rates", scrollY: 0 },
      ],
    });
  });

  it("reports defaults for a column it has never seen", () => {
    const { result } = renderHook(() => useBoardLocalState());
    expect(result.current.forColumn(BOARD, "doc_unknown")).toEqual({ scroll: 0, nav: [] });
  });

  it("writes nothing when the value has not changed", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const setItem = vi.spyOn(storage, "setItem");
    const { result } = renderHook(() => useBoardLocalState());

    act(() => {
      result.current.setScroll(BOARD, "doc_a", 10);
    });
    act(() => {
      result.current.setScroll(BOARD, "doc_a", 10);
    });
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when an equal nav stack is set again", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { result } = renderHook(() => useBoardLocalState());
    act(() => {
      result.current.setNav(BOARD, "doc_a", [{ docId: "doc_x", scrollY: 5 }]);
    });
    const setItem = vi.spyOn(storage, "setItem");
    act(() => {
      result.current.setNav(BOARD, "doc_a", [{ docId: "doc_x", scrollY: 5 }]);
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  /**
   * The difference that matters most is a reveal **disappearing**: the reader
   * clears the instruction the moment it honours it, and a comparison that
   * ignored the field would call that write a no-op and leave the reveal in
   * storage to fire again on the next reload.
   */
  it("writes when a reveal appears or is consumed, but not when it is unchanged", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const { result } = renderHook(() => useBoardLocalState());
    const reveal = { kind: "item", exact: "Call the plumber" } as const;

    act(() => {
      result.current.setNav(BOARD, "doc_a", [{ docId: "doc_x", scrollY: 0 }]);
    });
    const setItem = vi.spyOn(storage, "setItem");

    act(() => {
      result.current.setNav(BOARD, "doc_a", [{ docId: "doc_x", scrollY: 0, reveal }]);
    });
    expect(setItem).toHaveBeenCalledTimes(1);

    // An equal instruction, spelled as a different object: no write.
    act(() => {
      result.current.setNav(BOARD, "doc_a", [
        { docId: "doc_x", scrollY: 0, reveal: { kind: "item", exact: "Call the plumber" } },
      ]);
    });
    expect(setItem).toHaveBeenCalledTimes(1);

    // A different one, and then none at all: both are real changes.
    act(() => {
      result.current.setNav(BOARD, "doc_a", [
        { docId: "doc_x", scrollY: 0, reveal: { kind: "thread", threadId: "th_1" } },
      ]);
    });
    act(() => {
      result.current.setNav(BOARD, "doc_a", [{ docId: "doc_x", scrollY: 0 }]);
    });
    expect(setItem).toHaveBeenCalledTimes(3);
    expect(result.current.forColumn(BOARD, "doc_a").nav[0]?.reveal).toBeUndefined();
  });

  /** Reconciliation is `strip.ts`'s; what the store owes it is the commit. */
  it("reconciles a board's strip against the live column set, dropping the dead", () => {
    const { result } = renderHook(() => useBoardLocalState());
    act(() => {
      result.current.setNav(BOARD, "doc_a", [{ docId: "doc_x", scrollY: 0 }]);
      result.current.setNav(BOARD, "doc_b", [{ docId: "doc_y", scrollY: 0 }]);
    });
    act(() => {
      result.current.reconcile(BOARD, ["doc_b"]);
    });
    expect(result.current.stripOf(BOARD).strip).toEqual([
      { kind: "query", view: "doc_b", scroll: 0, nav: [{ docId: "doc_y", scrollY: 0 }] },
    ]);

    // A reconcile that changes nothing does not rewrite storage.
    const setItem = vi.spyOn(globalThis.localStorage, "setItem");
    act(() => {
      result.current.reconcile(BOARD, ["doc_b"]);
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("commits a strip act's result and answers it back", () => {
    const { result } = renderHook(() => useBoardLocalState());
    const next = {
      seq: 2,
      strip: [
        {
          kind: "path",
          id: 1,
          origin: null,
          cols: [{ stack: [{ docId: "doc_x", scrollY: 0 }] }],
        } as const,
      ],
    };
    act(() => {
      result.current.commitStrip(BOARD, next);
    });
    expect(result.current.stripOf(BOARD)).toEqual(next);
  });

  it("keeps working in memory when storage throws", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const { result } = renderHook(() => useBoardLocalState());
    act(() => {
      result.current.setScroll(BOARD, "doc_a", 55);
    });
    expect(result.current.forColumn(BOARD, "doc_a").scroll).toBe(55);
  });
});
