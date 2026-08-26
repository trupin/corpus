/** @vitest-environment jsdom */
import type { AgentRoster } from "@corpus/contract";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { AGENTS_KEY } from "./keys.js";
import { useAgentsRoster } from "./useAgentsRoster.js";

afterEach(cleanup);

const ROSTER: AgentRoster = {
  agents: [
    {
      lane: "orchestrator",
      resident: null,
      live: true,
      since: null,
      pending: 0,
      summary: null,
      origin: null,
    },
    {
      lane: "th_root",
      resident: { name: "claims-review", docId: "doc_agent", weight: null, designationId: null },
      live: false,
      since: "2026-08-16T11:40:00Z",
      pending: 0,
      summary: null,
      origin: { id: "th_root", title: "The claims conversation" },
    },
  ],
};

function transport(payload: unknown = ROSTER): {
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

describe("useAgentsRoster", () => {
  it("reads the roster from one call", async () => {
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useAgentsRoster(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.lanes).toEqual(ROSTER.agents);
    });
    expect(wire.calls).toEqual(["/api/agents"]);
  });

  it("withholds rather than reporting an empty roster before the answer lands", async () => {
    // The contract says the orchestrator's row is unconditional, so `[]` would
    // be a bug rather than a workspace with no agents — which is exactly why a
    // caller must be able to tell "not yet" from "none".
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useAgentsRoster(), { wrapper: harness.Wrapper });

    expect(result.current.lanes).toBeUndefined();
    await waitFor(() => {
      expect(result.current.lanes).toBeDefined();
    });
  });

  it("caches under the key the server names, and refetches when it names it", async () => {
    // §7: "who is running is a read, never a push" — the roster is refreshed by
    // an ordinary `["agents"]` invalidation and by nothing else. No poll, no
    // `staleTime: 0`, no refetch-on-open.
    const wire = transport();
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    renderHook(() => useAgentsRoster(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(harness.queryClient.getQueryData(AGENTS_KEY)).toEqual(ROSTER);
    });

    harness.eventSource.latest().emit("invalidate", JSON.stringify({ keys: [AGENTS_KEY] }));
    await waitFor(() => {
      expect(wire.calls).toHaveLength(2);
    });
  });

  it("degrades a malformed answer to unknown rather than to a crash", async () => {
    // Every test transport in this repo falls through to `{}` for a route it
    // does not know, and the first surface to read a new field turns that silent
    // gap into a `TypeError` in a component that always renders (UI-098).
    const wire = transport({});
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useAgentsRoster(), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    expect(result.current.lanes).toBeUndefined();
  });
});
