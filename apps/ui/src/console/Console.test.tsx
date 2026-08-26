/** @vitest-environment jsdom */
import type { IndexStatus, Job, QueueStatus } from "@corpus/contract";
import { AGENT_PRESENCE_WINDOW_SECONDS } from "@corpus/contract";
import { INDEX_KEY, JOBS_KEY, QUEUE_KEY, docsListKey } from "@corpus/kit";
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

/**
 * An agent parked **now**.
 *
 * A fixed instant would have been fine while nothing read `agent`; since UI-098
 * the pill expires a presence whose evidence has aged past the grace window, so
 * a hard-coded 2026-07-19 would quietly turn every assertion in this file that
 * merely happens to render the strip into `agent: disconnected`. Parked-now is
 * also simply what a live agent looks like.
 */
const IDLE_QUEUE: QueueStatus = {
  agent: { live: true, since: new Date().toISOString() },
  halted: false,
  pending: 0,
  inProgress: 0,
  deferred: 0,
  processed: 0,
  failed: 0,
  abandoned: 0,
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    eventId: "evt_9f2",
    type: "comment.created",
    status: "in-progress",
    lane: "orchestrator",
    // Three instants, each meaning one thing (CONTRACT-029): the enqueue, the
    // first log line, the last one. This row is in progress and has spoken.
    enqueued: "2026-07-27T09:12:00Z",
    started: "2026-07-27T09:12:04Z",
    updated: "2026-07-27T09:12:09Z",
    lastLine: "drafting…",
    originId: "th_carrier",
    originTitle: "Insurance carrier choice",
    // Required-and-nullable on the wire (CONTRACT-021); null is the shape of a
    // job that is not deferred, which is every fixture here unless it says so.
    blockedOn: null,
    blockedOnTitle: null,
    ...overrides,
  };
}

/**
 * A caught-up semantic index — the answer `GET /api/index/status` gives a
 * workspace with nothing to say about itself, and the fixture every test that is
 * not about the index pill gets.
 */
const CURRENT_INDEX: IndexStatus = {
  indexed: 273,
  pending: 0,
  failed: 0,
  identity: "ollama/nomic-embed-text@768",
  rebuilding: false,
  state: "current",
};

interface Workspace {
  readonly queue?: QueueStatus;
  readonly index?: IndexStatus;
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
    if (url.pathname === "/api/index/status") return json(workspace.index ?? CURRENT_INDEX);
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

