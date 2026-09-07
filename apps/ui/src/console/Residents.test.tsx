/** @vitest-environment jsdom */
import type { AgentLane, Job, ThreadScope } from "@corpus/contract";
import { MISSING_PROFILE_MARK, MISSING_PROFILE_NOTE, type LaneResidentKind } from "@corpus/kit";
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardNavigationProvider, useRegisterBoardNavigation } from "../board/openInColumn";
import { ToastProvider } from "../shell/Toasts";
import { LAUNCHER_DECIDES_LABEL, RELEASED_NOTICE } from "../thread/residentActions";
import {
  NO_LEVELS as NO_LEVELS_BODY,
  SKILL_QUERY_SEARCH,
  skillDoc,
  skillRow,
} from "../testing/weightFixture";
import { Residents } from "./Residents";
import {
  LAUNCH_FAILED_LEAD,
  LAUNCH_NEVER_PROMPTED_NOTE,
  LAUNCH_READING_NOTE,
  LAUNCH_RECORDED_LEAD,
  LAUNCH_UNRECORDED_NOTE,
  NO_DESIGNATIONS_NOTE,
  ORCHESTRATOR_SCOPE_NOTE,
  RELEASE_CANCEL_LABEL,
  RELEASE_CONFIRM_LABEL,
  RELEASE_CONSEQUENCE,
  RELEASE_FAILED_LEAD,
  RELEASE_LABEL,
  SCOPE_BOUND_NOTE,
  SCOPE_RELEASED_NOTE,
  SCOPE_VIA_MARKS,
  WEIGHT_CHANGE_COST,
  WEIGHT_CHANGE_LABEL,
  WEIGHT_CHANGE_NEEDS_PROFILE,
  WEIGHT_CONTROL_ARIA,
  WEIGHT_LAUNCHER_SENTENCE,
  WEIGHT_STATED_LEAD,
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
    pending: 0,
    working: false,
    summary: null,
    origin: null,
  },
  profiled: {
    lane: "th_claims",
    resident: { name: "claims-review", docId: "doc_claims", weight: "heavy", designationId: null },
    live: true,
    since: NOW,
    pending: 0,
    working: false,
    summary: "reading the policy",
    origin: { id: "th_claims", title: "The claims conversation" },
  },
  general: {
    lane: "th_rent",
    resident: { name: null, docId: null, weight: "standard", designationId: null },
    live: false,
    since: null,
    pending: 0,
    working: false,
    summary: null,
    origin: { id: "th_rent", title: "Rent planning" },
  },
  "profile-gone": {
    lane: "th_gone",
    resident: { name: "researcher", docId: null, weight: null, designationId: null },
    live: false,
    since: LONG_AGO,
    pending: 0,
    working: false,
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
    pending: 0,
    working: false,
    summary: null,
    origin: { id: "th_quiet", title: "A quiet conversation" },
  },
};

/**
 * A general resident whose designation stated **no** level — the row the
 * screenshot behind UI-186 was showing, and the only one whose weight the tab
 * cannot answer from the roster alone.
 *
 * `LANES` has no such row: its two general-ish lanes state `standard` and its
 * `null`-weight lane is `profile-gone`, which the control refuses for its own
 * reason. So the case that matters most gets a fixture of its own.
 */
const LAUNCHER_CHOSE: AgentLane = {
  lane: "th_open",
  resident: { name: null, docId: null, weight: null, designationId: null },
  live: true,
  since: NOW,
  pending: 0,
  working: false,
  summary: null,
  origin: { id: "th_open", title: "An open question" },
};

/** The roster for the launcher-chose case: the unconditional row, and that lane. */
const OPEN_ROSTER: readonly AgentLane[] = [LANES.orchestrator, LAUNCHER_CHOSE];

/**
 * The line AGENT-059 makes a launch log, copied from the orchestrate skill's own
 * worked example. A fixture, never this suite's vocabulary — see
 * `launchRecord.test.ts`.
 */
const JUDGED_LAUNCH =
  "launched a converse listener on th_open — a general resident " +
  "(Haiku — judged: no weight chosen, the lane is for quick factual lookups)";

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

/**
 * A designation event the queue still holds, and what its log recorded —
 * AGENT-059's launch record as the tab reads it (UI-186).
 *
 * Seeded rather than derived: the launch is written by an orchestrator this
 * suite does not run, and the four states the tab has to tell apart are exactly
 * "there is a record", "the event is here and its log is empty", "the event is
 * gone" and "the read has not answered". Only a seed can produce all four.
 */
