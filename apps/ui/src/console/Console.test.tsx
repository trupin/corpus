/** @vitest-environment jsdom */
import type { Job, QueueStatus } from "@corpus/contract";
import { docsListKey } from "@corpus/kit";
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoardNavigationProvider,
  useRegisterBoardNavigation,
  type BoardNavigation,
} from "../board/openInColumn";
import { memoryStorage, throwingStorage } from "../testing/memoryStorage";
import { Console } from "./Console";
import { CONSOLE_STORAGE_KEY, DEFAULT_CONSOLE_HEIGHT } from "./useConsoleLayout";

/**
 * The drawer as a whole. The strip's health assertions below are UI-001's and
 * UI-002's, carried over verbatim when the console moved out of `shell/` — the
 * reachability notice is still the strip's, and it now has to coexist with
 * UI-011's failed-job count (sprint-010 adjudication 5).
 */

const HEALTH_BODY = {
  status: "ok",
  version: "1.2.3",
  uptimeSeconds: 3,
  workspace: "/tmp/corpus-workspace",
};

const IDLE_QUEUE: QueueStatus = {
  halted: false,
  pending: 0,
  inProgress: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    eventId: "evt_9f2",
    type: "comment.created",
    status: "in-progress",
    started: "2026-07-27T09:12:00Z",
    updated: "2026-07-27T09:12:09Z",
    lastLine: "drafting…",
    originId: "th_carrier",
    originTitle: "Insurance carrier choice",
    ...overrides,
  };
}

interface Workspace {
  readonly queue?: QueueStatus;
  readonly jobs?: readonly Job[];
  readonly health?: boolean;
  readonly log?: {
    readonly lines: readonly { readonly ts: string; readonly line: string }[];
    readonly nextCursor: number;
  };
}

/** Returns a promise so the stubs below need not be `async` to please lint. */
function json(body: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/**
 * A `fetch` that answers the reads the console makes, and records them.
 *
 * Stubbed at the transport boundary like `boardFixture`'s, and for the same
 * reason: a test that mocks `useJobLog` proves the component calls a function,
 * while this one proves it issues `GET /api/jobs/{id}/log?cursor=0` — which is
 * what the cursor and "collapsed fetches nothing" assertions are about.
 */
function transport(workspace: Workspace = {}): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly string[];
  readonly writes: readonly string[];
} {
  const calls: string[] = [];
  const writes: string[] = [];

  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const target = url.pathname + url.search;
    calls.push(target);
    if (request.method !== "GET") writes.push(target);

    if (url.pathname === "/api/health") {
      if (workspace.health === false) throw new TypeError("Failed to fetch");
      return json(HEALTH_BODY);
    }
    if (url.pathname === "/api/queue/status") return json(workspace.queue ?? IDLE_QUEUE);
    if (url.pathname.endsWith("/log")) {
      return json(workspace.log ?? { lines: [], nextCursor: 0 });
    }
    if (url.pathname === "/api/jobs") return json({ jobs: workspace.jobs ?? [] });
    return json({});
  };

  return { fetch: fetchImpl, calls, writes };
}

let harness: CorpusTestHarness | undefined;

function renderConsole(fetchImpl: unknown): ReturnType<typeof render> {
  harness = createCorpusTestHarness({
    fetch: fetchImpl as typeof globalThis.fetch,
    // The drop test emits a transport error on purpose; the default logger is
    // `console`, and its output would be noise, not signal.
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  return render(<Console />, { wrapper: harness.Wrapper });
}

const openedStorage = (height = 210): Record<string, string> => ({
  [CONSOLE_STORAGE_KEY]: JSON.stringify({ version: 1, open: true, height }),
});

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
  vi.unstubAllGlobals();
});