  /*
   * UI-098, at the surface the bug was reported on. `idle` used to be the
   * else-branch, so these three assertions are the whole issue: nobody parked
   * reads `disconnected` with the depth beside it, the dot is neither idle's
   * green nor halted's red nor the pulse, and an unanswered read says neither
   * thing.
   */
  describe("the agent pill's presence", () => {
    const AWAY: QueueStatus = { ...IDLE_QUEUE, agent: { live: false, since: null } };

    it("says disconnected, with the queue depth beside it, when nobody is parked", async () => {
      const { container } = renderConsole(transport({ queue: { ...AWAY, pending: 3 } }).fetch);

      await waitFor(() => {
        expect(container.querySelector(".agent-pill")?.textContent).toBe(
          "agent: disconnected · queue 3",
        );
      });
      // Not styled as a failure (SPEC.md §10), and it does not pulse.
      expect(container.querySelector(".agent-pill .dot")?.className).toBe("dot away");
      expect(container.querySelector(".agent-pill")?.getAttribute("data-agent-state")).toBe(
        "disconnected",
      );
    });

    // CONTRACT-045: `inProgress > 0` is a fact about events, not about anybody
    // holding them. An agent that claimed work and died leaves the count up.
    it("prefers disconnected over working when the holder of the work is gone", async () => {
      const { container } = renderConsole(transport({ queue: { ...AWAY, inProgress: 2 } }).fetch);

      await waitFor(() => {
        expect(container.querySelector(".agent-pill")?.textContent).toBe(
          "agent: disconnected · queue 0",
        );
      });
      expect(container.querySelector(".c-counts")?.textContent).toBe(
        "2 running · 0 done · 0 failed",
      );
    });

    it("still reads halted before disconnected", async () => {
      const { container } = renderConsole(
        transport({ queue: { ...AWAY, halted: true, inProgress: 1 } }).fetch,
      );

      await waitFor(() => {
        expect(container.querySelector(".agent-pill")?.textContent).toBe("agent: halted · queue 0");
      });
    });

    /*
     * The trap this issue is most easily got wrong by: `UNKNOWN_QUEUE_STATUS`
     * carries `agent: {live: false}` because the field is required, and a pill
     * that read it would announce "no agent is connected" about a server that
     * has simply not replied. The counts still show their honest zeroes beside
     * it — that substitution is legitimate and stops short of the pill.
     */
    it("makes no claim at all while the server has not answered", async () => {
      const { container } = renderConsole(vi.fn().mockReturnValue(new Promise(() => {})));

      await waitFor(() => {
        expect(container.querySelector(".agent-pill")?.textContent).toBe("agent: unknown");
      });
      expect(container.querySelector(".agent-pill .dot")?.className).toBe("dot unknown");
      expect(container.querySelector(".c-counts")?.textContent).toBe(
        "0 running · 0 done · 0 failed",
      );
    });

    it("makes no claim when the server will never answer either", async () => {
      const { container } = renderConsole(
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("server unreachable");
      });
      expect(container.querySelector(".agent-pill")?.textContent).toBe("agent: unknown");
    });

    /*
     * The acceptance criterion nothing else can cover: an agent that walks away
     * produces **no queue transition**, so no `["queue"]` frame arrives to
     * prompt a refetch. Without its own clock the pill would sit on `idle` for
     * as long as nothing else happened — the original bug with extra steps.
     *
     * The `calls` assertion is what stops this passing trivially: the flip has
     * to come from the tick re-evaluating cached data, not from a second read.
     */
    it("flips to disconnected on its own clock, with no new data", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const stub = transport({
          queue: { ...IDLE_QUEUE, agent: { live: true, since: new Date().toISOString() } },
        });
        const { container } = renderConsole(stub.fetch);

        await waitFor(() => {
          expect(container.querySelector(".agent-pill")?.textContent).toBe("agent: idle · queue 0");
        });
        const reads = stub.calls.filter((call) => call === "/api/queue/status").length;
        expect(reads).toBeGreaterThan(0);

        await act(async () => {
          await vi.advanceTimersByTimeAsync((AGENT_PRESENCE_WINDOW_SECONDS + 60) * 1000);
        });

        expect(container.querySelector(".agent-pill")?.textContent).toBe(
          "agent: disconnected · queue 0",
        );
        expect(container.querySelector(".agent-pill .dot")?.className).toBe("dot away");
        expect(stub.calls.filter((call) => call === "/api/queue/status")).toHaveLength(reads);
      } finally {
        vi.useRealTimers();
      }
    });
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

/**
 * The index pill (UI-040, SPEC.md §10's index-pill rider) — the strip's second
 * pill, fed by `GET /api/index/status` and refreshed by the `["index"]` frames
 * the embed worker emits as it drains.
 */