interface StubLaunch {
  readonly lane: string;
  readonly eventId: string;
  /** The lines its log holds. Omitted is an empty log — a reaped one reads so. */
  readonly lines?: readonly string[];
  /**
   * Which event prompted the launch. Omitted is the designation; `lane.waiting`
   * is the notice a **plainly created** conversation gets instead, and is the
   * only launch-prompting event such a lane ever has (SERVER-163).
   */
  readonly type?: "resident.designated" | "lane.waiting";
}

interface Workspace {
  readonly lanes?: readonly AgentLane[];
  readonly scope?: ThreadScope;
  /** Answers every scope read with the contract's `409` — the lane was released. */
  readonly released?: boolean;
  /**
   * Never answers `GET /api/docs/doc_orchestrate`, so the workspace's own words
   * for a level stay in flight (UI-131). The scan still answers: the state this
   * pins is "the skill is located and its table is not here yet", which is where
   * `weightLabel` prints the bare key.
   */
  readonly holdSkill?: boolean;
  /** A workspace whose orchestrate skill declares no tier table (SHARED-022). */
  readonly noLevels?: boolean;
  readonly launches?: readonly StubLaunch[];
  /** Never answers `GET /api/jobs`, so the launch read stays in flight. */
  readonly holdJobs?: boolean;
  /** Answers `GET /api/jobs` with a `500` — a read that failed, not an absence. */
  readonly jobsFail?: boolean;
  /** Refuses `DELETE /api/threads/{id}/resident` — a release that did not land. */
  readonly releaseFails?: boolean;
  /** Never answers the release, so the pane is held in flight and can be read there. */
  readonly releaseHolds?: boolean;
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** One `GET /api/jobs` row for a seeded launch-prompting event. */
function designationRow(launch: StubLaunch): Job {
  return {
    eventId: launch.eventId,
    type: launch.type ?? "resident.designated",
    status: "processed",
    // §7's carve-out: a designation is announced on the **orchestrator's** lane
    // whoever is designated, and its origin is the conversation.
    lane: "orchestrator",
    enqueued: NOW,
    started: NOW,
    updated: NOW,
    lastLine: launch.lines?.at(-1) ?? null,
    originId: launch.lane,
    originTitle: launch.lane,
    blockedOn: null,
    blockedOnTitle: null,
  } satisfies Job;
}

interface Wire {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly string[];
  /** Every write the tab made, in order: its path and the body it sent. */
  readonly writes: readonly { readonly path: string; readonly body: unknown }[];
}

/**
 * Stubbed at the transport, like `Console.test.tsx`'s: what matters here is
 * *which requests the tab issues* — one roster read, a scope read and a launch
 * read only for the lane a person selected — and a mocked hook could not show
 * that.
 */
function transport(workspace: Workspace = {}): Wire {
  const calls: string[] = [];
  const writes: { path: string; body: unknown }[] = [];
  /*
   * The roster is **mutable**, so a designation this suite makes is a
   * designation the next read reports. A stub that echoed the seed regardless
   * would let a green run stand for a write that never landed — the trap UI-162
   * records, one route over.
   */
  const lanes: AgentLane[] = [...(workspace.lanes ?? Object.values(LANES))];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(url.pathname + url.search);
    const method = request.method.toUpperCase();

    if (url.pathname === "/api/agents") {
      return json({ agents: lanes });
    }
    const designate = /^\/api\/threads\/([^/]+)\/resident$/.exec(url.pathname);
    if (designate !== null && method === "POST") {
      const id = designate[1] ?? "";
      // Read off the `Request`, never off `init.body`: the client sends through
      // `openapi-fetch`, which builds its own request, so a stub reading the
      // init it was handed observes `{}` for every write ever made.
      return request.text().then((raw) => {
        const body: unknown = raw === "" ? {} : JSON.parse(raw);
        writes.push({ path: url.pathname, body });
        const sent = body as { name?: unknown; weight?: unknown };
        const index = lanes.findIndex((lane) => lane.lane === id);
        const standing = lanes[index];
        if (standing !== undefined && standing.resident !== null) {
          lanes[index] = {
            ...standing,
            resident: {
              ...standing.resident,
              // Recorded verbatim, as the server records it: an absent key is
              // `null`, which is what "the launcher decides" is on the wire.
              weight: typeof sent.weight === "string" ? sent.weight : null,
            },
          };
        }
        return json({ thread: { id }, warnings: [] });
      });
    }
    /*
     * §9.2's release, and it **removes the lane from the roster** rather than
     * answering 200 and leaving the seed standing. The untyped `json({})`
     * fallback at the bottom of this stub would have answered every DELETE ever
     * sent, so a green run would have stood for a release nobody performed —
     * the trap UI-116 records on `POST .../turns` and UI-162 on `tags`.
     */
    if (designate !== null && method === "DELETE") {
      writes.push({ path: `DELETE ${url.pathname}`, body: null });
      if (workspace.releaseHolds === true) return new Promise<Response>(() => undefined);
      if (workspace.releaseFails === true) {
        return json({ code: "internal_error", message: "the lane could not be reached" }, 500);
      }
      const id = designate[1] ?? "";
      const index = lanes.findIndex((lane) => lane.lane === id);
      if (index >= 0) lanes.splice(index, 1);
      return json({ thread: { id }, warnings: [] });
    }
    if (url.pathname === "/api/jobs") {
      if (workspace.holdJobs === true) return new Promise<Response>(() => undefined);
      if (workspace.jobsFail === true) {
        return json({ code: "internal", message: "the queue is unreadable" }, 500);
      }
      const origin = url.searchParams.get("originId");
      const rows = (workspace.launches ?? [])
        .filter((launch) => origin === null || launch.lane === origin)
        .map(designationRow);
      return json({ jobs: rows, total: rows.length, truncated: false });
    }
    const jobLog = /^\/api\/jobs\/([^/]+)\/log$/.exec(url.pathname);
    if (jobLog !== null) {
      const eventId = jobLog[1] ?? "";
      const launch = (workspace.launches ?? []).find((row) => row.eventId === eventId);
      const lines = (launch?.lines ?? []).map((line) => ({ ts: NOW, line }));
      const cursor = Number(url.searchParams.get("cursor") ?? "0");
      return json({ lines: lines.slice(cursor > 0 ? cursor : 0), nextCursor: lines.length });
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
    if (url.pathname === "/api/docs/doc_orchestrate") {
      if (workspace.holdSkill === true) return new Promise<Response>(() => undefined);
      return json(workspace.noLevels === true ? skillDoc(NO_LEVELS_BODY) : skillDoc());
    }
    if (url.pathname === "/api/docs") {
      return json({ items: [], page: { total: 0, limit: 50, offset: 0 } });
    }
    return json({});
  };
  return { fetch: fetchImpl, calls, writes };
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
      {/* The weight control narrates what it did; outside a provider that
          narration is a silent no-op, which would make it unassertable. */}
      <ToastProvider>
        {children}
        <Register onOpen={onOpen} />
      </ToastProvider>
    </BoardNavigationProvider>
  );
}

