/** @vitest-environment jsdom */
import type { AgentLane } from "@corpus/contract";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { MAX_SCOPE_WALK, useScopeWalk } from "./useScopeWalk.js";

afterEach(cleanup);

/**
 * The seam between `walkScope` and the board: which reads the walk provokes,
 * what a `404` among them means, and what happens when a corpus is deeper than
 * this page is willing to fetch.
 *
 * The traversal is `@corpus/contract`'s and is tested there against literal
 * graphs. What is only testable here is the part that is a *browser*: reads that
 * have not landed, reads that came back refused, and a budget that has run out.
 */

const JUST_NOW = new Date().toISOString();

const RESIDENT_LANE: AgentLane = {
  lane: "th_root",
  resident: { name: "Ana", docId: "doc_ana", weight: null, designationId: null },
  live: true,
  since: JUST_NOW,
  pending: 0,
  working: false,
  summary: null,
  origin: { id: "th_root", title: "Ana's conversation" },
};

const ORCHESTRATOR_ROW: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: true,
  since: JUST_NOW,
  pending: 0,
  working: false,
  summary: null,
  origin: null,
};

interface Node {
  readonly origin?: string | null;
  readonly parent?: string | null;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mount(start: string, graph: Readonly<Record<string, Node>>) {
  const reads: string[] = [];
  const answer = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/api/agents") return json({ agents: [ORCHESTRATOR_ROW, RESIDENT_LANE] });
    if (url.pathname.startsWith("/api/docs/")) {
      const id = url.pathname.slice("/api/docs/".length);
      reads.push(id);
      const node = graph[id];
      if (node === undefined) return json({ code: "not_found", message: id }, 404);
      return json({
        frontmatter: { id, origin: node.origin ?? null },
        body: "",
        path: `data/docs/${id}.md`,
        anchors: [],
      });
    }
    if (url.pathname.startsWith("/api/threads/")) {
      const id = url.pathname.slice("/api/threads/".length);
      const node = graph[id];
      if (node === undefined) return json({ code: "not_found", message: id }, 404);
      return json({ id, parent: node.parent ?? null, turns: [] });
    }
    return json({});
  };
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    Promise.resolve(answer(input, init));
  const harness = createCorpusTestHarness({ fetch });
  const view = renderHook(() => useScopeWalk({ start, lanes: [ORCHESTRATOR_ROW, RESIDENT_LANE] }), {
    wrapper: harness.Wrapper,
  });
  return { ...view, reads };
}

describe("useScopeWalk", () => {
  /**
   * UI-119's reproduction, through the reads a real composer makes. A subagent
   * opened `th_c` on Ana's draft while answering an ordinary orchestrator
   * question, so it carries `parent → doc_draft` **and** `origin → th_q`. The
   * server routes it to Ana; before this issue the composer said *orchestrator*,
   * and a person pressing that row sent it.
   */
  it("names the lane the parent chain reaches, not the job that opened the thread", async () => {
    const { result } = mount("th_c", {
      th_c: { parent: "doc_draft", origin: "th_q" },
      doc_draft: { origin: "th_root" },
      th_q: {},
      th_root: {},
    });
    await waitFor(() => {
      expect(result.current).toEqual({ kind: "lane", lane: "th_root" });
    });
  });

  it("treats a document the server refuses as a dead branch and follows the other edge", async () => {
    // `th_gone` is not in the graph, so its read comes back `404` — the same
    // fact the server's projection miss establishes, and the same consequence.
    const { result } = mount("th_c", {
      th_c: { parent: "doc_draft", origin: "th_gone" },
      doc_draft: { origin: "th_root" },
      th_root: {},
    });
    await waitFor(() => {
      expect(result.current).toEqual({ kind: "lane", lane: "th_root" });
    });
  });

  it("answers the orchestrator when every branch settles as absent or undesignated", async () => {
    const { result } = mount("th_c", { th_c: { parent: "doc_gone", origin: "th_gone" } });
    await waitFor(() => {
      expect(result.current).toEqual({ kind: "orchestrator" });
    });
  });

  /**
   * The budget, and what exhausting it is allowed to say. It stops the *reads*;
   * the walk then has nothing to go on and withholds. Answering `orchestrator`
   * here — which the old bound of 8 did, inside the walk itself — would be a
   * confident wrong name on a corpus one link too deep, and since UI-118 a
   * person can press it onto the wire.
   */
  it("withholds rather than naming a lane when the corpus is deeper than the read budget", async () => {
    const deep: Record<string, Node> = {};
    for (let index = 0; index < MAX_SCOPE_WALK + 6; index += 1) {
      deep[`th_${String(index)}`] = { parent: `th_${String(index + 1)}` };
    }
    deep[`th_${String(MAX_SCOPE_WALK + 6)}`] = {};
    const { result, reads } = mount("th_0", deep);
    await waitFor(() => {
      expect(reads.length).toBeGreaterThanOrEqual(MAX_SCOPE_WALK);
    });
    // Never a verdict, and never more reads than the budget allows.
    await waitFor(() => {
      expect(result.current.kind).toBe("unread");
    });
    expect(new Set(reads).size).toBeLessThanOrEqual(MAX_SCOPE_WALK);
  });
});
