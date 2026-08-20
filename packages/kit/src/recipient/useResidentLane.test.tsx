/** @vitest-environment jsdom */
import type { AgentLane, Doc } from "@corpus/contract";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { useLaneRow, useResidentLane } from "./useResidentLane.js";

afterEach(cleanup);

const ORCHESTRATOR: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: false,
  since: null,
  summary: null,
  origin: null,
};

function designated(overrides: Partial<AgentLane> = {}): AgentLane {
  return {
    lane: "th_root",
    resident: { name: "claims-review", docId: "doc_agent", weight: null },
    live: true,
    since: "2026-08-16T12:00:00Z",
    summary: "reading the policy",
    origin: { id: "th_root", title: "The claims conversation" },
    ...overrides,
  };
}

/** A document as `GET /api/docs/{id}` answers it, with only the edge that matters. */
function doc(id: string, origin: string | null): Doc {
  return {
    frontmatter: {
      id,
      type: "note",
      title: id,
      created: "2026-08-16T10:00:00Z",
      updated: "2026-08-16T10:00:00Z",
      tags: [],
      status: "open",
      anchors: [],
      due: null,
      reviewed: null,
      evergreen: false,
      origin,
      parent: null,
      anchor: null,
      agent: "none",
      resident: null,
      turnModels: {},
      pinned: false,
      order: null,
      query: null,
      column: null,
      extra: {},
    },
    body: "",
    path: `data/docs/${id}.md`,
    key: "0".repeat(64),
  } as unknown as Doc;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: string[];
}

function transport(lanes: readonly AgentLane[], docs: Readonly<Record<string, Doc>> = {}): Wire {
  const calls: string[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.pathname.startsWith("/api/docs/")) {
      const found = docs[url.pathname.slice("/api/docs/".length)];
      if (found === undefined) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "unknown document" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(found), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    const body: unknown = url.pathname === "/api/agents" ? { agents: lanes } : {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetch, calls };
}

describe("useLaneRow", () => {
  it("says nothing at all until the roster has answered", () => {
    // UI-098's rule at the board's grain: a badge that renders "no resident"
    // from a roster still in flight asserts an absence nobody reported.
    const wire = transport([ORCHESTRATOR, designated()]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useLaneRow("th_root"), { wrapper: harness.Wrapper });

    expect(result.current).toBeUndefined();
  });

  it("turns a designated lane into the words the composer uses", async () => {
    const wire = transport([ORCHESTRATOR, designated()]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useLaneRow("th_root", new Date("2026-08-16T12:00:30Z")), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        lane: "th_root",
        name: "claims-review",
        liveness: "live",
        line: "reading the policy",
        kind: "profiled",
        profile: "claims-review",
        profileDoc: "doc_agent",
        note: "",
        weight: null,
        mark: "",
        conversation: "The claims conversation",
      });
    });
  });

  it("answers nothing for a thread the roster does not carry", async () => {
    // Which is what makes a row's *existence* the designation: §7 names a lane
    // after its designated root thread, so an undesignated conversation has no
    // row and therefore no badge.
    const wire = transport([ORCHESTRATOR]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useLaneRow("th_plain"), { wrapper: harness.Wrapper });

    await waitFor(() => {
      expect(wire.calls).toContain("/api/agents");
    });
    expect(result.current).toBeUndefined();
  });

  it("expires a live verdict against the clock it is handed", async () => {
    // `isAgentPresent` applies the grace window, so a `live: true` whose
    // evidence has aged is lapsed without any refetch — which is why the caller
    // passes `now` rather than this reading render time and never moving.
    const wire = transport([ORCHESTRATOR, designated()]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useLaneRow("th_root", new Date("2026-08-16T14:00:00Z")), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current?.liveness).toBe("lapsed");
    });
  });
});

describe("useResidentLane", () => {
  it("names the lane a message posted in the designated thread itself goes to", async () => {
    const wire = transport([ORCHESTRATOR, designated()], { th_root: doc("th_root", null) });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useResidentLane("th_root"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.lane).toBe("th_root");
    });
    expect(result.current.row?.name).toBe("claims-review");
    // The walk stops on the node's own designation before either edge is
    // followed, so nothing above the root is ever asked for. The root itself is
    // read once — `useScopeWalk` seeds its chain with `start` before it knows
    // the answer — and that read is shared with the card's own `useDoc`.
    expect(wire.calls.filter((path) => path.startsWith("/api/docs/"))).toEqual([
      "/api/docs/th_root",
    ]);
  });

  it("follows a document's origin up to the scope's resident", async () => {
    const wire = transport([ORCHESTRATOR, designated()], {
      doc_draft: doc("doc_draft", "th_root"),
    });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useResidentLane("doc_draft"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.lane).toBe("th_root");
    });
    expect(result.current.row?.name).toBe("claims-review");
  });

  it("lands on the orchestrator for a document that reaches no designated root", async () => {
    const wire = transport([ORCHESTRATOR, designated()], { doc_loose: doc("doc_loose", null) });
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useResidentLane("doc_loose"), {
      wrapper: harness.Wrapper,
    });

    await waitFor(() => {
      expect(result.current.lane).toBe("orchestrator");
    });
    expect(result.current.row?.name).toBe("agent");
  });

  it("withholds a lane while the roster is in flight rather than saying orchestrator", () => {
    // Naming the orchestrator from a read that has not landed is the
    // unevidenced claim UI-098 removed from the console, one grain down.
    const wire = transport([ORCHESTRATOR, designated()]);
    const harness = createCorpusTestHarness({ fetch: wire.fetch });
    const { result } = renderHook(() => useResidentLane("th_root"), {
      wrapper: harness.Wrapper,
    });

    expect(result.current.lane).toBeUndefined();
    expect(result.current.row).toBeUndefined();
  });
});