function Register({ onOpen }: { onOpen: (id: string) => void }): null {
  useRegisterBoardNavigation({
    open: (target) => {
      onOpen(target.docId);
    },
    revealColumn: () => undefined,
    openFullScreen: () => undefined,
  });
  return null;
}

function renderResidents(
  workspace: Workspace = {},
  onOpen: (id: string) => void = () => undefined,
): Wire {
  const wire = transport(workspace);
  harness = createCorpusTestHarness({ fetch: wire.fetch });
  render(
    <Board onOpen={onOpen}>
      <Residents />
    </Board>,
    { wrapper: harness.Wrapper },
  );
  return wire;
}

const laneRow = (lane: string): HTMLElement => {
  const row = document.querySelector(`[data-lane="${lane}"]`);
  if (row === null) throw new Error(`no row for ${lane}`);
  return row as HTMLElement;
};

/** The one reserved box a lane's weight lives in, whichever answer is in it. */
const weightBox = (lane: string): HTMLElement => {
  const box = laneRow(lane).querySelector(".lane-weight");
  if (box === null) throw new Error(`no weight box on ${lane}`);
  return box as HTMLElement;
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

  /*
   * UI-131. The comment above documents a swap this suite could never see the
   * cost of: the box grew 119px when the words landed, on a 380px row that is a
   * `<button>` — and jsdom implements no layout at all, so it passed against the
   * defect it described. **The geometry is asserted in a real browser**, by
   * `apps/ui/e2e/resident-weight-geometry.spec.ts`, which holds the skill body
   * open and measures every child of the row before and after it lands.
   *
   * What these two assert is the contract that makes the reservation possible:
   * one box, reserved by class (`console.css` sizes `.lane-weight` in `ch`),
   * holding whichever answer is current — and the whole of that answer on a
   * `title`, so a workspace whose own words run past the reservation still reads.
   */
  it("holds the key in the weight box while the workspace's own words are in flight", async () => {
    renderResidents({ holdSkill: true });

    await waitFor(() => {
      expect(weightBox("th_claims").textContent).toBe("heavy");
    });
    expect(weightBox("th_claims").getAttribute("title")).toBe("heavy");
  });

  it("puts the words in that same box, and the whole of them on a title", async () => {
    renderResidents();

    await waitFor(() => {
      expect(weightBox("th_claims").textContent).toBe("Heavy or judgment-laden");
    });
    expect(weightBox("th_claims").getAttribute("title")).toBe("Heavy or judgment-laden");
    // …and the row's one sentence carries it too, so the value is reachable from
    // the row a person is already pointing at (SHARED-057 clause 2).
    expect(laneRow("th_claims").getAttribute("title")).toContain("Heavy or judgment-laden");
    // The orchestrator's lane has no designation to weigh, so its own sentence
    // gains no clause — a dangling separator would read as one somebody lost.
    expect(laneRow("orchestrator").getAttribute("title")).not.toContain(" · ");
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
      expect(head?.textContent).toContain("no listener right now");
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

/**
 * UI-186's first half: **what this lane's resident works at, and where that
 * level came from** (SPEC.md §7's *"a dispatch says what weight it went out at,
 * and where that weight came from"*).
 *
 * The four cases are the four the issue names, and they are asserted through the
 * tab rather than over the model alone, because three of them are decided by
 * *which requests have answered* — a distinction no pure function sees.
 */
describe("what the launch went out at", () => {
  const selectOpen = async (): Promise<void> => {
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(2);
    });
    await userEvent.click(laneRow("th_open"));
  };

  const weightNote = (lane: string): string =>
    document.querySelector(`[data-lane-weight-note="${lane}"]`)?.textContent ?? "";

  it("says a stated level was stated, in the workspace's own words", async () => {
    renderResidents();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_claims"));

    await waitFor(() => {
      expect(weightNote("th_claims")).toContain(`${WEIGHT_STATED_LEAD}: Heavy or judgment-laden.`);
    });
    // A level somebody asked for is not the same fact as one the launcher
    // picked, so the launcher's sentence is not said here.
    expect(weightNote("th_claims")).not.toContain(WEIGHT_LAUNCHER_SENTENCE);
  });

  it("shows what the launcher chose, read off the launch's own record", async () => {
    renderResidents({
      lanes: OPEN_ROSTER,
      launches: [{ lane: "th_open", eventId: "evt_d", lines: [JUDGED_LAUNCH] }],
    });
    await selectOpen();

    await waitFor(() => {
      expect(weightNote("th_open")).toContain(LAUNCH_RECORDED_LEAD);
    });
    // The clause **verbatim**: the tab labels what the launch recorded and
    // re-derives nothing from it.
    expect(weightNote("th_open")).toContain(
      "Haiku — judged: no weight chosen, the lane is for quick factual lookups",
    );
    expect(weightNote("th_open")).toContain(WEIGHT_LAUNCHER_SENTENCE);
    expect(weightNote("th_open")).not.toContain(LAUNCH_UNRECORDED_NOTE);
  });

  /*
   * §7 reaps a job's log with its event, so a lapsed three-day-old lane
   * legitimately has nothing left. §10's standing rule decides what to show:
   * the absence, said plainly, and never a level nobody wrote down.
   */
  it("says the record is gone rather than naming a level nobody recorded", async () => {
    // The event is still on the queue and its log holds no launch: reaped, or
    // written by guidance that predates AGENT-059.
    renderResidents({ lanes: OPEN_ROSTER, launches: [{ lane: "th_open", eventId: "evt_d" }] });
    await selectOpen();

    await waitFor(() => {
      expect(weightNote("th_open")).toContain(LAUNCH_UNRECORDED_NOTE);
    });
    expect(weightNote("th_open")).toContain(WEIGHT_LAUNCHER_SENTENCE);
    expect(weightNote("th_open")).not.toContain(LAUNCH_NEVER_PROMPTED_NOTE);
  });

  /*
   * **The other absence, and it is not the same absence** (SERVER-163). The
   * queue holds no event that would have launched this lane — no designation
   * and no waiting notice — so nothing has ever run here and there is no record
   * to be missing. This is the ordinary state of a conversation created plainly:
   * §7's rider A gives it a general resident, and the listener starts when the
   * lane has work rather than when the thread is made.
   */
  it("tells a lane nothing ever launched apart from one whose record is gone", async () => {
    renderResidents({ lanes: OPEN_ROSTER, launches: [] });
    await selectOpen();

    await waitFor(() => {
      expect(weightNote("th_open")).toContain(LAUNCH_NEVER_PROMPTED_NOTE);
    });
    // …and it does not claim a record went missing, which is what it said
    // before and was not true.
    expect(weightNote("th_open")).not.toContain(LAUNCH_UNRECORDED_NOTE);
  });

  /*
   * A plainly created conversation's launch is logged on the `lane.waiting`
   * that asked for it, which is the only launch-prompting event it ever gets
   * (SERVER-163). Reading only designations reported *"unknown"* for the
   * commonest lane in a workspace while the record sat on the queue beside it.
   */
  it("reads the launch a `lane.waiting` recorded, for a plainly created lane", async () => {
    renderResidents({
      lanes: OPEN_ROSTER,
      launches: [
        { lane: "th_open", eventId: "evt_w", type: "lane.waiting", lines: [JUDGED_LAUNCH] },
      ],
    });
    await selectOpen();

    await waitFor(() => {
      expect(weightNote("th_open")).toContain(LAUNCH_RECORDED_LEAD);
    });
    expect(weightNote("th_open")).toContain(
      "Haiku — judged: no weight chosen, the lane is for quick factual lookups",
    );
    expect(weightNote("th_open")).not.toContain(LAUNCH_NEVER_PROMPTED_NOTE);
  });

  /*
   * UI-098's rule at this grain, and it is the one that matters most here: a
   * read that has not answered must never be reported as an absence, because
   * this absence is a claim about what an agent ran as.
   */
  it("withholds while the read is in flight rather than reporting an absence", async () => {
    renderResidents({ lanes: OPEN_ROSTER, holdJobs: true });
    await selectOpen();

    await waitFor(() => {
      expect(weightNote("th_open")).toContain(LAUNCH_READING_NOTE);
    });
    expect(weightNote("th_open")).not.toContain(LAUNCH_UNRECORDED_NOTE);
  });

  it("reports a failed read as a failure, keeping the server's own message", async () => {
    renderResidents({ lanes: OPEN_ROSTER, jobsFail: true });
    await selectOpen();

    await waitFor(() => {
      expect(weightNote("th_open")).toContain(LAUNCH_FAILED_LEAD);
    });
    expect(weightNote("th_open")).not.toContain(LAUNCH_UNRECORDED_NOTE);
  });

  it("says nothing at all on the orchestrator's lane, which has no designation", async () => {
    const wire = renderResidents();
    await waitFor(() => {
      expect(screen.getByText(ORCHESTRATOR_SCOPE_NOTE)).toBeTruthy();
    });
    expect(document.querySelector("[data-lane-weight-panel]")).toBeNull();
    // …and nothing was asked about a lane there is nothing to ask about.
    expect(wire.calls.filter((call) => call.startsWith("/api/jobs"))).toEqual([]);
  });

  it("says nothing on a designated lane the roster reports with no resident", async () => {
    renderResidents();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });
    await userEvent.click(laneRow("th_quiet"));

    await waitFor(() => {
      expect(document.querySelector('[data-lane-scope="th_quiet"]')).not.toBeNull();
    });
    expect(document.querySelector("[data-lane-weight-panel]")).toBeNull();
  });

  it("reads the launch for the selected lane and for no other", async () => {
    const wire = renderResidents({
      lanes: OPEN_ROSTER,
      launches: [{ lane: "th_open", eventId: "evt_d", lines: [JUDGED_LAUNCH] }],
    });
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(2);
    });
    // Nothing on mount: §7 forbids the sweep, and one launch read per row is
    // what that would look like here (UI-075's fan-out, one tab over).
    expect(wire.calls.filter((call) => call.startsWith("/api/jobs"))).toEqual([]);

    await userEvent.click(laneRow("th_open"));
    await waitFor(() => {
      expect(wire.calls.filter((call) => call.startsWith("/api/jobs/"))).toHaveLength(1);
    });
    expect(wire.calls.filter((call) => call.startsWith("/api/jobs?"))).toEqual([
      "/api/jobs?originId=th_open",
    ]);
  });
});

