/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCorpusTestHarness, docRowFixture } from "../testing/index.js";
import { Row, type RowProps } from "./Row.js";
import { deferredRowTitle } from "./useRowSignals.js";

afterEach(cleanup);

const NOW = new Date("2026-07-27T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

interface Wired {
  readonly container: HTMLElement;
  readonly requests: { method: string; path: string; body: unknown }[];
}

/**
 * Renders a row through the **real** provider with a stubbed transport, which is
 * the shipped pattern: mocking the kit's own hooks would test the mock.
 */
function renderRow(
  props: Partial<RowProps> & { readonly row: DocRow },
  bodies: Record<string, unknown> = {},
): Wired {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    const raw = await request.text();
    requests.push({
      method: request.method,
      path: pathname,
      body: raw === "" ? undefined : (JSON.parse(raw) as unknown),
    });
    const defaults: Record<string, unknown> = {
      "/api/jobs": { jobs: [] },
    };
    return new Response(JSON.stringify(bodies[pathname] ?? defaults[pathname] ?? {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const harness = createCorpusTestHarness({ fetch: fetch as unknown as typeof globalThis.fetch });
  const { container } = render(<Row now={NOW} {...props} />, { wrapper: harness.Wrapper });
  return { container, requests };
}

describe("row anatomy", () => {
  it("renders the prototype's top line, excerpt and meta line", () => {
    const { container } = renderRow({
      row: docRowFixture({
        title: "Home insurance renewal",
        excerpt: "Policy lapses Oct 1.",
        path: "data/docs/home/insurance.md",
        updated: daysAgo(3),
      }),
    });

    expect(container.querySelector(".type-glyph")?.textContent).toBe("note");
    expect(container.querySelector(".row-title")?.textContent).toBe("Home insurance renewal");
    expect(container.querySelector(".row-excerpt")?.textContent).toBe("Policy lapses Oct 1.");
    expect(container.querySelector(".row-context")?.textContent).toBe("home/");
    expect(container.querySelector(".row-meta .age")?.textContent).toBe("3d");
  });

  it("is a real control with an accessible name, activatable by pointer and by keyboard", () => {
    const onOpen = vi.fn();
    renderRow({ row: docRowFixture({ title: "Budget" }), onOpen });

    const row = screen.getByRole("button", { name: "note: Budget" });
    expect(row.getAttribute("tabindex")).toBe("0");

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Budget" }));
  });

  it("does nothing on activation when the host supplied no open handler", () => {
    renderRow({ row: docRowFixture() });
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("ignores keys that are not activation keys", () => {
    const onOpen = vi.fn();
    renderRow({ row: docRowFixture(), onOpen });
    fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowDown" });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("badges", () => {
  it("shows the unread pill for an unread thread", () => {
    const { container } = renderRow({
      row: docRowFixture({ type: "thread", parent: "doc_a", unread: true }),
    });
    expect(container.querySelector(".unread")).not.toBeNull();
  });

  // TEST-116. `unread` is null on a document row *by contract*; its aggregate
  // lives in `unreadThreads`, and gating the pill on the boolean alone is what
  // left the count correct on the wire and invisible on screen.
  it("shows the aggregate pill on a document row with unread threads", () => {
    const { container } = renderRow({ row: docRowFixture({ unreadThreads: 3 }) });
    const badge = container.querySelector(".unread");
    expect(badge?.textContent).toBe("3");
    expect(badge?.getAttribute("aria-label")).toBe("3 unread threads");
  });

  it("shows no unread pill for a document with nothing unread", () => {
    const { container } = renderRow({ row: docRowFixture({ unread: null, unreadThreads: 0 }) });
    expect(container.querySelector(".unread")).toBeNull();
  });

  it("draws exactly one unread pill, never one per axis", () => {
    const { container } = renderRow({
      row: docRowFixture({ type: "thread", parent: "doc_a", unread: true, unreadThreads: 4 }),
    });
    expect(container.querySelectorAll(".unread")).toHaveLength(1);
    expect(container.querySelector(".unread")?.textContent).toBe("new");
  });

  it("renders a supplied unread count", () => {
    const { container } = renderRow({
      row: docRowFixture({ type: "thread", parent: "doc_a", unread: true }),
      unreadCount: 2,
    });
    expect(container.querySelector(".unread")?.textContent).toBe("2");
  });

  it.each([
    [["form"], "form"],
    [["due"], "due"],
    [["form", "due"], "form"],
  ])("derives the needs-you text %j as %s", (attention, text) => {
    const { container } = renderRow({ row: docRowFixture({ attention: attention as never }) });
    expect(container.querySelector(".needs-you")?.textContent).toBe(text);
  });

  it("shows no needs-you pill when nothing is owed", () => {
    const { container } = renderRow({ row: docRowFixture({ attention: ["stale"] }) });
    expect(container.querySelector(".needs-you")).toBeNull();
  });

  /**
   * `awaitingAgent` says the reply has not arrived; it does **not** say anybody
   * is writing one, and the queue's answer for this row may be silent for a
   * dozen honest reasons (UI-097). So the row shows the still dot, which claims
   * exactly what is known: the agent owes this thread something.
   */
  it("marks a row as waiting while the agent owes the thread a reply", () => {
    const { container } = renderRow({
      row: docRowFixture({ type: "thread", parent: "doc_a", awaitingAgent: true }),
    });
    const dot = container.querySelector(".queued-dot");
    expect(dot?.getAttribute("title")).toContain("Agent has not replied");
    expect(container.querySelector(".working-dot")).toBeNull();
  });

  it("clears the dot once the reply has landed", () => {
    const { container } = renderRow({
      row: docRowFixture({ type: "thread", parent: "doc_a", awaitingAgent: false }),
    });
    expect(container.querySelector(".working-dot")).toBeNull();
    expect(container.querySelector(".queued-dot")).toBeNull();
  });

  /**
   * SPEC.md §7 replaced the lock with a key, and §10 made the board never
   * read-only: there is no holder to name on a row and no projection to name
   * one from. A row therefore draws no lock chip and — the part worth pinning —
   * **asks nobody for one**, because a row hook runs once per card and a
   * resurrected per-row lock question would be the exact economics this module
   * exists to avoid.
   */
  it("draws no lock chip, and asks the server for no lock state", async () => {
    const { container, requests } = renderRow({ row: docRowFixture({ id: "doc_cashflow" }) });
    await waitFor(() => {
      expect(container.querySelector(".row")).not.toBeNull();
    });
    expect(container.querySelector(".chip.warn")).toBeNull();
    expect(requests.filter((call) => call.path.includes("/locks"))).toHaveLength(0);
  });

  it("shows the working dot for a document with a live queue job", async () => {
    const { container } = renderRow(
      { row: docRowFixture({ id: "doc_401k" }) },
      {
        "/api/jobs": {
          jobs: [
            {
              eventId: "evt_1",
              status: "in-progress",
              started: NOW.toISOString(),
              updated: NOW.toISOString(),
              lastLine: "filing into finance/",
              originId: "doc_401k",
              originTitle: "401k rollover",
            },
          ],
        },
      },
    );
    await waitFor(() => {
      expect(container.querySelector(".working-dot")?.getAttribute("title")).toBe(
        "filing into finance/",
      );
    });
  });

  it("ignores a job that has already finished", async () => {
    const { container } = renderRow(
      { row: docRowFixture({ id: "doc_401k" }) },
      {
        "/api/jobs": {
          jobs: [
            {
              eventId: "evt_1",
              status: "processed",
              started: NOW.toISOString(),
              updated: NOW.toISOString(),
              lastLine: null,
              originId: "doc_401k",
              originTitle: "401k rollover",
            },
          ],
        },
      },
    );
    await waitFor(() => {
      expect(container.querySelector(".row")).not.toBeNull();
    });
    expect(container.querySelector(".working-dot")).toBeNull();
  });

  /**
   * UI-097. A `pending` event is **unclaimed** — the queue holds it and nobody
   * has taken it — so the row must not pulse. A backlog nobody is working would
   * otherwise light up every row it named, which is the row-sized version of the
   * "agent is working…" a person saw with no agent running at all.
   */
  it("does not pulse for a queued event nobody has claimed", async () => {
    const { container } = renderRow(
      { row: docRowFixture({ id: "doc_401k" }) },
      {
        "/api/jobs": {
          jobs: [
            {
              eventId: "evt_1",
              status: "pending",
              started: NOW.toISOString(),
              updated: NOW.toISOString(),
              lastLine: null,
              originId: "doc_401k",
              originTitle: "401k rollover",
            },
          ],
        },
      },
    );
    await waitFor(() => {
      expect(container.querySelector(".queued-dot")?.getAttribute("title")).toBe(
        "Queued — waiting to be picked up",
      );
    });
    expect(container.querySelector(".working-dot")).toBeNull();
  });

  /**
   * And the other direction, on one row: a claimed event outranks an unclaimed
   * one, because one event being held makes "the agent is working on this" true
   * while any number of queued ones does not.
   */
  it("pulses when any of the row's events has actually been claimed", async () => {
    const { container } = renderRow(
      { row: docRowFixture({ id: "doc_401k" }) },
      {
        "/api/jobs": {
          jobs: [
            {
              eventId: "evt_queued",
              status: "pending",
              started: NOW.toISOString(),
              updated: NOW.toISOString(),
              lastLine: null,
              originId: "doc_401k",
              originTitle: "401k rollover",
            },
            {
              eventId: "evt_held",
              status: "in-progress",
              started: NOW.toISOString(),
              updated: NOW.toISOString(),
              lastLine: "filing into finance/",
              originId: "doc_401k",
              originTitle: "401k rollover",
            },
          ],
        },
      },
    );
    await waitFor(() => {
      expect(container.querySelector(".working-dot")?.getAttribute("title")).toBe(
        "filing into finance/",
      );
    });
    expect(container.querySelector(".queued-dot")).toBeNull();
  });

  /**
   * UI-115. A **deferral** is not an unclaimed event: it was taken, read, and
   * put down because a person is editing the document it needs (SPEC.md §7).
   * The dot is unchanged — nothing is being worked — and the sentence behind it
   * says what a bare "waiting to be picked up" cannot: that it was seen, and
   * what it is parked on. It is the only wait the reader can end.
   *
   * The deferral is read **before** the queued event beside it, which is the
   * precedence `apps/ui`'s `pendingStateOf` uses for the conversation's own
   * pending row: the two must not disagree about what state a row is in.
   */
  it("says what a parked event is parked on, ahead of an unclaimed one", async () => {
    const { container } = renderRow(
      { row: docRowFixture({ id: "doc_401k" }) },
      {
        "/api/jobs": {
          jobs: [
            {
              eventId: "evt_queued",
              status: "pending",
              started: NOW.toISOString(),
              updated: NOW.toISOString(),
              lastLine: null,
              originId: "doc_401k",
              originTitle: "401k rollover",
            },
            {
              eventId: "evt_parked",
              status: "deferred",
              started: NOW.toISOString(),
              updated: NOW.toISOString(),
              lastLine: null,
              originId: "doc_401k",
              originTitle: "401k rollover",
              blockedOn: "doc_policy",
              blockedOnTitle: "The reimbursement policy",
            },
          ],
        },
      },
    );
    await waitFor(() => {
      expect(container.querySelector(".queued-dot")?.getAttribute("title")).toBe(
        "Paused while The reimbursement policy is being edited",
      );
    });
    expect(container.querySelector(".working-dot")).toBeNull();
  });
});

/**
 * The sentence itself (UI-115), apart from the row that shows it — the honesty
 * is in the wording, and wording asserted only through a render is wording no
 * test reaches directly.
 */
describe("deferredRowTitle", () => {
  it("names the document by its title, then by its id", () => {
    expect(deferredRowTitle({ blockedOn: "doc_a", blockedOnTitle: "The policy" })).toBe(
      "Paused while The policy is being edited",
    );
    expect(deferredRowTitle({ blockedOn: "doc_a", blockedOnTitle: null })).toBe(
      "Paused while doc_a is being edited",
    );
  });

  it("says it is paused with no document to name, rather than leaving a hole", () => {
    const said = deferredRowTitle({ blockedOn: null, blockedOnTitle: null });
    expect(said).toBe("Paused — the agent is waiting for an edit to finish");
    expect(said).not.toContain("undefined");
    expect(said).not.toContain("null");
  });
});

describe("the staleness ramp", () => {
  it.each([
    [null, "row", 0],
    ["aging", "row age-1", 1],
    ["stale", "row age-2", 2],
    ["very-stale", "row age-3", 3],
  ] as const)("renders tier %s as %s", (tier, className, level) => {
    const { container } = renderRow({ row: docRowFixture({ stale: tier, updated: daysAgo(200) }) });
    const row = container.querySelector(".row");
    expect(row?.className).toBe(className);
    expect(row?.getAttribute("data-row-level")).toBe(String(level));
  });

  it("renders an evergreen document at level 0 whatever its age, because the server says so", () => {
    const { container } = renderRow({
      row: docRowFixture({ evergreen: true, stale: null, updated: daysAgo(900) }),
    });
    expect(container.querySelector(".row")?.className).toBe("row");
    expect(container.querySelector(".stale-actions")).toBeNull();
  });

  it("renders an undated document at level 0 with an em dash, not an epoch", () => {
    const { container } = renderRow({
      row: docRowFixture({ created: null, updated: null, reviewed: null, stale: null }),
    });
    expect(container.querySelector(".row")?.className).toBe("row");
    expect(container.querySelector(".age")?.textContent).toBe("—");
  });

  it.each([null, "aging", "stale"] as const)("grows no quick actions at tier %s", (tier) => {
    const { container } = renderRow({ row: docRowFixture({ stale: tier }) });
    expect(container.querySelector(".stale-actions")).toBeNull();
  });

  it("grows the three quick actions at the last rung, and hides the meta line", () => {
    const { container } = renderRow({
      row: docRowFixture({ stale: "very-stale", updated: daysAgo(240) }),
    });
    const buttons = [...container.querySelectorAll(".stale-actions button")];
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Archive",
      "Still current",
      "@agent triage",
    ]);
    expect(container.querySelector(".row-meta")).toBeNull();
    expect(container.querySelector(".row-badges .age")?.textContent).toBe("stale · 8mo");
  });
});

describe("thread rows", () => {
  const anchored = docRowFixture({
    id: "th_rate",
    type: "thread",
    path: "data/threads/th_rate.md",
    parent: "doc_mortgage",
    anchorQuote: "assume a 30-year fixed at 6.1%",
    lastAuthor: "agent",
    lastTurn: "Rates moved again.",
    unread: true,
  });

  it("shows the anchor quote and the attributed last turn", () => {
    const { container } = renderRow({ row: anchored });
    expect(container.querySelector(".row-quote")?.textContent).toBe(
      "assume a 30-year fixed at 6.1%",
    );
    expect(container.querySelector(".row-excerpt")?.textContent).toBe("agent: Rates moved again.");
  });

  it("shows no quote for a whole-document thread", () => {
    const { container } = renderRow({ row: { ...anchored, anchorQuote: null } });
    expect(container.querySelector(".row-quote")).toBeNull();
  });

  it('says "standalone" for a standalone thread', () => {
    const { container } = renderRow({ row: { ...anchored, parent: null, anchorQuote: null } });
    expect(container.querySelector(".row-context")?.textContent).toBe("standalone");
  });

  it("names the parent the row carries, for a whole-document thread", () => {
    const whole = { ...anchored, anchorQuote: null, parentTitle: "Mortgage options" };
    const { container } = renderRow({ row: whole });
    expect(container.querySelector(".row-context")?.textContent).toBe("on Mortgage options");
  });

  it("names the parent of an anchored thread as well", () => {
    const { container } = renderRow({ row: { ...anchored, parentTitle: "Mortgage options" } });
    expect(container.querySelector(".row-context")?.textContent).toBe("on Mortgage options");
  });

  it("blanks the context for an orphaned thread rather than printing an id or null", () => {
    const orphan = { ...anchored, anchorQuote: null, parentTitle: null };
    const { container } = renderRow({ row: orphan });
    expect(container.querySelector(".row-context")?.textContent).toBe("");
    expect(container.textContent).not.toContain("doc_mortgage");
    expect(container.textContent).not.toContain("null");
  });

  it("prints neither author nor text for a thread with no turns", () => {
    const { container } = renderRow({
      row: { ...anchored, lastAuthor: null, lastTurn: null, excerpt: "" },
    });
    expect(container.querySelector(".row-excerpt")).toBeNull();
    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("undefined");
  });
});

describe("the reason line", () => {
  it("renders one chip per server reason, in order, with the prototype's classes", () => {
    const { container } = renderRow({
      row: docRowFixture({ attention: ["unread-reply", "form", "due"] }),
    });
    const chips = [...container.querySelectorAll(".reason .r-chip")];
    expect(chips.map((chip) => chip.className)).toEqual([
      "r-chip r-reply",
      "r-chip r-form",
      "r-chip r-form",
    ]);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "agent replied",
      "awaiting your answer",
      "due today",
    ]);
  });

  /*
   * SPEC.md §10 — "a thread holding more than one unanswered form says how many
   * are still open". The number comes off `DocRow.unansweredForms`, which the
   * server derives from the same predicate as the `form` reason itself, so the
   * row never counts anything for itself and never fetches a thread to do it.
   */
  it.each([
    [1, "awaiting your answer"],
    [2, "2 awaiting your answer"],
    [5, "5 awaiting your answer"],
  ])("says how many forms are open at %i", (unansweredForms, label) => {
    const { container } = renderRow({
      row: docRowFixture({ type: "thread", parent: "doc_a", attention: ["form"], unansweredForms }),
    });
    expect(container.querySelector(".reason .r-form")?.textContent).toBe(label);
  });

  it("keeps the needs-you pill bare while the reason line carries the number", () => {
    const { container } = renderRow({
      row: docRowFixture({
        type: "thread",
        parent: "doc_a",
        attention: ["form"],
        unansweredForms: 3,
      }),
    });
    expect(container.querySelector(".needs-you")?.textContent).toBe("form");
    expect(container.querySelector(".reason .r-form")?.textContent).toBe("3 awaiting your answer");
  });

  it("picks the stale label from the row's tier", () => {
    const aging = renderRow({ row: docRowFixture({ attention: ["stale"], stale: "aging" }) });
    expect(aging.container.querySelector(".r-stale")?.textContent).toBe("getting stale");

    const gone = renderRow({ row: docRowFixture({ attention: ["stale"], stale: "very-stale" }) });
    expect(gone.container.querySelector(".r-stale")?.textContent).toBe("review: archive or act");
  });

  it("keeps an unknown reason code on a neutral chip", () => {
    const { container } = renderRow({
      row: docRowFixture({ attention: ["x/overdue"] as never }),
    });
    const chip = container.querySelector(".reason .r-chip");
    expect(chip?.className).toBe("r-chip");
    expect(chip?.textContent).toBe("x/overdue");
  });

  it("renders no reason line at all when the row has no reasons", () => {
    const { container } = renderRow({ row: docRowFixture() });
    expect(container.querySelector(".reason")).toBeNull();
  });

  it("can be silenced by a column that would rather stay quiet", () => {
    const { container } = renderRow({
      row: docRowFixture({ attention: ["form"] }),
      showReasons: false,
    });
    expect(container.querySelector(".reason")).toBeNull();
    // The badge is not a reason chip and stays.
    expect(container.querySelector(".needs-you")).not.toBeNull();
  });
});

describe("the keyboard cursor", () => {
  it("carries the prototype's `.row.kbd` outline only when it is the cursor", () => {
    const plain = renderRow({ row: docRowFixture() });
    expect(plain.container.querySelector(".row")?.className).toBe("row");

    const marked = renderRow({ row: docRowFixture(), cursor: true });
    expect(marked.container.querySelector(".row")?.className).toBe("row kbd");
  });

  /**
   * `e` reads the highlighted row's status from what it rendered, rather than
   * asking the server whether the document the user is looking at is already
   * archived.
   */
  it("publishes its status, so a keyboard act can target it without a request", () => {
    const { container } = renderRow({ row: docRowFixture({ status: "archived" }) });
    expect(container.querySelector(".row")?.getAttribute("data-row-status")).toBe("archived");
  });
});

/**
 * SPEC.md §10, rider 3: "the row stays highlighted as the path's origin while
 * the path is open", and "a row open elsewhere on the board carries a dot".
 * Both are host-derived props, never row state — the same rule as `cursor`.
 */
describe("the path marks", () => {
  it("carries `.origin` while its path is open, and origin outranks the dot", () => {
    const { container } = renderRow({
      row: docRowFixture(),
      origin: true,
      openElsewhere: true,
    });
    expect(container.querySelector(".row")?.className).toBe("row origin");
  });

  it("carries `.open-elsewhere` for a document showing in some other column", () => {
    const { container } = renderRow({ row: docRowFixture(), openElsewhere: true });
    expect(container.querySelector(".row")?.className).toBe("row open-elsewhere");
  });

  it("carries neither by default — the marks are claims, not decoration", () => {
    const { container } = renderRow({ row: docRowFixture() });
    expect(container.querySelector(".row")?.className).toBe("row");
  });
});

/**
 * SPEC.md §7's rider 9: "a document whose `updated` is later than `reflected` is
 * marked on every board … when the job lands, the marks clear".
 */
describe("the unreflected mark", () => {
  it("draws the diamond when the host says the agent has not been round", () => {
    const { container } = renderRow({ row: docRowFixture(), unreflected: true });
    const mark = container.querySelector(".changed-mark");
    expect(mark).not.toBeNull();
    // It carries a name: a 6px shape with no accessible text is invisible to a
    // screen reader, and this is the row's only cue that anything is unreflected.
    expect(mark?.getAttribute("aria-label")).toBe("Changed since the agent last reflected");
    // A distinct glyph from the board's circles (rider 3's "open elsewhere" dot).
    expect(container.querySelector(".open-dot")).toBeNull();
  });

  it("draws nothing when the host says nothing", () => {
    expect(renderRow({ row: docRowFixture() }).container.querySelector(".changed-mark")).toBeNull();
    expect(
      renderRow({ row: docRowFixture(), unreflected: false }).container.querySelector(
        ".changed-mark",
      ),
    ).toBeNull();
  });

  /**
   * The row never decides this for itself. The rule needs the corpus's clock,
   * which is one request per board rather than one per row — so a row handed no
   * verdict issues nothing and claims nothing.
   */
  it("asks the server nothing to draw it", () => {
    const { requests } = renderRow({ row: docRowFixture(), unreflected: true });
    expect(requests.filter((call) => call.path.includes("reflect"))).toHaveLength(0);
  });
});
