/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { DOCS_KEY, docKey } from "./keys.js";
import { useReorderBoards } from "./useReorderBoards.js";

/**
 * The board bar's one act (SPEC.md §10, rider 2). Two things can silently go
 * wrong and both are asserted: **the request that reaches the wire** — one
 * request carrying the ids and no positions, which is what makes the reorder one
 * commit — and **the keys invalidated afterwards**, since a bar that writes
 * correctly and invalidates nothing shows the old order for the rest of the
 * session.
 */

afterEach(cleanup);

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function transport(
  payload: unknown,
  status = 200,
): {
  fetch: typeof globalThis.fetch;
  calls: Capture[];
} {
  const calls: Capture[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const raw = await request.text();
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
}

function spyInvalidations(harness: ReturnType<typeof createCorpusTestHarness>): unknown[][] {
  const seen: unknown[][] = [];
  vi.spyOn(harness.queryClient, "invalidateQueries").mockImplementation((filters) => {
    seen.push((filters?.queryKey ?? []) as unknown[]);
    return Promise.resolve();
  });
  return seen;
}

const RESULT = {
  boards: [
    { id: "doc_files", order: 1, changed: true },
    { id: "doc_attention", order: 2, changed: true },
    { id: "doc_notes", order: 3, changed: false },
  ],
  commit: "c0mm1t",
  warnings: [],
};

describe("useReorderBoards", () => {
  /**
   * **One request, whatever the bar's length.** That is the whole point: four
   * `PUT`s were four commits, and no number of them can be the one commit the
   * rider promises.
   */
  it("sends the whole bar as one request carrying ids and no positions", async () => {
    const wire = transport(RESULT);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useReorderBoards(), { wrapper: harness.Wrapper });

    result.current.mutate(["doc_files", "doc_attention", "doc_notes"]);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(wire.calls).toEqual([
      {
        method: "POST",
        path: "/api/boards/order",
        body: { boards: ["doc_files", "doc_attention", "doc_notes"] },
      },
    ]);
  });

  /**
   * Every board the act covered, not only the ones it wrote: a caller is showing
   * the row of a board that kept its number just the same, and the server is the
   * only thing that knows which those were.
   */
  it("drops the collection and every board the result names", async () => {
    const wire = transport(RESULT);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useReorderBoards(), { wrapper: harness.Wrapper });

    result.current.mutate(["doc_files", "doc_attention", "doc_notes"]);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(keys).toEqual([
      DOCS_KEY,
      docKey("doc_files"),
      docKey("doc_attention"),
      docKey("doc_notes"),
    ]);
  });

  it("hands the caller the one commit and what actually moved", async () => {
    const wire = transport(RESULT);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useReorderBoards(), { wrapper: harness.Wrapper });

    const answer = await result.current.mutateAsync(["doc_files", "doc_attention", "doc_notes"]);
    expect(answer.commit).toBe("c0mm1t");
    expect(answer.boards.filter((board) => board.changed)).toHaveLength(2);
  });

  /** A refusal is the caller's to report; nothing here narrates or retries. */
  it("surfaces a refusal as an error and invalidates nothing", async () => {
    const wire = transport({ code: "bad_request", message: "doc_x is not a board" }, 400);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const keys = spyInvalidations(harness);
    const { result } = renderHook(() => useReorderBoards(), { wrapper: harness.Wrapper });

    result.current.mutate(["doc_x"]);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(keys).toEqual([]);
  });
});
