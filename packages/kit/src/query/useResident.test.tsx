/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { AGENTS_KEY, DOCS_KEY, docKey, threadKey } from "./keys.js";
import { useSetResident } from "./useResident.js";

afterEach(cleanup);

interface Capture {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function transport(status = 200): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: Capture[];
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
    const payload =
      status === 200
        ? {
            thread: { id: "th_root", resident: { name: "claims-review", docId: "doc_agent" } },
            warnings: [],
          }
        : { code: "not_found", message: "no agent-def named that" };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch, calls };
}

describe("useSetResident", () => {
  it("designates by the invocable name, on the route that owns it", async () => {
    // §7 designates by the name `@<subagent>` would have written, never by a
    // document id — the resolution is the server's and its answer carries both.
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root", name: "claims-review" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/threads/th_root/resident", body: { name: "claims-review" } },
    ]);
  });

  it("releases with DELETE on the same path, and no body", async () => {
    // Releasing is `DELETE` rather than a `null` name, so absence never has two
    // spellings (SPEC.md §7 — dissolution is the absence of a resident).
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "DELETE", path: "/api/threads/th_root/resident", body: undefined },
    ]);
  });

  it("invalidates the roster, because a designation *is* a new lane", async () => {
    // The one a caller forgets. A designation that landed on disk without
    // naming `["agents"]` would leave every composer offering a lane list that
    // does not contain the lane it just made.
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const invalidated: unknown[] = [];
    vi.spyOn(harness.queryClient, "invalidateQueries").mockImplementation((filters) => {
      invalidated.push(filters?.queryKey);
      return Promise.resolve();
    });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root", name: "claims-review" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(invalidated).toEqual([threadKey("th_root"), docKey("th_root"), DOCS_KEY, AGENTS_KEY]);
  });

  it("reports a refusal rather than pretending the designation landed", async () => {
    const wire = transport(404);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const errors: string[] = [];
    const { result } = renderHook(
      () =>
        useSetResident({
          onError: (error) => {
            errors.push(error.message);
          },
        }),
      { wrapper: harness.Wrapper },
    );

    result.current.mutate({ id: "th_root", name: "nobody" });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(errors).toHaveLength(1);
  });
});