describe("the index pill", () => {
  const pill = (container: HTMLElement): Element | null => container.querySelector(".index-pill");

  it("renders the caught-up state beside the agent pill", async () => {
    const { container } = renderConsole(transport().fetch);

    await waitFor(() => {
      expect(pill(container)?.textContent).toBe("index: current · 273 indexed");
    });
    expect(container.querySelector(".index-pill .dot")?.className).toBe("dot");
    // Beside, not instead of: both pills live on the one collapsed line.
    expect(container.querySelector(".console-strip .agent-pill")).not.toBeNull();
    expect(container.querySelector(".console-strip .index-pill")).not.toBeNull();
  });

  it("shows the fraction and the pulse while a rebuild drains", async () => {
    const { container } = renderConsole(
      transport({
        index: { ...CURRENT_INDEX, indexed: 41, pending: 27, rebuilding: true, state: "indexing" },
      }).fetch,
    );

    await waitFor(() => {
      expect(pill(container)?.textContent).toBe("index: indexing · 41/68");
    });
    expect(container.querySelector(".index-pill .dot")?.className).toBe("dot busy");
    expect(pill(container)?.getAttribute("data-index-state")).toBe("indexing");
  });

  it("shows the same count shape, in its own colour, for a stale index", async () => {
    const { container } = renderConsole(
      transport({ index: { ...CURRENT_INDEX, indexed: 41, pending: 27, state: "stale" } }).fetch,
    );

    await waitFor(() => {
      expect(pill(container)?.textContent).toBe("index: stale · 41/68");
    });
    expect(container.querySelector(".index-pill .dot")?.className).toBe("dot stale");
  });

  it("says disabled with no count when there is no index", async () => {
    const { container } = renderConsole(
      transport({
        index: { ...CURRENT_INDEX, indexed: 0, identity: null, state: "disabled" },
      }).fetch,
    );

    await waitFor(() => {
      expect(pill(container)?.textContent).toBe("index: disabled");
    });
    expect(container.querySelector(".index-pill .dot")?.className).toBe("dot off");
  });

  /*
   * The acceptance criterion, at the seam it is written about: an `["index"]`
   * frame arrives, the counts climb, and nothing reloaded or polled. The stub
   * answers a *different* status on the second call, so a pill that never
   * refetched would keep showing `41/68` and fail here.
   */
  it("climbs on the index frame the server emits, with no poller", async () => {
    let drained = false;
    const calls: string[] = [];
    const { container } = renderConsole((input: RequestInfo | URL): Promise<Response> => {
      const { pathname } = new URL(new Request(input).url);
      calls.push(pathname);
      if (pathname === "/api/health") return json(HEALTH_BODY);
      if (pathname === "/api/queue/status") return json(IDLE_QUEUE);
      if (pathname === "/api/index/status") {
        return json(
          drained
            ? { ...CURRENT_INDEX, indexed: 68, pending: 0 }
            : { ...CURRENT_INDEX, indexed: 41, pending: 27, rebuilding: true, state: "indexing" },
        );
      }
      return json({ jobs: [] });
    });

    await waitFor(() => {
      expect(pill(container)?.textContent).toBe("index: indexing · 41/68");
    });

    drained = true;
    harness?.eventSource.latest().emit("invalidate", JSON.stringify({ keys: [INDEX_KEY] }));

    await waitFor(() => {
      expect(pill(container)?.textContent).toBe("index: current · 68 indexed");
    });
    // Exactly two reads: the mount and the frame. A poller would add more.
    expect(calls.filter((path) => path === "/api/index/status")).toHaveLength(2);
  });

  // An unreachable server knows nothing about a workspace's vectors, and
  // `index: disabled` would be a claim. The pill is absent instead; the
  // reachability notice beside it is the fact that is true.
  it("stays absent rather than guessing when the server does not answer", async () => {
    const { container } = renderConsole(
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
    expect(pill(container)).toBeNull();
  });
});

describe("the expanded drawer's index row", () => {
  const DOWNLOADING: IndexStatus = {
    indexed: 0,
    pending: 0,
    failed: 0,
    identity: null,
    rebuilding: false,
    state: "disabled",
    detail:
      "downloading the all-MiniLM-L6-v2 embedding model (10.4 MiB of 22.6 MiB, 46%) — " +
      "semantic ranking starts once it is cached",
  };

  /*
   * The rider's wording: the sentence is the server's. This test compares the
   * rendered text to the fixture **character for character**, which is what
   * makes any future summarising, truncating or keyword-branching a failure
   * here rather than a judgement call in review.
   */
  it("renders the server's detail sentence verbatim", async () => {
    vi.stubGlobal("localStorage", memoryStorage(openedStorage()));
    const { container } = renderConsole(transport({ index: DOWNLOADING }).fetch);

    await waitFor(() => {
      expect(container.querySelector(".index-detail")?.textContent).toBe(DOWNLOADING.detail);
    });
  });

  it("shows the failed count only when it is non-zero", async () => {
    vi.stubGlobal("localStorage", memoryStorage(openedStorage()));
    const { container } = renderConsole(
      transport({
        index: { ...CURRENT_INDEX, indexed: 41, pending: 27, failed: 3, state: "stale" },
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".index-failed")?.textContent).toBe("3 failed");
    });
  });

  it("says nothing at all when there is nothing to add", async () => {
    vi.stubGlobal("localStorage", memoryStorage(openedStorage()));
    const { container } = renderConsole(transport().fetch);

    await waitFor(() => {
      expect(container.querySelector(".index-pill")?.textContent).toBe(
        "index: current · 273 indexed",
      );
    });
    expect(container.querySelector(".index-status")).toBeNull();
    expect(container.querySelector(".index-failed")).toBeNull();
  });

  // Collapsed, the drawer's body is not mounted and neither is this row: the
  // strip is one line, and the sentence belongs to the expanded view.
  it("is not rendered while the drawer is collapsed", async () => {
    const { container } = renderConsole(transport({ index: DOWNLOADING }).fetch);

    await waitFor(() => {
      expect(container.querySelector(".index-pill")?.textContent).toBe("index: disabled");
    });
    expect(container.querySelector(".index-status")).toBeNull();
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

  // CONTRACT-021: the state exists on the wire, so it renders — as waiting,
  // under its own selector, never wearing the failed dot.
  it("renders a deferred job with its own dot", async () => {
    const { container } = renderConsole(
      transport({
        jobs: [
          job({
            eventId: "evt_5yy",
            status: "deferred",
            blockedOn: "doc_401k",
            blockedOnTitle: "401k rollover",
          }),
        ],
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(1);
    });
    expect(container.querySelector(".job-dot")?.className).toBe("job-dot deferred");
  });

  // Sprint-015 TEST-355: the two must not read the same. A deferral that looks
  // like a failure is the exact thing SERVER-030 exists to stop.
  it("tells a deferred job apart from a failed one", async () => {
    const { container } = renderConsole(
      transport({
        jobs: [
          job({
            eventId: "evt_5yy",
            status: "deferred",
            blockedOn: "doc_401k",
            blockedOnTitle: "401k rollover",
          }),
          job({ eventId: "evt_7aa", status: "failed" }),
        ],
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(2);
    });
    const rows = [...container.querySelectorAll(".job")];
    expect(rows.map((row) => row.querySelector(".job-dot")?.className)).toEqual([
      "job-dot deferred",
      "job-dot failed",
    ]);
    expect(rows[0]?.querySelector(".job-meta")?.textContent).toBe("deferred");
    expect(rows[1]?.querySelector(".job-meta")?.textContent).toBe("failed");
    // Only the waiting one says what it is waiting for; the failed one has
    // nothing true to say and says nothing.
    expect(rows[0]?.querySelector(".job-blocked")?.textContent).toBe("🔒 401k rollover");
    expect(rows[1]?.querySelector(".job-blocked")).toBeNull();
  });

  /*
   * Sprint-015 TEST-356, first half — the evaluator's exact probe (SERVER-030
   * eval FAIL-1): the blocking document is deliberately **not** the job's
   * origin, which is the case where a row that merely echoes its origin looks
   * plausible and still tells the user nothing.
   */
  it("names a blocking document that is not the job's own origin", async () => {
    const { container } = renderConsole(
      transport({
        jobs: [
          job({
            eventId: "evt_3ia",
            status: "deferred",
            originId: "th_mortgage",
            originTitle: "Re: Mortgage options",
            blockedOn: "doc_tziz3yof",
            blockedOnTitle: "Unrelated",
          }),
        ],
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".job")).toHaveLength(1);
    });
    const drawer = container.querySelector(".console");
    expect(drawer?.textContent).toContain("Unrelated");
    expect(container.querySelector(".job-list .job-blocked")?.textContent).toBe("🔒 Unrelated");
    // The pane has the room the row does not, so it spells the whole thing out;
    // the row carries the same sentence on the hover.
    expect(container.querySelector(".job-detail-head .job-blocked")?.textContent).toBe(
      "blocked on Unrelated · doc_tziz3yof",
    );
    expect(container.querySelector(".job-list .job-blocked")?.getAttribute("title")).toBe(
      "blocked on Unrelated · doc_tziz3yof",
    );
  });

  /*
   * Sprint-015 TEST-356, second half — through the real SSE seam.
   *
   * The server emits `invalidate` with the queue and jobs keys when a released
   * session ends; the server re-enters the event, and the console must follow
   * that to the refetch and
   * repaint, with no reload and no remount. Asserting the row element is the
   * *same* node is what separates "updated live" from "the test re-rendered
   * everything".
   */
  it("clears the deferral live when the editing session ends, with no reload", async () => {
    let jobs: readonly Job[] = [
      job({
        eventId: "evt_3ia",
        status: "deferred",
        blockedOn: "doc_tziz3yof",
        blockedOnTitle: "Unrelated",
      }),
    ];
    let queue: QueueStatus = { ...IDLE_QUEUE, pending: 2, deferred: 1 };
    const { container } = renderConsole((input: RequestInfo | URL): Promise<Response> => {
      const { pathname } = new URL(new Request(input).url);
      if (pathname === "/api/health") return json(HEALTH_BODY);
      if (pathname === "/api/queue/status") return json(queue);
      if (pathname.endsWith("/log")) return json({ lines: [], nextCursor: 0 });
      return json({ jobs });
    });

    await waitFor(() => {
      expect(container.querySelector(".job-list .job-blocked")?.textContent).toBe("🔒 Unrelated");
    });
    expect(container.querySelector(".c-counts")?.textContent).toContain(
      "0 running · 2 queued · 1 deferred · 0 done",
    );
    const rowBefore = container.querySelector(".job");

    // The session ends out of band; the server re-enters the event and says so.
    jobs = [job({ eventId: "evt_3ia", status: "pending", blockedOn: null, blockedOnTitle: null })];
    queue = { ...IDLE_QUEUE, pending: 3 };
    harness?.eventSource.latest().invalidate([...QUEUE_KEY]);
    harness?.eventSource.latest().invalidate([...JOBS_KEY]);

    await waitFor(() => {
      expect(container.querySelector(".job-dot")?.className).toBe("job-dot pending");
    });
    expect(container.querySelector(".job-blocked")).toBeNull();
    expect(container.querySelector(".console")?.textContent).not.toContain("Unrelated");
    expect(container.querySelector(".c-counts")?.textContent).toContain(
      "0 running · 3 queued · 0 done",
    );
    expect(container.querySelector(".job")).toBe(rowBefore);
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

  /**
   * CONTRACT-029. `Job.started` is the first log line and is null until there is
   * one, so a job that has not spoken has no start time to put on the meta line.
   * It used to get one anyway, because `started` carried the enqueue instant
   * while the job was queued — the overloaded field's second meaning showing up
   * as a word that was not true.
   */
  it("says queued rather than started for a job that has written no log line", async () => {
    const { container } = renderConsole(
      transport({
        jobs: [job({ status: "pending", started: null, lastLine: null })],
        log: { nextCursor: 0, lines: [] },
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".job-detail-head")).not.toBeNull();
    });
    const meta = container.querySelector(".job-detail-head .job-meta")?.textContent ?? "";
    expect(meta.startsWith("pending · queued ")).toBe(true);
    expect(meta).not.toContain("started");
    expect(meta.endsWith("· evt_9f2")).toBe(true);
  });

  it("offers Retry and Abandon only for a job that is going nowhere on its own", async () => {
    const { container } = renderConsole(transport({ jobs: [job()] }).fetch);

    await waitFor(() => {
      expect(container.querySelector(".job-detail-head")).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull();
  });

  /*
   * §7 keeps `corpus job retry` as the *manual* override for a deferral that
   * automatic re-entry did not reach, and CONTRACT-021 widened the route to
   * accept `deferred` for exactly that — so the console offers it, and says in
   * the tooltip that it is an override rather than the normal path.
   */
  it("offers the manual override on a deferred job too", async () => {
    const { container } = renderConsole(
      transport({
        jobs: [
          job({
            status: "deferred",
            blockedOn: "doc_401k",
            blockedOnTitle: "401k rollover",
          }),
        ],
      }).fetch,
    );

    await waitFor(() => {
      expect(container.querySelector(".job-detail-head")).not.toBeNull();
    });
    expect(screen.getByRole("button", { name: "Retry" }).getAttribute("title")).toContain(
      "it re-enters on its own when the editing session ends",
    );
    expect(screen.getByRole("button", { name: "Abandon" })).toBeDefined();
  });

  // TEST-97: it goes through UI-009's seam rather than reaching into the board,
  // and it passes only the id — a job knows no folder, type or status.
  it("opens the job's origin through the board-navigation seam", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const revealColumn = vi.fn();
    const openFullScreen = vi.fn();
    harness = createCorpusTestHarness({ fetch: transport({ jobs: [job()] }).fetch });
    const { Wrapper } = harness;

    function FakeBoard(): ReactElement {
      const handlers = useMemo<BoardNavigation>(() => ({ open, revealColumn, openFullScreen }), []);
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
