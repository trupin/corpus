/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardRow, boardTransport } from "../testing/boardFixture";
import { createBoardHarness } from "../testing/boardHarness";
import { memoryStorage } from "../testing/memoryStorage";
import { LAST_BOARD_REFUSAL, useBoardSurface } from "./BoardsProvider";
import { BOARD_STORAGE_KEY } from "./useBoardLocalState";

/**
 * Which board is showing, and the one-board rule (SPEC.md §10, rider 2).
 *
 * The bar's own rendering is `shell/BoardBar.test.tsx`. This is the half nothing
 * else can reach: what a browser remembers, what it falls back to, and what the
 * provider refuses.
 */

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BOARDS = [
  boardRow({ id: "b_one", title: "One", order: 1 }),
  boardRow({ id: "b_two", title: "Two", order: 2, defaultOpen: true }),
];

function mount(boards = BOARDS) {
  const wire = boardTransport({ boards });
  const harness = createBoardHarness(wire.fetch);
  return { wire, ...renderHook(() => useBoardSurface(), { wrapper: harness.Wrapper }) };
}

describe("which board a browser shows", () => {
  it("lands on the default-open board when nothing was chosen", async () => {
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.current?.id).toBe("b_two");
    });
    // …and remembers nothing, so a `default-open` moved elsewhere is followed.
    expect(globalThis.localStorage.getItem(BOARD_STORAGE_KEY)).toBeNull();
  });

  it("lands on the first in order when no board carries the flag", async () => {
    const { result } = mount([
      boardRow({ id: "b_a", title: "A", order: 2 }),
      boardRow({ id: "b_b", title: "B", order: 1 }),
    ]);
    await waitFor(() => {
      expect(result.current.current?.id).toBe("b_b");
    });
  });

  it("survives a reload once a board has been chosen", async () => {
    const first = mount();
    await waitFor(() => {
      expect(first.result.current.boards).toHaveLength(2);
    });
    act(() => {
      first.result.current.showBoard("b_one");
    });
    await waitFor(() => {
      expect(first.result.current.current?.id).toBe("b_one");
    });
    first.unmount();

    const second = mount();
    await waitFor(() => {
      expect(second.result.current.current?.id).toBe("b_one");
    });
  });

  /** A remembered board that was archived or deleted falls back the same way. */
  it("falls back when the remembered board is no longer on the bar", async () => {
    globalThis.localStorage.setItem(
      BOARD_STORAGE_KEY,
      JSON.stringify({ version: 3, board: "b_archived", boards: {} }),
    );
    const { result } = mount();
    await waitFor(() => {
      expect(result.current.current?.id).toBe("b_two");
    });
  });

  it("shows no board at all in a workspace that never ran the migration", async () => {
    const { result } = mount([]);
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.current).toBeNull();
    expect(result.current.boards).toEqual([]);
  });
});

describe("one board is always showing", () => {
  it("refuses to archive the last board, and says why", async () => {
    const { result, wire } = mount([boardRow({ id: "b_only", title: "Only", order: 1 })]);
    await waitFor(() => {
      expect(result.current.boards).toHaveLength(1);
    });

    await act(async () => {
      await result.current.archiveBoard(result.current.boards[0] as never);
    });
    expect(wire.calls.filter((call) => call.path.endsWith("/archive"))).toEqual([]);
  });

  /** Deleting the last one is refused by the same rule, and for the same reason. */
  it("refuses to delete the last board", async () => {
    const { result, wire } = mount([boardRow({ id: "b_only", title: "Only", order: 1 })]);
    await waitFor(() => {
      expect(result.current.boards).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteBoard(result.current.boards[0] as never);
    });
    expect(wire.writes("DELETE")).toEqual([]);
  });

  it("archives when another board would still be showing", async () => {
    const { result, wire } = mount();
    await waitFor(() => {
      expect(result.current.boards).toHaveLength(2);
    });

    await act(async () => {
      await result.current.archiveBoard(result.current.boards[0] as never);
    });
    expect(wire.calls.filter((call) => call.path === "/api/docs/b_one/archive")).toHaveLength(1);
  });

  it("states the refusal in one sentence both halves share", () => {
    expect(LAST_BOARD_REFUSAL).toContain("One board is always showing");
  });
});

describe("openBoard — the explorer's act (UI-150)", () => {
  it("just shows a board that is already on the bar", async () => {
    const { result, wire } = mount();
    await waitFor(() => {
      expect(result.current.boards).toHaveLength(2);
    });

    await act(async () => {
      await result.current.openBoard("b_one");
    });
    expect(result.current.current?.id).toBe("b_one");
    expect(wire.calls.filter((call) => call.path.endsWith("/unarchive"))).toEqual([]);
  });

  /** "Clicking it shows that board, restoring it first if it was archived." */
  it("restores a board that is not on the bar, then shows it", async () => {
    const { result, wire } = mount();
    await waitFor(() => {
      expect(result.current.boards).toHaveLength(2);
    });

    await act(async () => {
      await result.current.openBoard("b_archived");
    });
    expect(
      wire.calls.filter((call) => call.path === "/api/docs/b_archived/unarchive"),
    ).toHaveLength(1);
  });
});