describe("the collapsed strip", () => {
  it("renders one collapsed line as a flow sibling, never a fixed overlay", () => {
    const { container } = renderConsole(transport().fetch);

    const drawer = container.querySelector(".console");
    expect(drawer).not.toBeNull();
    expect(drawer?.className).toBe("console");
    expect(container.querySelector(".console-body")).toBeNull();
    expect(container.querySelector(".console-resizer")).toBeNull();
    expect(container.querySelectorAll(".console-strip")).toHaveLength(1);
    expect(drawer?.querySelector(".c-caret")?.textContent).toBe("▴");
    expect(drawer?.textContent).toContain("console");
  });

  it("reports an honest pending state while the probe is in flight", () => {
    renderConsole(vi.fn().mockReturnValue(new Promise(() => {})));
    expect(screen.getByRole("status").textContent).toBe("checking server…");
  });

  it("reports the server version once the probe answers", async () => {
    renderConsole(transport().fetch);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("corpus 1.2.3");
    });
  });

  it("shows the server-unreachable notice instead of crashing the shell", async () => {
    const { container } = renderConsole(
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
    expect(container.querySelector(".c-failed")).not.toBeNull();
    expect(container.querySelector(".console-strip")).not.toBeNull();
  });

  // UI-002's TEST-26, at the surface the criterion is written about: the strip's
  // verdict is the boot-time probe forever unless something invalidates the
  // health key, and losing the stream is exactly when it stops being true.
  it("converges from a version to unreachable when the stream drops", async () => {
    let reachable = true;
    renderConsole((input: RequestInfo | URL): Promise<Response> => {
      if (!reachable) throw new TypeError("Failed to fetch");
      const { pathname } = new URL(new Request(input).url);
      if (pathname === "/api/health") return json(HEALTH_BODY);
      if (pathname === "/api/queue/status") return json(IDLE_QUEUE);
      return json({ jobs: [] });
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("corpus 1.2.3");
    });

    reachable = false;
    harness?.eventSource.latest().emit("error");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
  });

  // TEST-85: the reachability notice and the failed-job count are two different
  // red numbers in one strip, and exactly one of them may answer to `.c-failed`.
  it("keeps the failed-job count off the health notice's class", async () => {
    const { container } = renderConsole(
      transport({ health: false, queue: { ...IDLE_QUEUE, failed: 2 } }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".c-failed-jobs")?.textContent).toBe("2 failed");
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
    expect(container.querySelectorAll(".console-strip .c-failed")).toHaveLength(1);
  });

  // TEST-87.
  it("formats the counts as the prototype does, omitting a zero queue", async () => {
    const { container } = renderConsole(
      transport({ queue: { ...IDLE_QUEUE, inProgress: 1, processed: 4, failed: 1 } }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".c-counts")?.textContent).toBe(
        "1 running · 4 done · 1 failed",
      );
    });
  });

  it("shows the queued segment as soon as anything is pending", async () => {
    const { container } = renderConsole(
      transport({ queue: { ...IDLE_QUEUE, inProgress: 1, pending: 2, processed: 4 } }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".c-counts")?.textContent).toBe(
        "1 running · 2 queued · 4 done · 0 failed",
      );
    });
  });

  // TEST-88.
  it("derives the agent pill from the same queue status as the counts", async () => {
    const { container } = renderConsole(
      transport({ queue: { ...IDLE_QUEUE, inProgress: 1, pending: 2 } }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".agent-pill")?.textContent).toBe("agent: working · queue 2");
    });
    expect(container.querySelector(".agent-pill .dot")?.className).toBe("dot busy");
  });

  it("reads halted before working", async () => {
    const { container } = renderConsole(
      transport({ queue: { ...IDLE_QUEUE, halted: true, inProgress: 1 } }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".agent-pill")?.textContent).toBe("agent: halted · queue 0");
    });
    expect(container.querySelector(".halt-btn")?.className).toBe("halt-btn halted");
    expect(container.querySelector(".halt-btn")?.textContent).toBe("HALT ●");
  });

  it("disables HALT while the queue status is unknown", () => {
    renderConsole(vi.fn().mockReturnValue(new Promise(() => {})));
    expect(screen.getByRole("button", { name: /HALT/ }).hasAttribute("disabled")).toBe(true);
  });

  // TEST-89, at the boundary this test can reach: the button is the server's
  // state, so pressing it issues the write and never flips a local flag.
  it("posts halt and resume rather than toggling locally", async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    let halted = false;
    renderConsole((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const { pathname } = new URL(request.url);
      if (request.method === "POST") {
        posted.push(pathname);
        halted = pathname === "/api/queue/halt";
        return json({ ...IDLE_QUEUE, halted });
      }
      if (pathname === "/api/queue/status") return json({ ...IDLE_QUEUE, halted });
      if (pathname === "/api/health") return json(HEALTH_BODY);
      return json({ jobs: [] });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /HALT/ }).hasAttribute("disabled")).toBe(false);
    });
    await user.click(screen.getByRole("button", { name: /HALT/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /HALT/ }).textContent).toBe("HALT ●");
    });
    expect(posted).toContain("/api/queue/halt");

    await user.click(screen.getByRole("button", { name: /HALT/ }));
    await waitFor(() => {
      expect(posted).toContain("/api/queue/resume");
    });
  });
});

