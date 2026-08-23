/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { boardRow, boardTransport } from "../testing/boardFixture";
import { useBoards } from "./useBoards";

afterEach(cleanup);

describe("useBoards", () => {
  /**
   * "`GET /api/docs?type=board&sort=order` is the whole board bar in one query"
   * (CONTRACT-074, SERVER-138): every row already carries `columns`, `kanban`,
   * `defaultOpen`, `order` and `query`, so there is no per-board follow-up read.
   */
  it("asks for every board in one bounded request", async () => {
    const wire = boardTransport({
      boards: [
        boardRow({ id: "b1", title: "Attention", order: 1, columns: ["doc_v1"] }),
        boardRow({ id: "b2", title: "Files", order: 2, columns: [] }),
      ],
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useBoards(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.boards).toHaveLength(2);
    });

    const reads = wire.calls.filter((call) => call.path === "/api/docs");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.search).toContain("type=board");
    expect(reads[0]?.search).toContain("sort=order");
    expect(wire.calls.filter((call) => call.path.startsWith("/api/docs/"))).toHaveLength(0);
    // Each board's columns arrived with it.
    expect(result.current.boards[0]?.columnIds).toEqual(["doc_v1"]);
  });

  it("orders the bar by the documented tiebreak, not by arrival order", async () => {
    const wire = boardTransport({
      boards: [
        boardRow({ id: "b_z", title: "Zulu", order: null }),
        boardRow({ id: "b_b", title: "beta", order: 2 }),
        boardRow({ id: "b_a", title: "Alpha", order: 2 }),
        boardRow({ id: "b_c", title: "Gamma", order: 1 }),
      ],
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useBoards(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.boards).toHaveLength(4);
    });
    expect(result.current.boards.map((board) => board.id)).toEqual(["b_c", "b_a", "b_b", "b_z"]);
  });

  /** A workspace that never ran the migration — UI-148's third edge case. */
  it("answers with no boards rather than inventing one", async () => {
    const wire = boardTransport({ boards: [] });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useBoards(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.boards).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a failed read rather than pretending there are no boards", async () => {
    const failing = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));
    const harness = createCorpusTestHarness({
      fetch: failing as unknown as typeof globalThis.fetch,
    });
    const { result } = renderHook(() => useBoards(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.boards).toEqual([]);
  });
});
