/** @vitest-environment jsdom */
import type { AgentLane, ThreadScope } from "@corpus/contract";
import { MISSING_PROFILE_MARK, MISSING_PROFILE_NOTE, type LaneResidentKind } from "@corpus/kit";
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardNavigationProvider, useRegisterBoardNavigation } from "../board/openInColumn";
import { SKILL_QUERY_SEARCH, skillDoc, skillRow } from "../testing/weightFixture";
import { Residents } from "./Residents";
import {
  NO_DESIGNATIONS_NOTE,
  ORCHESTRATOR_SCOPE_NOTE,
  SCOPE_BOUND_NOTE,
  SCOPE_RELEASED_NOTE,
  SCOPE_VIA_MARKS,
} from "./residentsModel";
import type { ReactElement, ReactNode } from "react";

/**
 * The Residents tab (UI-125): every lane, who is on it, and what it owns.
 *
 * The lane fixtures are a `Record` keyed by `LaneResidentKind` on purpose — the
 * Testing Strategy's *"the states come from `laneRows`"*. A kind added to the
 * kit's union is a compile error here rather than a state nobody remembered to
 * render, which is precisely how a lane state goes unhandled for a release.
 *
 * The fourth **liveness**, `unknown`, is deliberately absent and is not
 * reachable on this surface: it exists for a lane the *walk* named that the
 * roster does not list (`unknownLaneRow`), and every row here comes from a
 * roster row by construction.
 */

const NOW = new Date().toISOString();
const LONG_AGO = new Date(Date.now() - 42 * 60_000).toISOString();

const LANES: Readonly<Record<LaneResidentKind, AgentLane>> = {
  orchestrator: {
    lane: "orchestrator",
    resident: null,
    live: true,
    since: NOW,
    summary: null,
    origin: null,
  },
  profiled: {
    lane: "th_claims",
    resident: { name: "claims-review", docId: "doc_claims", weight: "heavy" },
    live: true,
    since: NOW,
    summary: "reading the policy",
    origin: { id: "th_claims", title: "The claims conversation" },
  },
  general: {
    lane: "th_rent",
    resident: { name: null, docId: null, weight: "standard" },
    live: false,
    since: null,
    summary: null,
    origin: { id: "th_rent", title: "Rent planning" },
  },
  "profile-gone": {
    lane: "th_gone",
    resident: { name: "researcher", docId: null, weight: null },
    live: false,
    since: LONG_AGO,
    summary: null,
    origin: { id: "th_gone", title: "Market research" },
  },
  unknown: {
    // Off-contract rather than impossible: a designated lane the roster lists
    // with nobody on it says nothing either way (`laneResidentKind`).
    lane: "th_quiet",
    resident: null,
    live: false,
    since: null,
    summary: null,
    origin: { id: "th_quiet", title: "A quiet conversation" },
  },
};

const CLAIMS_SCOPE: ThreadScope = {
  thread: "th_claims",
  members: [
    {
      id: "th_claims",
      kind: "thread",
      title: "The claims conversation",
      status: "open",
      via: "self",
    },
    { id: "doc_findings", kind: "doc", title: "Findings", status: "archived", via: "origin" },
    { id: "th_re", kind: "thread", title: "Re: Findings", status: "open", via: "parent" },
  ],
  truncated: false,
};

interface Workspace {
  readonly lanes?: readonly AgentLane[];
  readonly scope?: ThreadScope;
  /** Answers every scope read with the contract's `409` — the lane was released. */
  readonly released?: boolean;
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/**
 * Stubbed at the transport, like `Console.test.tsx`'s: what matters here is
 * *which requests the tab issues* — one roster read, and a scope read only for
 * the lane a person selected — and a mocked hook could not show that.
 */
function transport(workspace: Workspace = {}): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly string[];
} {
  const calls: string[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(url.pathname + url.search);

    if (url.pathname === "/api/agents") {
      return json({ agents: workspace.lanes ?? Object.values(LANES) });
    }
    if (url.pathname.endsWith("/scope")) {
      if (workspace.released === true) {
        return json({ code: "conflict", message: "the orchestrator's lane is not a scope" }, 409);
      }
      return json(workspace.scope ?? CLAIMS_SCOPE);
    }
    // The workspace's declared weight levels live in its orchestrate skill.
    if (url.pathname === "/api/docs" && url.search === SKILL_QUERY_SEARCH) {
      return json({ items: [skillRow()], page: { total: 1, limit: 200, offset: 0 } });
    }
    if (url.pathname === "/api/docs/doc_orchestrate") return json(skillDoc());
    if (url.pathname === "/api/docs") {
      return json({ items: [], page: { total: 0, limit: 50, offset: 0 } });
    }
    return json({});
  };
  return { fetch: fetchImpl, calls };
}

