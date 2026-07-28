/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board } from "./Board";

afterEach(cleanup);

/** A transport that answers every read with an empty collection. */
function emptyFetch(): typeof globalThis.fetch {
  const fetch = vi.fn(
    () =>
      new Response(JSON.stringify({ items: [], page: { total: 0, limit: 50, offset: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  return fetch as unknown as typeof globalThis.fetch;
}

describe("Board", () => {
  it("renders a labelled main scroller carrying the board class", () => {
    const harness = createCorpusTestHarness({ fetch: emptyFetch() });
    const { container } = render(<Board />, { wrapper: harness.Wrapper });
    const board = container.querySelector(".board");
    expect(board?.tagName).toBe("MAIN");
    expect(board?.getAttribute("aria-label")).toBe("Document lists");
  });

  it("renders its empty state until columns arrive", async () => {
    const harness = createCorpusTestHarness({ fetch: emptyFetch() });
    const { container } = render(<Board />, { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(container.querySelector(".board-empty")?.textContent).toBe("No lists yet");
    });
  });
});
