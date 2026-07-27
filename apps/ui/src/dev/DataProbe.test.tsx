/** @vitest-environment jsdom */
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataProbe } from "./DataProbe";

const BODIES: Record<string, unknown> = {
  "/api/docs": {
    items: [{ id: "doc_a", title: "Budget", snippets: [] }],
    page: { total: 1 },
  },
  "/api/tree": { folders: [{ name: "finance", count: 1, children: [] }] },
  "/api/jobs": { jobs: [] },
  "/api/locks": { locks: [] },
  "/api/threads/th_a": {
    id: "th_a",
    title: "A thread",
    turns: [{ author: "agent", ts: "2026-07-27T09:00:00Z", body: "First." }],
  },
  "/api/threads/th_a/turns": {
    thread: {},
    turn: { author: "user", ts: "2026-07-27T10:00:00Z", body: "typed in the probe" },
    eventId: null,
    warnings: [],
  },
};

function routedFetch(): typeof globalThis.fetch {
  return vi.fn((input: RequestInfo | URL) => {
    const { pathname } = new URL(new Request(input).url);
    return Promise.resolve(
      new Response(JSON.stringify(BODIES[pathname] ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

let harness: CorpusTestHarness | undefined;

/** The probe reads `?thread=` from the router, so it needs one. */
function routed(
  harnessWrapper: (props: { children?: ReactNode }) => ReactNode,
  route = "/__probe",
) {
  return function Wrapper({ children }: { readonly children?: ReactNode }): ReactNode {
    return <MemoryRouter initialEntries={[route]}>{harnessWrapper({ children })}</MemoryRouter>;
  };
}

function renderProbe(route?: string): void {
  harness = createCorpusTestHarness({
    fetch: routedFetch(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  render(<DataProbe />, { wrapper: routed(harness.Wrapper, route) });
}

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
});

describe("DataProbe", () => {
  it("mounts every read hook over one connection", async () => {
    renderProbe();
    await waitFor(() => {
      expect(screen.getByText("Budget")).toBeDefined();
    });
    for (const label of ["useDocs", "useTree", "useJobs", "useLocks"]) {
      expect(
        document.querySelector(`[data-probe="${label}"] [data-probe-state="ok"]`),
      ).not.toBeNull();
    }
    expect(harness?.eventSource.sources).toHaveLength(1);
  });

  it("surfaces the connection state so a dropped stream is visible", async () => {
    renderProbe();
    expect(document.querySelector('[data-probe-connection="connecting"]')).not.toBeNull();

    act(() => {
      harness?.eventSource.latest().emit("open");
    });
    expect(document.querySelector('[data-probe-connection="open"]')).not.toBeNull();

    act(() => {
      harness?.eventSource.latest().emit("error");
    });
    expect(document.querySelector('[data-probe-connection="reconnecting"]')).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByText("Budget")).toBeDefined();
    });
  });

  it("shows no thread panel without a `thread` parameter", () => {
    renderProbe();
    expect(document.querySelector("[data-probe-thread]")).toBeNull();
  });

  it("renders the thread and its append control when one is named", async () => {
    renderProbe("/__probe?thread=th_a");
    await waitFor(() => {
      expect(document.querySelector('[data-probe-thread="th_a"]')).not.toBeNull();
    });
    await waitFor(() => {
      expect(document.querySelector('[data-turn-ts="2026-07-27T09:00:00Z"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-turn-pending="false"]')).not.toBeNull();
    expect(document.querySelector("[data-probe-append]")).not.toBeNull();
  });

  it("appends a turn through useAppendTurn and reports the outcome", async () => {
    renderProbe("/__probe?thread=th_a");
    await waitFor(() => {
      expect(document.querySelector('[data-turn-ts="2026-07-27T09:00:00Z"]')).not.toBeNull();
    });

    const input = screen.getByLabelText("Turn body");
    act(() => {
      fireEvent.change(input, { target: { value: "typed in the probe" } });
    });
    expect((input as HTMLInputElement).value).toBe("typed in the probe");

    act(() => {
      fireEvent.click(screen.getByText("append turn"));
    });
    await waitFor(() => {
      expect(document.querySelector('[data-probe-append-state="success"]')).not.toBeNull();
    });
  });

  it("shows the append error rather than failing silently", async () => {
    harness = createCorpusTestHarness({
      fetch: vi.fn((input: RequestInfo, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify({ code: "locked", message: "held" }), {
              status: 423,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        const { pathname } = new URL(request.url);
        return Promise.resolve(
          new Response(JSON.stringify(BODIES[pathname] ?? {}), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as never,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
    render(<DataProbe />, { wrapper: routed(harness.Wrapper, "/__probe?thread=th_a") });

    await waitFor(() => {
      expect(document.querySelector("[data-probe-append]")).not.toBeNull();
    });
    act(() => {
      fireEvent.click(screen.getByText("append turn"));
    });
    await waitFor(() => {
      expect(document.querySelector("[data-probe-append-error]")?.textContent).toContain("423");
    });
  });

  it("reports a failed read rather than rendering an empty page", async () => {
    harness = createCorpusTestHarness({
      fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as never,
    });
    render(<DataProbe />, { wrapper: routed(harness.Wrapper) });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-probe-state^="error"]').length).toBe(4);
    });
  });
});