let harness: CorpusTestHarness | undefined;

function Board({
  children,
  onOpen,
}: {
  children: ReactNode;
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <BoardNavigationProvider>
      {children}
      <Register onOpen={onOpen} />
    </BoardNavigationProvider>
  );
}

function Register({ onOpen }: { onOpen: (id: string) => void }): null {
  useRegisterBoardNavigation({
    open: (target) => {
      onOpen(target.docId);
    },
    revealColumn: () => undefined,
  });
  return null;
}

function renderResidents(
  workspace: Workspace = {},
  onOpen: (id: string) => void = () => undefined,
): { readonly calls: readonly string[] } {
  const wire = transport(workspace);
  harness = createCorpusTestHarness({ fetch: wire.fetch });
  render(
    <Board onOpen={onOpen}>
      <Residents />
    </Board>,
    { wrapper: harness.Wrapper },
  );
  return { calls: wire.calls };
}

const laneRow = (lane: string): HTMLElement => {
  const row = document.querySelector(`[data-lane="${lane}"]`);
  if (row === null) throw new Error(`no row for ${lane}`);
  return row as HTMLElement;
};

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
});

describe("the lane list", () => {
  it("names every lane the roster carries, in the server's order", async () => {
    renderResidents();

    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    expect(
      [...document.querySelectorAll("[data-lane]")].map((row) =>
        row.getAttribute("data-lane-kind"),
      ),
    ).toEqual(Object.keys(LANES));
  });

  it("says who is resident, at what weight, and whether they are listening", async () => {
    renderResidents();

    // The label arrives on a **second** round trip — the roster names the level
    // key, and the workspace's own orchestrate skill is what turns `heavy` into
    // words (`useWeightLevels`). So the wait is for the label and not for the
    // name: waiting only for the name catches the row mid-load, when
    // `weightLabel`'s documented fallback is still printing the bare key.
    await waitFor(() => {
      expect(laneRow("th_claims").textContent).toContain("Heavy or judgment-laden");
    });
    const claims = laneRow("th_claims");
    expect(claims.textContent).toContain("claims-review");
    expect(claims.getAttribute("data-lane-liveness")).toBe("live");
    // A general resident is named by the conversation it owns: two lanes labelled
    // by the role would be two rows nobody can pick between (CONTRACT-061).
    expect(laneRow("th_rent").textContent).toContain("Rent planning");
    expect(laneRow("th_rent").getAttribute("data-lane-liveness")).toBe("waiting");
  });

  it("reports a missing profile beside the name it still stands on", async () => {
    renderResidents();

    await waitFor(() => {
      expect(laneRow("th_gone").textContent).toContain("researcher");
    });
    const gone = laneRow("th_gone");
    expect(gone.textContent).toContain(MISSING_PROFILE_MARK);
    // The full report — §7's "reported rather than silently substituted" — is on
    // the row's own title, in the kit's one wording.
    expect(gone.getAttribute("title")).toContain(MISSING_PROFILE_NOTE);
    expect(gone.getAttribute("data-lane-liveness")).toBe("lapsed");
    // A designation that named no level is the launcher's choice, said as that
    // rather than as a level nobody set (CONTRACT-067).
    expect(gone.textContent).toContain("weight set at launch");
  });

  it("says how to designate when nothing has been", async () => {
    renderResidents({ lanes: [LANES.orchestrator] });

    await waitFor(() => {
      expect(screen.getByText(NO_DESIGNATIONS_NOTE)).toBeTruthy();
    });
    // The orchestrator's own row is still there: the contract makes it
    // unconditional, so its absence would be a bug and not an empty workspace.
    expect(document.querySelectorAll("[data-lane]")).toHaveLength(1);
  });
});

