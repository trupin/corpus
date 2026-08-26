/** @vitest-environment jsdom */
import type { AgentLane } from "@corpus/contract";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CorpusRequestError } from "../client/createCorpusClient.js";
import { createCorpusTestHarness } from "../testing/index.js";
import { composerAddress } from "../address/addressModel.js";
import { ComposerAddress, RECIPIENT_GROUP_LABEL } from "../address/ComposerAddress.js";
import { MISSING_PROFILE_MARK, MISSING_PROFILE_NOTE, ORCHESTRATOR_LABEL } from "./laneRows.js";
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
  resident: { name: "claims-review", docId: "doc_agent", weight: "heavy", designationId: null },
  live: true,
  since: JUST_NOW,
  pending: 0,
  summary: "reviewing the draft",
  origin: { id: "th_root", title: "The claims conversation" },
};

const ORCHESTRATOR_LANE_ROW: AgentLane = {
  lane: "orchestrator",
  resident: null,
  live: true,
  since: JUST_NOW,
  pending: 0,
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
  /**
   * Mutable, so a test can be the **other tab**: the resident on `th_root` is
   * released elsewhere, and this build's roster is whatever it last read until
   * something refetches it. That is the state UI-118 is about, and it cannot be
   * seeded — it is a disagreement between two moments.
   */
  let designated: readonly AgentLane[] = options.lanes === "silent" ? [] : (options.lanes ?? []);
  const release = (lane: string): void => {
    designated = designated.filter((row) => row.lane !== lane);
  };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/api/agents") {
      if (options.lanes === "silent") return new Promise<Response>(() => undefined);
      return json({ agents: [ORCHESTRATOR_LANE_ROW, ...designated] });
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
  return { fetch, calls, release };
}

function mount(start: string | null, options: WireOptions = {}) {
  const transport = wire(options);
  const harness = createCorpusTestHarness({ fetch: transport.fetch });
  const view = renderHook(() => useComposerRecipient({ start }), { wrapper: harness.Wrapper });
  return { ...view, calls: transport.calls, release: transport.release };
}