describe("toggling the drawer", () => {
  it("opens on click and pushes a sized body into the flow", async () => {
    const user = userEvent.setup();
    const { container } = renderConsole(transport().fetch);

    await user.click(screen.getByRole("button", { name: "Toggle console" }));

    expect(container.querySelector(".console")?.className).toBe("console open");
    expect(container.querySelector<HTMLElement>(".console-body")?.style.height).toBe(
      `${String(DEFAULT_CONSOLE_HEIGHT)}px`,
    );
    expect(container.querySelector(".console-resizer")).not.toBeNull();
  });

  // TEST-111.
  it("toggles on Enter and on Space", async () => {
    const user = userEvent.setup();
    const { container } = renderConsole(transport().fetch);

    screen.getByRole("button", { name: "Toggle console" }).focus();
    await user.keyboard("{Enter}");
    expect(container.querySelector(".console")?.className).toBe("console open");

    await user.keyboard(" ");
    expect(container.querySelector(".console")?.className).toBe("console");
  });

  it("does not toggle when the HALT button inside it is pressed", async () => {
    const user = userEvent.setup();
    const { container } = renderConsole(transport().fetch);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /HALT/ }).hasAttribute("disabled")).toBe(false);
    });
    await user.click(screen.getByRole("button", { name: /HALT/ }));

    expect(container.querySelector(".console")?.className).toBe("console");
  });

  // TEST-92.
  it("restores the stored open state and height on mount", () => {
    vi.stubGlobal("localStorage", memoryStorage(openedStorage(320)));
    const { container } = renderConsole(transport().fetch);

    expect(container.querySelector(".console")?.className).toBe("console open");
    expect(container.querySelector<HTMLElement>(".console-body")?.style.height).toBe("320px");
  });

  it("works from in-memory defaults when storage throws", async () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const user = userEvent.setup();
    const { container } = renderConsole(transport().fetch);

    await user.click(screen.getByRole("button", { name: "Toggle console" }));
    expect(container.querySelector(".console")?.className).toBe("console open");
  });
});

