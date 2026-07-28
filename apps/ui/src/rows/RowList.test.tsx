/** @vitest-environment jsdom */
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowList } from "./RowList";

afterEach(cleanup);

const ROWS = [
  docRowFixture({ id: "doc_fresh", title: "Emergency fund target", stale: null }),
  docRowFixture({
    id: "doc_taxchecklist",
    title: "2025 tax checklist",
    stale: "very-stale",
    attention: ["stale"],
  }),
];

function wire(
  body: unknown,
  onRequest?: (path: string, method: string) => void,
): { readonly fetch: typeof globalThis.fetch } {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    onRequest?.(pathname, request.method);
    const payloads: Record<string, unknown> = {
      "/api/docs": body,
      "/api/locks": { locks: [] },
      "/api/jobs": { jobs: [] },
    };
    return Promise.resolve(
      new Response(
        JSON.stringify(
          payloads[pathname] ?? { doc: {}, anchors: { remapped: [], orphaned: [] }, warnings: [] },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });
  return { fetch: fetch };
}

describe("RowList", () => {
  it("renders one kit Row per result, with the live count", async () => {
    const harness = createCorpusTestHarness({
      fetch: wire({ items: ROWS, page: { total: 2, limit: 50, offset: 0 } }).fetch,
    });
    const { container } = render(<RowList />, { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(container.querySelectorAll(".row")).toHaveLength(2);
    });
    expect(container.querySelector(".col-count")?.textContent).toBe("2");
    expect([...container.querySelectorAll(".row-title")].map((node) => node.textContent)).toEqual([
      "Emergency fund target",
      "2025 tax checklist",
    ]);
    // The ladder came straight from the server's tiers.
    expect([...container.querySelectorAll(".row")].map((node) => node.className)).toEqual([
      "row",
      "row age-3",
    ]);
  });

  it("shows the honest empty state on an empty corpus", async () => {
    const harness = createCorpusTestHarness({
      fetch: wire({ items: [], page: { total: 0, limit: 50, offset: 0 } }).fetch,
    });
    const { container } = render(<RowList />, { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(container.querySelector(".board-empty")?.textContent).toBe("No lists yet");
    });
  });

  it("shows the empty state rather than a crash when the server is unreachable", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("fetch failed")));
    const harness = createCorpusTestHarness({
      fetch: failing as unknown as typeof globalThis.fetch,
    });
    const { container } = render(<RowList />, { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(container.querySelector(".board-empty")).not.toBeNull();
    });
  });

  it("passes the open handler through to the row", async () => {
    const onOpen = vi.fn();
    const harness = createCorpusTestHarness({
      fetch: wire({ items: [ROWS[0]], page: { total: 1, limit: 50, offset: 0 } }).fetch,
    });
    render(<RowList onOpen={onOpen} />, { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Emergency fund target/ })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: /Emergency fund target/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "doc_fresh" }));
  });

  it("logs a row's narration where the toast surface will go", async () => {
    const harness = createCorpusTestHarness({
      fetch: wire({ items: [ROWS[1]], page: { total: 1, limit: 50, offset: 0 } }).fetch,
    });
    const { container } = render(<RowList />, { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Still current" })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Still current" }));

    await waitFor(() => {
      expect(container.querySelector(".rows-notices")?.textContent).toContain("still current");
    });
  });

  it("reads the collection once, not once per row", async () => {
    const paths: string[] = [];
    const harness = createCorpusTestHarness({
      fetch: wire({ items: ROWS, page: { total: 2, limit: 50, offset: 0 } }, (path) => {
        paths.push(path);
      }).fetch,
    });
    const { container } = render(<RowList />, { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(container.querySelectorAll(".row")).toHaveLength(2);
    });
    // Two rows, and still exactly one docs read, one locks read and one jobs read.
    expect(paths.filter((path) => path === "/api/docs")).toHaveLength(1);
    expect(paths.filter((path) => path === "/api/locks")).toHaveLength(1);
    expect(paths.filter((path) => path === "/api/jobs")).toHaveLength(1);
    expect(paths.filter((path) => path.startsWith("/api/docs/"))).toHaveLength(0);
  });
});
