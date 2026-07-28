/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage";
import {
  BOARD_STATE_VERSION,
  BOARD_STORAGE_KEY,
  EMPTY_BOARD_STATE,
  pruneColumns,
  readBoardLocalState,
  useBoardLocalState,
  writeBoardLocalState,
} from "./useBoardLocalState";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("readBoardLocalState", () => {
  it("reads back what was written", () => {
    const storage = memoryStorage();
    writeBoardLocalState(
      { version: BOARD_STATE_VERSION, columns: { doc_a: { scroll: 120, open: "doc_x" } } },
      storage,
    );
    expect(readBoardLocalState(storage)).toEqual({
      version: BOARD_STATE_VERSION,
      columns: { doc_a: { scroll: 120, open: "doc_x" } },
    });
  });

  it("stores browser-local state and nothing else", () => {
    const storage = memoryStorage();
    writeBoardLocalState(
      { version: BOARD_STATE_VERSION, columns: { doc_a: { scroll: 40, open: null } } },
      storage,
    );
    const blob = storage.getItem(BOARD_STORAGE_KEY) ?? "";
    // The review-blocking rule of SPEC.md §11: no query, no order, no column
    // identity beyond the id whose scroll this is.
    expect(blob).toBe('{"version":1,"columns":{"doc_a":{"scroll":40,"open":null}}}');
    expect(blob).not.toContain("order");
    expect(blob).not.toContain("query");
    expect(blob).not.toContain("title");
  });

  it.each([
    ["nothing stored", null],
    ["garbage", "}{ not json"],
    ["a JSON scalar", '"nope"'],
    ["an older version", '{"version":0,"columns":{"doc_a":{"scroll":9,"open":null}}}'],
  ])("degrades to defaults on %s", (_case, raw) => {
    const storage = memoryStorage(raw === null ? {} : { [BOARD_STORAGE_KEY]: raw });
    expect(readBoardLocalState(storage)).toEqual(EMPTY_BOARD_STATE);
  });

  it("repairs individual entries rather than dropping the whole blob", () => {
    const storage = memoryStorage({
      [BOARD_STORAGE_KEY]: JSON.stringify({
        version: BOARD_STATE_VERSION,
        columns: { doc_a: { scroll: "lots", open: 7 }, doc_b: 4, doc_c: null },
      }),
    });
    expect(readBoardLocalState(storage).columns).toEqual({ doc_a: { scroll: 0, open: null } });
  });

  it("ignores a columns field that is not an object", () => {
    const storage = memoryStorage({
      [BOARD_STORAGE_KEY]: JSON.stringify({ version: BOARD_STATE_VERSION, columns: 5 }),
    });
    expect(readBoardLocalState(storage)).toEqual(EMPTY_BOARD_STATE);
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

describe("pruneColumns", () => {
  const state = {
    version: BOARD_STATE_VERSION,
    columns: { doc_a: { scroll: 1, open: null }, doc_b: { scroll: 2, open: "doc_x" } },
  };

  it("drops entries for columns that no longer exist", () => {
    expect(pruneColumns(state, ["doc_a"]).columns).toEqual({ doc_a: { scroll: 1, open: null } });
  });

  it("returns the same object when nothing was dropped", () => {
    expect(pruneColumns(state, ["doc_a", "doc_b"])).toBe(state);
  });
});

describe("useBoardLocalState", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("remembers a scroll position and an open reader across a remount", () => {
    const first = renderHook(() => useBoardLocalState());
    act(() => {
      first.result.current.setScroll("doc_a", 220);
      first.result.current.setOpen("doc_a", "doc_note");
    });
    first.unmount();

    const second = renderHook(() => useBoardLocalState());
    expect(second.result.current.forColumn("doc_a")).toEqual({ scroll: 220, open: "doc_note" });
  });

  it("reports defaults for a column it has never seen", () => {
    const { result } = renderHook(() => useBoardLocalState());
    expect(result.current.forColumn("doc_unknown")).toEqual({ scroll: 0, open: null });
  });

  it("writes nothing when the value has not changed", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    const setItem = vi.spyOn(storage, "setItem");
    const { result } = renderHook(() => useBoardLocalState());

    act(() => {
      result.current.setScroll("doc_a", 10);
    });
    act(() => {
      result.current.setScroll("doc_a", 10);
    });
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("prunes the columns that went away, and only those", () => {
    const { result } = renderHook(() => useBoardLocalState());
    act(() => {
      result.current.setOpen("doc_a", "doc_x");
      result.current.setOpen("doc_b", "doc_y");
    });
    act(() => {
      result.current.prune(["doc_b"]);
    });
    expect(result.current.state.columns).toEqual({ doc_b: { scroll: 0, open: "doc_y" } });

    // A prune that changes nothing does not rewrite storage.
    const setItem = vi.spyOn(globalThis.localStorage, "setItem");
    act(() => {
      result.current.prune(["doc_b"]);
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("keeps working in memory when storage throws", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const { result } = renderHook(() => useBoardLocalState());
    act(() => {
      result.current.setScroll("doc_a", 55);
    });
    expect(result.current.forColumn("doc_a").scroll).toBe(55);
  });
});