/**
 * UI-186's second half, and the user's own words for it (2026-09-02): *"maybe we
 * make it possible to change a resident's model from the residents tab. That
 * would make the mistake less of a problem."*
 *
 * Every assertion below is about **the write on the wire**, because that is the
 * acceptance criterion: the change must be the re-designation the server already
 * performs, and not a second mechanism.
 */
describe("changing a resident's weight", () => {
  const pick = async (label: string): Promise<void> => {
    // The kit `Select` (UI-191): open the pill, press the row by its label.
    await userEvent.click(screen.getByLabelText(WEIGHT_CONTROL_ARIA));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: label }));
  };
  const apply = async (): Promise<void> => {
    await userEvent.click(screen.getByRole("button", { name: WEIGHT_CHANGE_LABEL }));
  };
  const openLane = async (lane: string, count: number): Promise<void> => {
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(count);
    });
    await userEvent.click(laneRow(lane));
    await waitFor(() => {
      expect(document.querySelector(`[data-lane-weight-panel="${lane}"]`)).not.toBeNull();
    });
  };

  it("re-designates the general resident at the level chosen", async () => {
    const wire = renderResidents({ lanes: OPEN_ROSTER, launches: [] });
    await openLane("th_open", 2);
    await waitFor(() => {
      expect(screen.getByLabelText(WEIGHT_CONTROL_ARIA)).toBeTruthy();
    });

    await pick("Heavy or judgment-laden");
    await apply();

    await waitFor(() => {
      expect(wire.writes).toHaveLength(1);
    });
    // The mechanism that already exists: a designation on the thread, carrying
    // the new weight. No profile, because this resident has none.
    expect(wire.writes[0]).toEqual({
      path: "/api/threads/th_open/resident",
      body: { weight: "heavy" },
    });
  });

  it("keeps the profile it is re-designating, so only the level moves", async () => {
    const wire = renderResidents();
    await openLane("th_claims", 5);
    await waitFor(() => {
      expect(screen.getByLabelText(WEIGHT_CONTROL_ARIA)).toBeTruthy();
    });

    await pick("Small and mechanical");
    await apply();

    await waitFor(() => {
      expect(wire.writes).toHaveLength(1);
    });
    expect(wire.writes[0]?.body).toEqual({ name: "claims-review", weight: "light" });
  });

  /*
   * "The launcher decides" is a real outcome the contract reports back
   * (`Resident.weight` null), and the way back once a level has been picked. It
   * travels as the **absence** of the key, which is the only spelling of it the
   * route accepts (CONTRACT-067).
   */
  it("clears a stated level back to the launcher's choice, as an absent key", async () => {
    const wire = renderResidents();
    await openLane("th_claims", 5);
    await waitFor(() => {
      expect(screen.getByLabelText(WEIGHT_CONTROL_ARIA)).toBeTruthy();
    });

    await pick(LAUNCHER_DECIDES_LABEL);
    await apply();

    await waitFor(() => {
      expect(wire.writes).toHaveLength(1);
    });
    expect(wire.writes[0]?.body).toEqual({ name: "claims-review" });
  });

  it("offers the act and refuses to perform it until the level differs", async () => {
    const wire = renderResidents();
    await openLane("th_claims", 5);
    await waitFor(() => {
      expect(screen.getByLabelText(WEIGHT_CONTROL_ARIA)).toBeTruthy();
    });

    // Seeded from the level in force, so pressing would write the state that
    // already holds — offered and dimmed rather than removed.
    const button = screen.getByRole("button", { name: WEIGHT_CHANGE_LABEL });
    expect(button).toHaveProperty("disabled", true);
    await userEvent.click(button);
    expect(wire.writes).toEqual([]);
  });

  /*
   * SHARED-076: the act says what it costs **before it is taken**. The price
   * appears with the act — when a level different from the one in force is
   * chosen — and not at rest, which is a measured budget decision the component
   * records: a permanently rendered cost paragraph left the lane's scope list
   * 12px in a 210px drawer.
   */
  it("says what changing costs, once there is a change to make", async () => {
    renderResidents({ lanes: OPEN_ROSTER, launches: [] });
    await openLane("th_open", 2);
    await waitFor(() => {
      expect(screen.getByLabelText(WEIGHT_CONTROL_ARIA)).toBeTruthy();
    });
    // Nothing to change yet, so no price is quoted — and no act is offered
    // either, so nothing can be taken uninformed.
    expect(document.querySelector('[data-lane-weight-cost="th_open"]')).toBeNull();
    expect(screen.getByRole("button", { name: WEIGHT_CHANGE_LABEL })).toHaveProperty(
      "disabled",
      true,
    );

    await pick("Standard");

    await waitFor(() => {
      expect(document.querySelector('[data-lane-weight-cost="th_open"]')?.textContent).toBe(
        WEIGHT_CHANGE_COST,
      );
    });
    // It is on the screen while the act is still available and not yet taken.
    expect(screen.getByRole("button", { name: WEIGHT_CHANGE_LABEL })).toHaveProperty(
      "disabled",
      false,
    );
    // The conversation is not what is lost, and the sentence says so — the half
    // SHARED-076 corrects §7 on.
    expect(WEIGHT_CHANGE_COST).toContain("never the conversation");
  });

  it("offers no control where the workspace declares no levels", async () => {
    renderResidents({ lanes: OPEN_ROSTER, launches: [], noLevels: true });
    await openLane("th_open", 2);

    // The sentence still stands: what the launch went out at is a fact whatever
    // the guidance declares. Only the change control depends on the table.
    await waitFor(() => {
      expect(document.querySelector('[data-lane-weight-note="th_open"]')).not.toBeNull();
    });
    expect(screen.queryByLabelText(WEIGHT_CONTROL_ARIA)).toBeNull();
    expect(screen.queryByRole("button", { name: WEIGHT_CHANGE_LABEL })).toBeNull();
  });

  /*
   * A re-designation names the profile, and a gone one earns a `404`
   * (`residentFor`). An offer that could only fail is worse than none, so the
   * tab says what would have to happen first.
   */
  it("offers no control on a lane whose profile has gone, and says why", async () => {
    renderResidents();
    await openLane("th_gone", 5);

    await waitFor(() => {
      expect(document.querySelector('[data-lane-weight-blocked="th_gone"]')?.textContent).toBe(
        WEIGHT_CHANGE_NEEDS_PROFILE,
      );
    });
    expect(screen.queryByRole("button", { name: WEIGHT_CHANGE_LABEL })).toBeNull();
  });

  it("narrates the change, and the roster reports the level that landed", async () => {
    renderResidents({ lanes: OPEN_ROSTER, launches: [] });
    await openLane("th_open", 2);
    await waitFor(() => {
      expect(screen.getByLabelText(WEIGHT_CONTROL_ARIA)).toBeTruthy();
    });

    await pick("Heavy or judgment-laden");
    await apply();

    await waitFor(() => {
      expect(screen.getByText(/Re-designated at Heavy or judgment-laden/)).toBeTruthy();
    });
    // The write landed and the read that follows it reports it: the tab now
    // says the level was stated, where a moment ago it said the launcher chose.
    await waitFor(() => {
      expect(document.querySelector('[data-lane-weight-note="th_open"]')?.textContent).toContain(
        `${WEIGHT_STATED_LEAD}: Heavy or judgment-laden.`,
      );
    });
  });
});