describe("the scope pane", () => {
  it("states what the orchestrator's lane is instead of drawing an empty scope", async () => {
    const { calls } = renderResidents();

    await waitFor(() => {
      expect(screen.getByText(ORCHESTRATOR_SCOPE_NOTE)).toBeTruthy();
    });
    expect(calls.filter((call) => call.includes("/scope"))).toEqual([]);
  });

  it("reads one scope, for the lane a person selected", async () => {
    const { calls } = renderResidents();

    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    // Nothing on mount: a roster of five lanes must not be five requests.
    expect(calls.filter((call) => call.includes("/scope"))).toEqual([]);

    await userEvent.click(laneRow("th_claims"));

    await waitFor(() => {
      expect(document.querySelectorAll("[data-scope-member]")).toHaveLength(3);
    });
    expect(calls.filter((call) => call.includes("/scope"))).toEqual([
      "/api/threads/th_claims/scope",
    ]);
  });

  it("says how each member reached the scope, as the server's walk reported it", async () => {
    renderResidents();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_claims"));

    await waitFor(() => {
      expect(document.querySelectorAll("[data-scope-member]")).toHaveLength(3);
    });
    const members = [...document.querySelectorAll("[data-scope-member]")];
    expect(members.map((member) => member.getAttribute("data-scope-via"))).toEqual([
      "self",
      "origin",
      "parent",
    ]);
    expect(members[1]?.textContent).toContain(SCOPE_VIA_MARKS.origin);
    expect(members[2]?.textContent).toContain(SCOPE_VIA_MARKS.parent);
  });

  it("keeps an archived member listed, and says it is archived", async () => {
    renderResidents();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_claims"));

    await waitFor(() => {
      expect(document.querySelector('[data-scope-member="doc_findings"]')).not.toBeNull();
    });
    const findings = document.querySelector('[data-scope-member="doc_findings"]');
    expect(findings?.getAttribute("data-scope-status")).toBe("archived");
    expect(findings?.textContent).toContain("archived");
  });

  it("states the bound rather than presenting a cut page as the whole scope", async () => {
    renderResidents({ scope: { ...CLAIMS_SCOPE, truncated: true } });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_claims"));

    await waitFor(() => {
      expect(screen.getByText(SCOPE_BOUND_NOTE)).toBeTruthy();
    });
    expect(screen.getByText("3 members listed")).toBeTruthy();
  });

  it("claims completeness only when the server said the page was not cut", async () => {
    renderResidents();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_claims"));

    await waitFor(() => {
      expect(screen.getByText("3 members in scope")).toBeTruthy();
    });
    expect(document.querySelector("[data-scope-bound]")).toBeNull();
  });

  it("reports a released lane as news rather than as a failure", async () => {
    renderResidents({ released: true });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_gone"));

    await waitFor(() => {
      expect(screen.getByText(SCOPE_RELEASED_NOTE)).toBeTruthy();
    });
  });

  it("opens a member in its column", async () => {
    const opened: string[] = [];
    renderResidents({}, (id) => opened.push(id));
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_claims"));
    await waitFor(() => {
      expect(document.querySelector('[data-scope-member="doc_findings"]')).not.toBeNull();
    });

    await userEvent.click(
      document.querySelector('[data-scope-member="doc_findings"]') as HTMLElement,
    );
    expect(opened).toEqual(["doc_findings"]);
  });

  it("says whether the resident is there, in the lane's own sentence", async () => {
    renderResidents();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_gone"));

    await waitFor(() => {
      const head = document.querySelector('[data-lane-statement="th_gone"]');
      // §7's fallback, in the words `laneRows` gives every surface: a lapse is
      // slower work, never work silently not done.
      expect(head?.textContent).toContain("the orchestrator will answer until it returns");
    });
    expect(within(laneRow("th_gone")).queryByText(MISSING_PROFILE_MARK)).not.toBeNull();
  });
});

describe("the roster's absence", () => {
  it("withholds rather than reporting an empty roster before the answer lands", () => {
    harness = createCorpusTestHarness({ fetch: vi.fn().mockReturnValue(new Promise(() => {})) });
    render(
      <Board onOpen={() => undefined}>
        <Residents />
      </Board>,
      { wrapper: harness.Wrapper },
    );

    expect(document.querySelectorAll("[data-lane]")).toHaveLength(0);
    expect(screen.getAllByRole("status")[0]?.textContent).toBe("reading the roster…");
  });
});