/** The `422` the server answers a pick that no longer names a lane with. */
function refusal(lane: string): CorpusRequestError {
  return new CorpusRequestError("POST /api/threads/{id}/turns", 422, {
    code: "unknown_recipient",
    message: `\`${lane}\` names no lane`,
    recipient: lane,
  });
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
  it("states nothing at all until somebody picks a lane", async () => {
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

  /**
   * UI-118, the whole of it. `computed` runs the same traversal the server
   * routes with (UI-119), but off a **cached roster** and only as far as this
   * page has read — so equality with the server's answer is a coincidence of two
   * moments, not consent. Sending absence here is how a person addresses
   * `th_root` and the orchestrator answers.
   */
  it("states a pick that happens to equal the computed lane — it was still a pick", async () => {
    const { result } = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(result.current.computed).toBe("th_root");
    });
    result.current.choose("th_root");
    await waitFor(() => {
      expect(result.current.request).toEqual({ recipient: "th_root" });
    });
    // …and it is not an *override*: nothing about the routing differs from the
    // default, so nothing on the surface should claim it does.
    expect(result.current.overridden).toBe(false);
    expect(result.current.chosen).toBe("th_root");
  });

  it("goes back to stating nothing only when the pick is dropped", async () => {
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
      expect(result.current.request).toEqual({ recipient: "th_root" });
    });
    result.current.choose(undefined);
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

/**
 * UI-118's reviewer scenario, at the grain a hook test can hold it: the resident
 * on `th_root` is released in another tab, this build's roster has not refetched,
 * and the person presses `th_root` — the lane they mean to address.
 */
describe("a pick the server refuses", () => {
  it("goes on the wire, so the server's own guard can run at all", async () => {
    const view = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(view.result.current.computed).toBe("th_root");
    });
    view.release("th_root");
    view.result.current.choose("th_root");
    await waitFor(() => {
      expect(view.result.current.request).toEqual({ recipient: "th_root" });
    });
  });

  it("is kept and marked, and the roster is refetched", async () => {
    const view = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(view.result.current.computed).toBe("th_root");
    });
    const before = view.calls.filter((call) => call === "GET /api/agents").length;

    view.release("th_root");
    view.result.current.choose("th_root");
    await waitFor(() => {
      expect(view.result.current.chosen).toBe("th_root");
    });
    view.result.current.refuse(refusal("th_root"));

    await waitFor(() => {
      expect(view.result.current.refused).toBe("th_root");
    });
    // Kept, deliberately: nothing was written, so this is still the same unsent
    // message. Dropped, the retry would carry no recipient and the server would
    // route it past the lane the person addressed.
    expect(view.result.current.request).toEqual({ recipient: "th_root" });
    // The refusal is the only evidence the roster is stale, and nothing else
    // will refetch it (`useAgentsRoster` has no poll).
    await waitFor(() => {
      expect(view.calls.filter((call) => call === "GET /api/agents").length).toBe(before + 1);
    });
    // …and once it lands, the lane the server refused is still offered rather
    // than vanishing out from under the pick that names it.
    await waitFor(() => {
      expect(view.result.current.computed).toBe("orchestrator");
    });
    expect(view.result.current.rows?.map((row) => row.lane)).toContain("th_root");
  });

  it("is dropped when the refusal names some other lane, or is not one at all", async () => {
    const view = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(view.result.current.computed).toBe("th_root");
    });
    view.result.current.choose("orchestrator");
    await waitFor(() => {
      expect(view.result.current.chosen).toBe("orchestrator");
    });
    view.result.current.refuse(new Error("the upload failed"));
    await waitFor(() => {
      expect(view.result.current.chosen).toBeUndefined();
    });
    expect(view.result.current.refused).toBeUndefined();

    view.result.current.choose("orchestrator");
    await waitFor(() => {
      expect(view.result.current.chosen).toBe("orchestrator");
    });
    view.result.current.refuse(refusal("th_root"));
    await waitFor(() => {
      expect(view.result.current.chosen).toBeUndefined();
    });
    expect(view.result.current.refused).toBeUndefined();
  });

  it("loses its mark the moment a different lane is picked", async () => {
    const view = mount("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(() => {
      expect(view.result.current.computed).toBe("th_root");
    });
    view.result.current.choose("th_root");
    await waitFor(() => {
      expect(view.result.current.chosen).toBe("th_root");
    });
    view.result.current.refuse(refusal("th_root"));
    await waitFor(() => {
      expect(view.result.current.refused).toBe("th_root");
    });
    view.result.current.choose("orchestrator");
    await waitFor(() => {
      expect(view.result.current.refused).toBeUndefined();
    });
    expect(view.result.current.request).toEqual({ recipient: "orchestrator" });
  });

  it("comes back with a composer its host re-opens, refetching the settled roster", async () => {
    const transport = wire({ lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    const harness = createCorpusTestHarness({
      fetch: transport.fetch,
      // The production default (`createCorpusQueryClient`), because it is the
      // whole reason this mount has anything to do: under `staleTime: Infinity`
      // a re-opened composer re-reads nothing, so the refusal is the only thing
      // that can correct the roster.
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
          mutations: { retry: false },
        },
      }),
    });
    // The comment popover unmounts on submit and its host re-opens it holding
    // what it held (UI-111). The roster is already read and already stale by
    // then, which is the state the mount has to correct.
    const warm = renderHook(() => useComposerRecipient({ start: "th_root" }), {
      wrapper: harness.Wrapper,
    });
    await waitFor(() => {
      expect(warm.result.current.computed).toBe("th_root");
    });
    warm.unmount();
    transport.release("th_root");
    const before = transport.calls.filter((call) => call === "GET /api/agents").length;

    const view = renderHook(
      () =>
        useComposerRecipient({
          start: "th_root",
          restore: { chosen: "th_root", refused: true },
        }),
      { wrapper: harness.Wrapper },
    );
    await waitFor(() => {
      expect(view.result.current.refused).toBe("th_root");
    });
    // The pick came back with the words: the retry addresses the same lane and
    // is refused again, rather than being quietly delivered somewhere else.
    expect(view.result.current.request).toEqual({ recipient: "th_root" });
    await waitFor(() => {
      expect(transport.calls.filter((call) => call === "GET /api/agents").length).toBe(before + 1);
    });
    await waitFor(() => {
      expect(view.result.current.computed).toBe("orchestrator");
    });
  });
});

