/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { boardTransport } from "../testing/boardFixture";
import { useColumnOrder } from "./useColumnOrder";

afterEach(cleanup);

const COLUMNS = [
  { id: "doc_a", order: 10 },
  { id: "doc_b", order: 20 },
  { id: "doc_c", order: 30 },
  { id: "doc_d", order: 40 },
];

describe("useColumnOrder", () => {
  it("writes the minimum set of view documents a move needs", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    const written = await result.current.move(COLUMNS, 3, 1);

    expect(written).toBe(1);
    expect(wire.writes("PUT")).toEqual([
      { method: "PUT", path: "/api/docs/doc_d", search: "", body: { order: 15 } },
    ]);
  });

  it("renumbers the board in one pass when the gaps are exhausted", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    const packed = [
      { id: "doc_a", order: 1 },
      { id: "doc_b", order: 2 },
      { id: "doc_c", order: 3 },
      { id: "doc_d", order: 4 },
      { id: "doc_e", order: 5 },
    ];
    const written = await result.current.move(packed, 4, 1);

    expect(written).toBe(5);
    expect(wire.writes("PUT").map((call) => [call.path, call.body])).toEqual([
      ["/api/docs/doc_a", { order: 10 }],
      ["/api/docs/doc_e", { order: 20 }],
      ["/api/docs/doc_b", { order: 30 }],
      ["/api/docs/doc_c", { order: 40 }],
      ["/api/docs/doc_d", { order: 50 }],
    ]);
  });

  it("issues no request at all when the move is a no-op", async () => {
    const wire = boardTransport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    // `⇧←` on the leftmost column, and `⇧→` on the rightmost.
    expect(await result.current.move(COLUMNS, 0, -1)).toBe(0);
    expect(await result.current.move(COLUMNS, 3, 4)).toBe(0);
    expect(wire.calls).toEqual([]);
  });

  it("surfaces a refused write instead of claiming the board moved", async () => {
    const wire = boardTransport({ failing: { "/api/docs/doc_d": 409 } });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useColumnOrder(), { wrapper: harness.Wrapper });

    await expect(result.current.move(COLUMNS, 3, 1)).rejects.toThrow(/no such filter/);
  });
});
