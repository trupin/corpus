/** @vitest-environment jsdom */
import type { AgentLane } from "@corpus/contract";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createCorpusTestHarness } from "../testing/index.js";
import { ORCHESTRATOR_LABEL } from "./laneRows.js";
import { RecipientPicker, RECIPIENT_GROUP_LABEL } from "./RecipientPicker.js";
import { useComposerRecipient } from "./useComposerRecipient.js";

afterEach(cleanup);

/**
 * Fresh, not a literal: `isAgentPresent` expires a `live: true` whose evidence
 * is older than the grace window, so a hard-coded instant makes a "live" fixture
 * quietly lapse the moment the clock passes it.
 */
const JUST_NOW = new Date().toISOString();

const RESIDENT_LANE: AgentLane = {
  lane: "th_root",
  resident: { name: "claims-review", docId: "doc_agent" },
  live: true,
  since: JUST_NOW,
  summary: "reviewing the draft",
  origin: { id: "th_root", title: "The claims conversation" },
};

const ORCHESTRATOR_LANE_ROW: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: true,
  since: JUST_NOW,
  summary: null,
  origin: null,
};

interface Node {
  /** `frontmatter.origin` of this node, as `GET /api/docs/{id}` reports it. */
  readonly origin?: string | null;
  /** `parent` of this node, as `GET /api/threads/{id}` reports it. */
  readonly parent?: string | null;
}

interface WireOptions {
  readonly lanes?: readonly AgentLane[] | "silent";
  readonly graph?: Readonly<Record<string, Node>>;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * The three reads the default resolution can make, and nothing else: the roster,
 * a document (for the origin edge) and a thread (for the parent edge).
 */
function wire(options: WireOptions = {}) {
  const calls: string[] = [];
  const graph = options.graph ?? {};
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/api/agents") {
      if (options.lanes === "silent") return new Promise<Response>(() => undefined);
      return json({ agents: [ORCHESTRATOR_LANE_ROW, ...(options.lanes ?? [])] });
    }
    if (url.pathname.startsWith("/api/docs/")) {
      const id = url.pathname.slice("/api/docs/".length);
      const node = graph[id];
      if (node === undefined) return json({ code: "not_found", message: id }, 404);
      // Only the two fields the walk reads; the transport is not the contract.
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
  return { fetch, calls };
}

function mount(start: string | null, options: WireOptions = {}) {
  const transport = wire(options);
  const harness = createCorpusTestHarness({ fetch: transport.fetch });
  const view = renderHook(() => useComposerRecipient({ start }), { wrapper: harness.Wrapper });
  return { ...view, calls: transport.calls };
}

describe("the computed default", () => {
  it("is the orchestrator for a composer that is in no conversation at all", async () => {
    const { result } = mount(null, { lanes: [RESIDENT_LANE] });
    await waitFor(() => {
      expect(result.current.computed).toBe("orchestrator");
    });
    expect(result.current.request).toEqual({});
  });

  it("is the scope's resident for a reply inside the designated thread", async () => {
    const { result } = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(result.current.computed).toBe("th_root");
    });
    expect(result.current.request).toEqual({});
  });

  it("climbs the chain — a comment on a document the conversation produced", async () => {
    const { result } = mount("th_comment", {
      lanes: [RESIDENT_LANE],
      graph: {
        th_comment: { parent: "doc_draft" },
        doc_draft: { origin: "th_root" },
        th_root: {},
      },
    });
    await waitFor(() => {
      expect(result.current.computed).toBe("th_root");
    });
  });

  it("is the orchestrator where the chain reaches the top designated by nobody", async () => {
    const { result } = mount("th_loose", {
      lanes: [RESIDENT_LANE],
      graph: { th_loose: { parent: "doc_note" }, doc_note: {} },
    });
    await waitFor(() => {
      expect(result.current.computed).toBe("orchestrator");
    });
  });

  it("says nothing while the roster has not answered — never 'the orchestrator'", async () => {
    const { result } = mount("th_root", { lanes: "silent" });
    await waitFor(() => {
      expect(result.current.rows).toBeUndefined();
    });
    expect(result.current.computed).toBeUndefined();
    expect(result.current.effective).toBeUndefined();
    // …and sending is still unblocked, because the default travels by absence.
    expect(result.current.request).toEqual({});
  });

  it("costs no read at all on a workspace with nothing designated", async () => {
    const view = mount("th_root", { lanes: [] });
    await waitFor(() => {
      expect(view.result.current.computed).toBe("orchestrator");
    });
    // A scope root *is* a lane, so no lanes means no scope to be inside: the
    // walk is answered without opening a single document.
    expect(view.calls).toEqual(["GET /api/agents"]);
  });
});

