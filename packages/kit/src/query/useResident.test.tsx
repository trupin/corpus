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

    result.current.mutate({ id: "th_root", designate: "claims-review" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/threads/th_root/resident", body: { name: "claims-review" } },
    ]);
  });

  /**
   * SPEC.md §7's ordinary case, which "requires nothing to exist first". It is
   * the same `POST` with the name left out — never a sentinel name, which would
   * reach a person's recipient list dressed as a profile (CONTRACT-061).
   */
  it("designates a general resident by naming no profile at all", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root", designate: null });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/threads/th_root/resident", body: {} },
    ]);
  });

  /**
   * UI-168, and the assertion the whole issue turns on: **the body carries the
   * weight**.
   *
   * SPEC.md §7's rider signed 2026-08-19 makes the designation the only place a
   * resident's level is chosen, and this hook had no field for it — so the
   * contract carried it, the server honoured it, `corpus resident` set it, and
   * every designation the app ever made sent nothing. A test asserting only
   * *"a designation was sent"* passes throughout that defect, which is exactly
   * what the two above did.
   */
  it("sends the level the designation chose, beside the profile", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root", designate: "claims-review", weight: "heavy" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      {
        method: "POST",
        path: "/api/threads/th_root/resident",
        body: { name: "claims-review", weight: "heavy" },
      },
    ]);
  });

  /**
   * The two fields are independent (CONTRACT-067): a general resident may run at
   * a stated level, and sending a weight alone designates one.
   */
  it("sends a level with no profile, which is a general resident at that level", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root", designate: null, weight: "light" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(wire.calls).toEqual([
      { method: "POST", path: "/api/threads/th_root/resident", body: { weight: "light" } },
    ]);
  });

  /**
   * **Omitted, not null.** Absence is what "the launcher decides" is spelled as
   * on this route — the contract's field is `.optional()` with no `.default()`,
   * and both `null` and `""` are refusals. `toEqual` alone would pass on
   * `{weight: undefined}`, which `JSON.stringify` drops but which is a second
   * spelling of nothing one refactor from becoming a real key, so the parsed
   * body's own key list is what is asserted.
   */
  it("omits the key entirely when no level was chosen, rather than sending null", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root", designate: "claims-review", weight: undefined });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(Object.keys(wire.calls[0]?.body as object)).toEqual(["name"]);
  });

  it("releases with DELETE on the same path, and no body", async () => {
    // Releasing is `DELETE` rather than a `null` name, so absence never has two
    // spellings (SPEC.md §7 — dissolution is the absence of a resident).
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useSetResident(), { wrapper: harness.Wrapper });

    result.current.mutate({ id: "th_root", release: true });

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

    result.current.mutate({ id: "th_root", designate: "claims-review" });

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

    result.current.mutate({ id: "th_root", designate: "nobody" });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(errors).toHaveLength(1);
  });
});
