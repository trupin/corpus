/** @vitest-environment jsdom */
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleStrip } from "./ConsoleStrip";

/**
 * Adapted for UI-002: the health probe moved into `@corpus/kit` (it is the key
 * the SSE bridge invalidates on connect and disconnect, so it belongs beside
 * the bridge), which means the strip now needs a `CorpusProvider` rather than a
 * bare `QueryClientProvider`. Every assertion below is the one UI-001 shipped.
 */

const HEALTH_BODY = {
  status: "ok",
  version: "1.2.3",
  uptimeSeconds: 3,
  workspace: "/tmp/corpus-workspace",
};

let harness: CorpusTestHarness | undefined;

function renderStrip(fetchImpl: unknown): ReturnType<typeof render> {
  harness = createCorpusTestHarness({
    fetch: fetchImpl as typeof globalThis.fetch,
    // The drop test emits a transport error on purpose; the default logger is
    // `console`, and its output would be noise, not signal.
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });
  return render(<ConsoleStrip />, { wrapper: harness.Wrapper });
}

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
  vi.unstubAllGlobals();
});

describe("ConsoleStrip", () => {
  it("renders one collapsed line as a flow sibling, never a fixed overlay", () => {
    const { container } = renderStrip(vi.fn().mockReturnValue(new Promise(() => {})));

    const console_ = container.querySelector(".console");
    expect(console_).not.toBeNull();
    expect(container.querySelector(".console-body")).toBeNull();
    expect(container.querySelectorAll(".console-strip")).toHaveLength(1);
    expect(console_?.querySelector(".c-caret")?.textContent).toBe("▴");
    expect(console_?.textContent).toContain("console");
  });

  it("reports an honest pending state while the probe is in flight", () => {
    renderStrip(vi.fn().mockReturnValue(new Promise(() => {})));
    expect(screen.getByRole("status").textContent).toBe("checking server…");
  });

  it("reports the server version once the probe answers", async () => {
    renderStrip(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(HEALTH_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("corpus 1.2.3");
    });
  });

  it("shows the server-unreachable notice instead of crashing the shell", async () => {
    const { container } = renderStrip(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
    expect(container.querySelector(".c-failed")).not.toBeNull();
    expect(container.querySelector(".console-strip")).not.toBeNull();
  });

  // TEST-26, at the surface the criterion is written about: the strip's verdict
  // is the boot-time probe forever unless something invalidates the health key,
  // and losing the stream is exactly when it stops being true.
  it("converges from a version to unreachable when the stream drops", async () => {
    let answer: () => Response = () =>
      new Response(JSON.stringify(HEALTH_BODY), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    renderStrip(vi.fn().mockImplementation(() => Promise.resolve(answer())));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("corpus 1.2.3");
    });

    answer = () => {
      throw new TypeError("Failed to fetch");
    };
    harness?.eventSource.latest().emit("error");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
  });
});