describe("an override is for one message", () => {
  it("states nothing at all until a lane other than the default is picked", async () => {
    const { result } = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(result.current.computed).toBe("th_root");
    });
    expect(result.current.request).toEqual({});
    expect(result.current.overridden).toBe(false);
  });

  it("states the picked lane, and only then", async () => {
    const { result } = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(result.current.computed).toBe("th_root");
    });
    result.current.choose("orchestrator");
    await waitFor(() => {
      expect(result.current.request).toEqual({ recipient: "orchestrator" });
    });
  });

  it("goes back to stating nothing when the default is picked back", async () => {
    const { result } = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(result.current.computed).toBe("th_root");
    });
    result.current.choose("orchestrator");
    await waitFor(() => {
      expect(result.current.overridden).toBe(true);
    });
    result.current.choose("th_root");
    await waitFor(() => {
      expect(result.current.request).toEqual({});
    });
    expect(result.current.overridden).toBe(false);
  });

  it("is dropped by `clear`, which is what a settled send calls", async () => {
    const { result } = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(result.current.computed).toBe("th_root");
    });
    result.current.choose("orchestrator");
    await waitFor(() => {
      expect(result.current.overridden).toBe(true);
    });
    result.current.clear();
    await waitFor(() => {
      expect(result.current.chosen).toBeUndefined();
    });
    expect(result.current.request).toEqual({});
  });

  it("has nowhere to persist to — a second composer on the same thread starts clean", async () => {
    // The structural half of §7's third prohibition. The weight's standing
    // choice is a module-level store keyed by conversation *on purpose*; this
    // deliberately is not one, so there is no state for a pick to leak through.
    const transport = wire({ lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    const harness = createCorpusTestHarness({ fetch: transport.fetch });
    const first = renderHook(() => useComposerRecipient({ start: "th_root" }), {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(first.result.current.computed).toBe("th_root");
    });
    first.result.current.choose("orchestrator");
    await waitFor(() => {
      expect(first.result.current.overridden).toBe(true);
    });

    const second = renderHook(() => useComposerRecipient({ start: "th_root" }), {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(second.result.current.computed).toBe("th_root");
    });
    expect(second.result.current.chosen).toBeUndefined();
    expect(second.result.current.request).toEqual({});
  });

  it("never calls a designation route — an override rewires nothing", async () => {
    const view = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(view.result.current.computed).toBe("th_root");
    });
    view.result.current.choose("orchestrator");
    await waitFor(() => {
      expect(view.result.current.overridden).toBe(true);
    });
    expect(view.calls.filter((call) => call.includes("/resident"))).toEqual([]);
    expect(view.calls.filter((call) => !call.startsWith("GET "))).toEqual([]);
  });
});

function Picker({ start }: { readonly start: string | null }): ReactElement {
  const recipient = useComposerRecipient({ start });
  return <RecipientPicker recipient={recipient} surface="probe" live={true} />;
}

function pickerFor(start: string | null, options: WireOptions = {}) {
  const transport = wire(options);
  const harness = createCorpusTestHarness({ fetch: transport.fetch });
  render(
    <harness.Wrapper>
      <Picker start={start} />
    </harness.Wrapper>,
  );
  return transport;
}

const lanesShown = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-recipient-lane]")].map(
    (option) => option.dataset["recipientLane"] ?? "",
  );

describe("RecipientPicker", () => {
  it("draws nothing at all while the roster has not answered", async () => {
    pickerFor("th_root", { lanes: "silent" });
    await waitFor(() => {
      expect(lanesShown()).toEqual([]);
    });
    expect(document.querySelector("[data-recipient-picker]")).toBeNull();
  });

  it("draws nothing when the workspace has designated nothing", async () => {
    // One lane is no choice, and the answer would be the orchestrator either
    // way: the composer is indistinguishable from before this feature.
    const transport = pickerFor("th_root", { lanes: [] });
    await waitFor(() => {
      expect(transport.calls).toContain("GET /api/agents");
    });
    expect(document.querySelector("[data-recipient-picker]")).toBeNull();
  });

  it("offers every lane, marks the computed default, and names who will answer", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    await waitFor(() => {
      expect(lanesShown()).toEqual(["orchestrator", "th_root"]);
    });
    const resident = document.querySelector<HTMLElement>('[data-recipient-lane="th_root"]');
    expect(resident?.dataset["recipientDefault"]).toBe("true");
    expect(resident?.getAttribute("aria-pressed")).toBe("true");
    expect(resident?.dataset["recipientLiveness"]).toBe("live");
    expect(screen.getByText(/claims-review will answer — reviewing the draft/u)).toBeTruthy();
  });

  it("renders liveness honestly, and leaves a lapsed lane pickable", async () => {
    const lapsed: AgentLane = {
      ...RESIDENT_LANE,
      live: false,
      since: "2026-01-01T00:00:00Z",
      summary: null,
    };
    pickerFor("th_root", { lanes: [lapsed], graph: { th_root: {} } });
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    const resident = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-recipient-lane="th_root"]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(resident?.dataset["recipientLiveness"]).toBe("lapsed");
    expect(resident?.hasAttribute("disabled")).toBe(false);
    expect(resident?.getAttribute("title")).toMatch(
      /last seen .* — the orchestrator will answer until it returns/u,
    );
  });

  it("is operable from the keyboard — every option is a plain button", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    for (const option of document.querySelectorAll("[data-recipient-lane]")) {
      expect(option.tagName).toBe("BUTTON");
      expect(option.getAttribute("type")).toBe("button");
    }
  });

  it("reads a lane's line out on focus, without picking it", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    const orchestrator = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-recipient-lane="orchestrator"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.focus(orchestrator);
    expect(screen.getByText(new RegExp(`^${ORCHESTRATOR_LABEL} will answer`, "u"))).toBeTruthy();
    expect(orchestrator.getAttribute("aria-pressed")).toBe("false");
  });

  it("moves the pressed state to a picked lane and back on a second press", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    const orchestrator = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-recipient-lane="orchestrator"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(orchestrator);
    await waitFor(() => {
      expect(orchestrator.getAttribute("aria-pressed")).toBe("true");
    });
    fireEvent.click(orchestrator);
    await waitFor(() => {
      expect(orchestrator.getAttribute("aria-pressed")).toBe("false");
    });
  });
});
