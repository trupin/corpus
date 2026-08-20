/** @vitest-environment jsdom */
import type { ThreadScope } from "@corpus/contract";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { DOCS_KEY, threadScopeKey } from "./keys.js";
import { useThreadScope } from "./useThreadScope.js";

afterEach(cleanup);

/** The server's own answer, verbatim from CONTRACT-068's route. */
const SCOPE: ThreadScope = {
  thread: "th_2aninur5",
  members: [
    {
      id: "th_2aninur5",
      kind: "thread",
      title: "Please take this on @agent",
      status: "open",
      via: "self",
    },
    { id: "doc_aefyz2pg", kind: "doc", title: "Findings", status: "archived", via: "origin" },
    { id: "th_sx5z7cnm", kind: "thread", title: "Re: Findings", status: "open", via: "parent" },
  ],
  truncated: false,
};

function transport(payload: unknown = SCOPE): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(new URL(request.url).pathname);
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch, calls };
}

describe("useThreadScope", () => {
  it("reads one lane's scope from one call, root first", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useThreadScope("th_2aninur5"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.members).toEqual(SCOPE.members);
    });
    expect(result.current.truncated).toBe(false);
    expect(wire.calls).toEqual(["/api/threads/th_2aninur5/scope"]);
  });

  it("reports the members exactly as the server ordered and labelled them", async () => {
    // The walk is the server's, so the edge each member reached the scope by is
    // reported rather than re-derived: an archived document stays in scope, and
    // a thread on it reads `parent` rather than `origin` (SPEC.md §7).
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useThreadScope("th_2aninur5"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.members).toBeDefined();
    });
    expect(result.current.members?.map((member) => member.via)).toEqual([
      "self",
      "origin",
      "parent",
    ]);
    expect(result.current.members?.[1]?.status).toBe("archived");
  });

  it("withholds rather than reporting an empty scope before the answer lands", async () => {
    // `[]` would be a scope not containing its own root thread, which the
    // contract says cannot happen — so "not yet" must be tellable from "none".
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useThreadScope("th_2aninur5"), {
      wrapper: harness.Wrapper,
    });

    expect(result.current.members).toBeUndefined();
    expect(result.current.truncated).toBeUndefined();
    await waitFor(() => {
      expect(result.current.members).toBeDefined();
    });
  });

  it("carries the server's truncation flag rather than presenting a capped page as complete", async () => {
    const wire = transport({ ...SCOPE, truncated: true });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useThreadScope("th_2aninur5"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.truncated).toBe(true);
    });
  });

  it("asks nothing at all for the orchestrator's lane, which is not a scope", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useThreadScope("orchestrator"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.query.fetchStatus).toBe("idle");
    });
    expect(wire.calls).toEqual([]);
    expect(result.current.members).toBeUndefined();
  });

  it("asks nothing while no lane is selected", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    renderHook(() => useThreadScope(null), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(wire.calls).toEqual([]);
    });
  });

  it("caches under a key the server's document frames already name", async () => {
    // A scope's membership moves on ordinary document and thread writes — a
    // subthread created, a member archived — and every one of those emits
    // `["docs"]`, which is a prefix of this key.
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    renderHook(() => useThreadScope("th_2aninur5"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(harness.queryClient.getQueryData(threadScopeKey("th_2aninur5"))).toEqual(SCOPE);
    });

    harness.eventSource.latest().emit("invalidate", JSON.stringify({ keys: [DOCS_KEY] }));
    await waitFor(() => {
      expect(wire.calls).toHaveLength(2);
    });
  });

  it("degrades a malformed answer to unknown rather than to a crash", async () => {
    const wire = transport({});
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useThreadScope("th_2aninur5"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    expect(result.current.members).toBeUndefined();
    expect(result.current.truncated).toBeUndefined();
  });
});
