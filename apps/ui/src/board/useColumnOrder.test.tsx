/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { boardTransport } from "../testing/boardFixture";
import { useColumnOrder } from "./useColumnOrder";

afterEach(cleanup);

const BOARD = "doc_board_1";
const COLUMNS = ["doc_a", "doc_b", "doc_c", "doc_d"];

describe("useColumnOrder", () => {
  /**
   * Rider 2: "adding, removing or reordering a column edits the board document".
   * One write, to one document, and never to the view — which may sit on another
   * board this gesture must not disturb.
   */
  it("writes the board document's whole `columns` array, and nothing else", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    const wrote = await result.current.move(BOARD, COLUMNS, 3, 1);

    expect(wrote).toBe(true);
    expect(wire.writes("PUT")).toEqual([
      {
        method: "PUT",
        path: `/api/docs/${BOARD}`,
        search: "",
        body: { columns: ["doc_a", "doc_d", "doc_b", "doc_c"] },
      },
    ]);
  });

  it("appends a new column to the end of the board's list", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    await result.current.append(BOARD, ["doc_a"], "doc_new");

    expect(wire.writes("PUT").map((call) => [call.path, call.body])).toEqual([
      [`/api/docs/${BOARD}`, { columns: ["doc_a", "doc_new"] }],
    ]);
  });

  /**
   * "Remove from this board filters `columns` and leaves the view document
   * alone" — so exactly one `PUT`, on the board, and no archive and no delete.
   */
  it("removes one column by index and touches no view document", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    await result.current.remove(BOARD, ["doc_a", "doc_b", "doc_a"], 2);

    expect(wire.writes("PUT").map((call) => [call.path, call.body])).toEqual([
      [`/api/docs/${BOARD}`, { columns: ["doc_a", "doc_b"] }],
    ]);
    expect(wire.writes("DELETE")).toEqual([]);
    expect(wire.calls.filter((call) => call.path.endsWith("/archive"))).toEqual([]);
  });

  it("issues no request at all when the move is a no-op", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    // `⇧←` on the leftmost column, and `⇧→` on the rightmost.
    expect(await result.current.move(BOARD, COLUMNS, 0, -1)).toBe(false);
    expect(await result.current.move(BOARD, COLUMNS, 3, 4)).toBe(false);
    expect(wire.calls).toEqual([]);
  });

  it("issues no request when the removal names an index the board does not have", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    expect(await result.current.remove(BOARD, COLUMNS, 9)).toBe(false);
    expect(wire.calls).toEqual([]);
  });

  it("surfaces a refused write instead of claiming the board moved", async () => {
    const wire = boardTransport({ failing: { [`/api/docs/${BOARD}`]: 409 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    await expect(result.current.move(BOARD, COLUMNS, 3, 1)).rejects.toThrow(/no such filter/);
  });
});