/**
 * Stopping a resident where the pane shows it (UI-195).
 *
 * The one act §9.2 gives a person with an observable end, offered on the lane
 * they are looking at. The seed matters as much as the assertions: the stub's
 * `DELETE` **removes the lane from the roster**, so a row that leaves the list is
 * evidence a release landed rather than evidence that a component hid something.
 */
describe("releasing a resident from the pane", () => {
  const openLane = async (lane: string, count: number): Promise<void> => {
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(count);
    });
    await userEvent.click(laneRow(lane));
    await waitFor(() => {
      expect(document.querySelector(`[data-lane-release-panel="${lane}"]`)).not.toBeNull();
    });
  };
  const arm = async (): Promise<void> => {
    await userEvent.click(screen.getByRole("button", { name: RELEASE_LABEL }));
  };
  const confirm = async (): Promise<void> => {
    await userEvent.click(screen.getByRole("button", { name: RELEASE_CONFIRM_LABEL }));
  };

  it("offers the act on a lane with a resident, and nothing on a lane without one", async () => {
    renderResidents();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-lane]")).toHaveLength(5);
    });

    // The orchestrator's lane belongs to no conversation and was designated by
    // nobody, and it is the row the pane opens on.
    await waitFor(() => {
      expect(document.querySelector('[data-lane-scope="orchestrator"]')).not.toBeNull();
    });
    expect(document.querySelector("[data-lane-release-panel]")).toBeNull();

    // …and an `unknown` row is a designated lane the roster reports with no
    // resident on it. Nothing to release there either.
    await userEvent.click(laneRow("th_quiet"));
    await waitFor(() => {
      expect(document.querySelector('[data-lane-scope="th_quiet"]')).not.toBeNull();
    });
    expect(document.querySelector("[data-lane-release-panel]")).toBeNull();

    await openLane("th_claims", 5);
    expect(screen.getByRole("button", { name: RELEASE_LABEL })).toBeTruthy();
  });

  /*
   * §8's rider signed 2026-09-06 is the sentence: the lane returns to ordinary
   * routing, the thread stays engaged, and the ordinary agent answers it. The
   * first press states it and writes nothing.
   */
  it("states the consequence before it acts, and the first press is not the act", async () => {
    const wire = renderResidents();
    await openLane("th_claims", 5);

    // Readable before anything is pressed at all: the whole sentence rides the
    // resting control, for a person who never arms it.
    expect(screen.getByRole("button", { name: RELEASE_LABEL }).getAttribute("title")).toBe(
      RELEASE_CONSEQUENCE,
    );
    expect(document.querySelector('[data-lane-release-consequence="th_claims"]')).toBeNull();

    await arm();

    await waitFor(() => {
      expect(
        document.querySelector('[data-lane-release-consequence="th_claims"]')?.textContent,
      ).toBe(RELEASE_CONSEQUENCE);
    });
    // Nothing was sent. The act is the second press.
    expect(wire.writes).toEqual([]);
    expect(screen.getByRole("button", { name: RELEASE_CONFIRM_LABEL })).toBeTruthy();
    // Both halves of the rider: the agent stops, and the conversation does not.
    expect(RELEASE_CONSEQUENCE).toContain("stops this lane's agent");
    expect(RELEASE_CONSEQUENCE).toContain("stays open and engaged");
    expect(RELEASE_CONSEQUENCE).toContain("ordinary agent answers it");
  });

  /*
   * The section is taller armed than the space a 210px drawer leaves it, so the
   * confirm would land below the pane's edge. `.lane-scope` scrolls and this
   * uses it. jsdom implements no scrolling, so what is asserted is the call —
   * the geometry was measured against the real app instead.
   */
  it("brings itself into view when it arms, so the presses arrive with the sentence", async () => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      renderResidents();
      await openLane("th_claims", 5);
      expect(scrollIntoView).not.toHaveBeenCalled();

      await arm();

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });
      const target = scrollIntoView.mock.instances[0] as Element;
      expect(target.getAttribute("data-lane-release-panel")).toBe("th_claims");

      // Disarming shrinks the section, so nothing is scrolled on the way out.
      scrollIntoView.mockClear();
      await userEvent.click(screen.getByRole("button", { name: RELEASE_CANCEL_LABEL }));
      await waitFor(() => {
        expect(document.querySelector('[data-lane-release-consequence="th_claims"]')).toBeNull();
      });
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      } else {
        Object.defineProperty(Element.prototype, "scrollIntoView", original);
      }
    }
  });

  it("sends §9.2's release, and nothing else", async () => {
    const wire = renderResidents();
    await openLane("th_claims", 5);
    await arm();
    await confirm();

    await waitFor(() => {
      expect(wire.writes).toHaveLength(1);
    });
    // The existing route through the kit's existing mutation — no new surface,
    // and no designation masquerading as a stop.
    expect(wire.writes[0]).toEqual({
      path: "DELETE /api/threads/th_claims/resident",
      body: null,
    });
  });

  it("keeps the row on the screen until the server has answered", async () => {
    renderResidents({ releaseHolds: true });
    await openLane("th_claims", 5);
    await arm();
    await confirm();

    // The request is out and unanswered. Nothing may claim the agent stopped:
    // §9.2's effect is observable, and painting it early is the one thing this
    // pane must not do.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: RELEASE_CONFIRM_LABEL })).toHaveProperty(
        "disabled",
        true,
      );
    });
    expect(document.querySelector('[data-lane="th_claims"]')).not.toBeNull();
    expect(document.querySelector('[data-lane-release-panel="th_claims"]')).not.toBeNull();
  });

  it("drops the lane when the roster stops naming it, and says what happened", async () => {
    renderResidents();
    await openLane("th_claims", 5);
    await arm();
    await confirm();

    // The roster is refetched because the mutation invalidates ["agents"], and
    // the lane is gone from the answer — which is the server confirming, not
    // this component hiding a row.
    await waitFor(() => {
      expect(document.querySelector('[data-lane="th_claims"]')).toBeNull();
    });
    expect(document.querySelectorAll("[data-lane]")).toHaveLength(4);
    // The pane does not strand itself on a row that has gone.
    await waitFor(() => {
      expect(document.querySelector('[data-lane-scope="orchestrator"]')).not.toBeNull();
    });
    // One wording for one act: the conversation's own menu says this sentence.
    expect(screen.getByText(RELEASED_NOTICE)).toBeTruthy();
  });

  it("keeps the resident when the way out is taken", async () => {
    const wire = renderResidents();
    await openLane("th_claims", 5);
    await arm();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: RELEASE_CANCEL_LABEL })).toBeTruthy();
    });

    await userEvent.click(screen.getByRole("button", { name: RELEASE_CANCEL_LABEL }));

    await waitFor(() => {
      expect(document.querySelector('[data-lane-release-consequence="th_claims"]')).toBeNull();
    });
    expect(wire.writes).toEqual([]);
    expect(document.querySelector('[data-lane="th_claims"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: RELEASE_LABEL })).toBeTruthy();
  });

  it("keeps the lane and reports the server's own words when the release fails", async () => {
    renderResidents({ releaseFails: true });
    await openLane("th_claims", 5);
    await arm();
    await confirm();

    await waitFor(() => {
      expect(
        screen.getByText(`${RELEASE_FAILED_LEAD}: the lane could not be reached`),
      ).toBeTruthy();
    });
    // Nothing stopped, so the row is where it was.
    expect(document.querySelector('[data-lane="th_claims"]')).not.toBeNull();
  });

  /*
   * The one lane the weight control refuses and this one does not: a release
   * names no profile that has to resolve, so a resident whose `agent-def` has
   * gone can still be stopped where it is shown.
   */
  it("releases a lane whose profile has gone, which the weight control refuses", async () => {
    const wire = renderResidents();
    await openLane("th_gone", 5);
    await waitFor(() => {
      expect(document.querySelector('[data-lane-weight-blocked="th_gone"]')).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: WEIGHT_CHANGE_LABEL })).toBeNull();

    await arm();
    await confirm();

    await waitFor(() => {
      expect(wire.writes).toEqual([{ path: "DELETE /api/threads/th_gone/resident", body: null }]);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-lane="th_gone"]')).toBeNull();
    });
  });
});