describe("the master-detail body", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage(openedStorage()));
  });

  // TEST-98.
  it("says so when there are no jobs at all", async () => {
    const { container } = renderConsole(transport().fetch);

    await waitFor(() => {
      expect(container.querySelector(".job-empty")?.textContent).toBe(
        "No jobs yet — agent activity will stream here.",
      );
    });
    expect(container.querySelectorAll(".job")).toHaveLength(0);
  });

  // TEST-93, TEST-94, TEST-95.
  it("renders one row per job, newest selected, labelled from the wire", async () => {
    const { container } = renderConsole(
      transport({
        jobs: [
          job(),
          job({
            eventId: "evt_8d1",
            status: "processed",
            type: "capture.filing",
            originTitle: "401k",
          }),
          job({ eventId: "evt_7aa", status: "failed", originId: null, originTitle: null }),
          job({ eventId: "evt_6zz", status: "abandoned" }),
        ],
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(4);
    });
    const rows = [...container.querySelectorAll(".job")];
    expect(rows.map((row) => row.querySelector(".job-title")?.textContent)).toEqual([
      "comment.created · Insurance carrier choice",
      "capture.filing · 401k",
      "comment.created",
      "comment.created · Insurance carrier choice",
    ]);
    expect(rows.map((row) => row.querySelector(".job-dot")?.className)).toEqual([
      "job-dot running",
      "job-dot done",
      "job-dot failed",
      "job-dot",
    ]);
    expect(container.querySelectorAll(".job.sel")).toHaveLength(1);
    expect(rows[0]?.className).toBe("job sel");
  });

  it("keeps an explicit selection when a newer job arrives", async () => {
    const user = userEvent.setup();
    let jobs: readonly Job[] = [
      job(),
      job({ eventId: "evt_8d1", status: "processed", originTitle: "401k" }),
    ];
    const { container } = renderConsole((input: RequestInfo | URL): Promise<Response> => {
      const { pathname } = new URL(new Request(input).url);
      if (pathname === "/api/health") return json(HEALTH_BODY);
      if (pathname === "/api/queue/status") return json(IDLE_QUEUE);
      if (pathname.endsWith("/log")) return json({ lines: [], nextCursor: 0 });
      return json({ jobs });
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(2);
    });
    await user.click(screen.getByRole("button", { name: /401k/ }));
    expect(container.querySelector(".job.sel .job-title")?.textContent).toContain("401k");

    jobs = [job({ eventId: "evt_new", status: "pending", originTitle: "brand new" }), ...jobs];
    await harness?.queryClient.invalidateQueries();

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(3);
    });
    expect(container.querySelectorAll(".job.sel")).toHaveLength(1);
    expect(container.querySelector(".job.sel .job-title")?.textContent).toContain("401k");
  });

  it("falls back to the newest job when the selected one disappears", async () => {
    const user = userEvent.setup();
    let jobs: readonly Job[] = [
      job(),
      job({ eventId: "evt_8d1", status: "processed", originTitle: "401k" }),
    ];
    const { container } = renderConsole((input: RequestInfo | URL): Promise<Response> => {
      const { pathname } = new URL(new Request(input).url);
      if (pathname === "/api/health") return json(HEALTH_BODY);
      if (pathname === "/api/queue/status") return json(IDLE_QUEUE);
      if (pathname.endsWith("/log")) return json({ lines: [], nextCursor: 0 });
      return json({ jobs });
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(2);
    });
    await user.click(screen.getByRole("button", { name: /401k/ }));

    jobs = [job()];
    await harness?.queryClient.invalidateQueries();

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(1);
    });
    expect(container.querySelector(".job.sel .job-title")?.textContent).toContain(
      "Insurance carrier choice",
    );
  });

  // TEST-96, TEST-101.
  it("renders the detail header and classifies ERR lines at render time", async () => {
    const { container } = renderConsole(
      transport({
        jobs: [job({ status: "failed" })],
        log: {
          nextCursor: 2,
          lines: [
            { ts: "2026-07-27T09:12:01Z", line: "claimed evt_9f2" },
            { ts: "2026-07-27T09:12:02Z", line: "ERR subagent timeout" },
          ],
        },
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".job-log-lines > div")).toHaveLength(2);
    });
    const head = container.querySelector(".job-detail-head");
    expect(head?.querySelector(".job-title")?.textContent).toBe(
      "comment.created · Insurance carrier choice",
    );
    const meta = head?.querySelector(".job-meta")?.textContent ?? "";
    expect(meta.startsWith("failed · started ")).toBe(true);
    expect(meta.endsWith("· evt_9f2")).toBe(true);
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Abandon" })).toBeDefined();

    const lines = [...container.querySelectorAll(".job-log-lines > div")];
    expect(lines[0]?.className).toBe("");
    expect(lines[1]?.className).toBe("err");
  });

  it("offers Retry and Abandon only for failed jobs", async () => {
    const { container } = renderConsole(transport({ jobs: [job()] }).fetch);

    await waitFor(() => {
      expect(container.querySelector(".job-detail-head")).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull();
  });

  // TEST-97: it goes through UI-009's seam rather than reaching into the board,
  // and it passes only the id — a job knows no folder, type or status.
  it("opens the job's origin through the board-navigation seam", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const revealColumn = vi.fn();
    harness = createCorpusTestHarness({ fetch: transport({ jobs: [job()] }).fetch });
    const { Wrapper } = harness;

    function FakeBoard(): ReactElement {
      const handlers = useMemo<BoardNavigation>(() => ({ open, revealColumn }), []);
      useRegisterBoardNavigation(handlers);
      return <div />;
    }

    render(
      <Wrapper>
        <BoardNavigationProvider>
          <FakeBoard />
          <Console />
        </BoardNavigationProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "↗ open" }).hasAttribute("disabled")).toBe(false);
    });
    await user.click(screen.getByRole("button", { name: "↗ open" }));

    expect(open).toHaveBeenCalledWith({ docId: "th_carrier" });
  });

  // TEST-97.
  it("disables ↗ open when the job has no origin left", async () => {
    const { container } = renderConsole(
      transport({ jobs: [job({ originId: null, originTitle: null })] }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".job-detail-head .ref")).not.toBeNull();
    });
    const link = screen.getByRole("button", { name: "↗ open" });
    expect(link.hasAttribute("disabled")).toBe(true);
    expect(link.getAttribute("title")).toContain("no longer exists");
  });

  // TEST-108: the Attention rows live in a `docs` query, and nothing on the wire
  // announces that a retry changed them (the server's queue frames name `queue`
  // and `jobs` only). The mutation has to say so itself.
  it("invalidates the document collection when a failed job is retried", async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    renderConsole((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init);
      const { pathname } = new URL(request.url);
      if (request.method === "POST") {
        posted.push(pathname);
        return json(job({ status: "pending" }));
      }
      if (pathname === "/api/health") return json(HEALTH_BODY);
      if (pathname === "/api/queue/status") return json(IDLE_QUEUE);
      if (pathname.endsWith("/log")) return json({ lines: [], nextCursor: 0 });
      return json({ jobs: [job({ status: "failed" })] });
    });

    // The Attention column, as the board caches it.
    const attention = docsListKey({ needs: "me" });
    harness?.queryClient.setQueryData(attention, { items: [], page: {} });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    });
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(posted).toContain("/api/jobs/evt_9f2/retry");
    });
    await waitFor(() => {
      expect(harness?.queryClient.getQueryState(attention)?.isInvalidated).toBe(true);
    });
  });
});

// TEST-105.
describe("a collapsed drawer", () => {
  it("issues no job-log request", async () => {
    const recorder = transport({ jobs: [job()] });
    renderConsole(recorder.fetch);

    await waitFor(() => {
      expect(recorder.calls.some((url) => url.startsWith("/api/jobs"))).toBe(true);
    });
    expect(recorder.calls.filter((url) => url.includes("/log"))).toEqual([]);
  });

  it("starts fetching the log once expanded", async () => {
    const user = userEvent.setup();
    const recorder = transport({ jobs: [job()] });
    renderConsole(recorder.fetch);

    await user.click(screen.getByRole("button", { name: "Toggle console" }));
    await waitFor(() => {
      expect(recorder.calls).toContain("/api/jobs/evt_9f2/log?cursor=0");
    });
  });
});