function Picker({ start }: { readonly start: string | null }): ReactElement {
  // The rows live behind the address line since UI-126; no weight is passed,
  // so the popover holds the recipient section alone and these tests stay
  // about §7.
  const recipient = useComposerRecipient({ start });
  return <ComposerAddress address={composerAddress({ recipient, live: true })} surface="probe" />;
}

/** Opens the popover the rows live in. Fails loudly when there is nothing to open. */
function openAddress(): void {
  const lineEl = document.querySelector<HTMLElement>('[data-address-line="probe"]');
  if (lineEl === null) throw new Error("no address line");
  if (lineEl.tagName !== "BUTTON") throw new Error("the address line does not open");
  if (lineEl.getAttribute("aria-expanded") !== "true") fireEvent.click(lineEl);
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

describe("the address line's recipient rows", () => {
  it("offers nothing to open while the roster has not answered", async () => {
    pickerFor("th_root", { lanes: "silent" });
    await waitFor(() => {
      expect(lanesShown()).toEqual([]);
    });
    // The §10 statement is said, not offered: a plain line, no popover behind it.
    const lineEl = document.querySelector<HTMLElement>('[data-address-line="probe"]');
    expect(lineEl?.tagName).toBe("SPAN");
    expect(document.querySelector("[data-address-pop]")).toBeNull();
  });

  it("offers nothing to open when the workspace has designated nothing", async () => {
    // One lane is no choice, and the answer would be the orchestrator either
    // way: the line says so and opens to nothing.
    const transport = pickerFor("th_root", { lanes: [] });
    await waitFor(() => {
      expect(transport.calls).toContain("GET /api/agents");
    });
    await waitFor(() => {
      expect(document.querySelector('[data-address-line="probe"]')?.tagName).toBe("SPAN");
    });
    expect(document.querySelector("[data-address-pop]")).toBeNull();
    expect(lanesShown()).toEqual([]);
  });

  it("offers every lane, marks the computed default, and names who will answer", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(openAddress);
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
      pending: 0,
      summary: null,
    };
    pickerFor("th_root", { lanes: [lapsed], graph: { th_root: {} } });
    await waitFor(openAddress);
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    const resident = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-recipient-lane="th_root"]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(resident?.dataset["recipientLiveness"]).toBe("lapsed");
    expect(resident?.hasAttribute("disabled")).toBe(false);
    // Quiet, not covered-for: the fallback that sentence described is gone
    // (UI-174), so the line says the lane is unattended and stops there.
    expect(resident?.getAttribute("title")).toMatch(/last seen .* — no listener right now/u);
  });

  /**
   * UI-174. §8's rider, amended 2026-08-25: where the lane has no listener
   * running, the row says **that**, and not merely that the work is queued —
   * because since the fallback was removed, an agent that is not running is the
   * reason nothing is happening, and it is the one thing a person can act on.
   */
  it("says an unattended lane's agent is not running, when something is waiting", async () => {
    const waiting: AgentLane = {
      ...RESIDENT_LANE,
      live: false,
      since: "2026-01-01T00:00:00Z",
      pending: 2,
      summary: null,
    };
    pickerFor("th_root", { lanes: [waiting], graph: { th_root: {} } });
    await waitFor(openAddress);
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    const resident = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-recipient-lane="th_root"]');
      expect(found).not.toBeNull();
      return found;
    });

    expect(resident?.getAttribute("title")).toContain("2 messages waiting");
    expect(resident?.getAttribute("title")).toContain("its agent is not running");
    // It states the fact and stops: no diagnosis of why, and no instruction the
    // product gives nobody a way to follow.
    expect(resident?.getAttribute("title")).not.toMatch(/start|crash|restart/iu);
  });

  /**
   * SPEC.md §7: the missing profile is *"reported rather than silently
   * substituted"*. It was reported on the board badge and in `corpus agents`,
   * and not here — where the lane is actually **chosen** — so a designation
   * whose profile had gone was drawn identically to a healthy one (PR #49
   * review). The name stays: the designation stands, and naming it is what stops
   * the report becoming a substitution.
   *
   * The lane is built from `docId: null` directly, which is the state itself
   * rather than any of the acts that reach it (`MISSING_PROFILE_CAUSES` —
   * renamed, deleted, or moved out of the root; **archiving is not one**, and an
   * archived profile's lane arrives here with its `docId` intact).
   */
  it("reports a lane whose profile has gone, rather than drawing it as a healthy one", async () => {
    const gone: AgentLane = {
      ...RESIDENT_LANE,
      resident: { name: "claims-review", docId: null, weight: "heavy", designationId: null },
    };
    pickerFor("th_root", { lanes: [gone], graph: { th_root: {} } });
    await waitFor(openAddress);
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    const resident = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-recipient-lane="th_root"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    expect(resident.dataset["recipientKind"]).toBe("profile-gone");
    // At rest, without a pointer and without focus: the row itself says it.
    expect(resident.textContent).toContain("claims-review");
    expect(resident.textContent).toContain(MISSING_PROFILE_MARK);
    // …and in full one hover or focus away, on the title and on the statement.
    expect(resident.getAttribute("title")).toContain(MISSING_PROFILE_NOTE);
    expect(
      screen.getByText(`claims-review will answer — ${MISSING_PROFILE_NOTE} — reviewing the draft`),
    ).toBeTruthy();
    // Still a legal recipient: §7 keeps the designation, so nothing is gated.
    expect(resident.hasAttribute("disabled")).toBe(false);
  });

  it("leaves every other kind of lane unmarked", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(openAddress);
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    await waitFor(() => {
      expect(lanesShown()).toEqual(["orchestrator", "th_root"]);
    });
    // The report is the exception, not a decoration every row gains.
    expect(document.querySelectorAll(".recipient-mark")).toHaveLength(0);
    const resident = document.querySelector<HTMLElement>('[data-recipient-lane="th_root"]');
    expect(resident?.dataset["recipientKind"]).toBe("profiled");
    expect(resident?.getAttribute("title")).toBe("claims-review — reviewing the draft");
  });

  it("is operable from the keyboard — every option is a plain button", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(openAddress);
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    for (const option of document.querySelectorAll("[data-recipient-lane]")) {
      expect(option.tagName).toBe("BUTTON");
      expect(option.getAttribute("type")).toBe("button");
    }
  });

  it("reads a lane's line out on focus, without picking it", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(openAddress);
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

  /**
   * UI-118: the row a person presses to say *this lane* is the same row the
   * default already marks, and pressing it has to mean the pick rather than
   * nothing. Keyed on `chosen` and never on `effective`, because `effective`
   * cannot tell "nobody picked, and the walk says this" from "somebody picked
   * this".
   */
  it("makes an explicit pick of the default's own lane, and drops it on a second press", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(openAddress);
    await screen.findByRole("group", { name: RECIPIENT_GROUP_LABEL });
    const resident = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-recipient-lane="th_root"]');
      expect(found?.dataset["recipientDefault"]).toBe("true");
      return found as HTMLElement;
    });
    expect(resident.dataset["recipientChosen"]).toBe("false");
    fireEvent.click(resident);
    await waitFor(() => {
      expect(resident.dataset["recipientChosen"]).toBe("true");
    });
    // Still the default, and still where a message goes — the row says both.
    expect(resident.dataset["recipientDefault"]).toBe("true");
    expect(resident.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(resident);
    await waitFor(() => {
      expect(resident.dataset["recipientChosen"]).toBe("false");
    });
  });

  it("moves the pressed state to a picked lane and back on a second press", async () => {
    pickerFor("th_root", { lanes: [RESIDENT_LANE], graph: { th_root: {} } });
    await waitFor(openAddress);
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
