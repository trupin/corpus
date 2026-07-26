/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleStrip } from "./ConsoleStrip";

const HEALTH_BODY = {
  status: "ok",
  version: "1.2.3",
  uptimeSeconds: 3,
  workspace: "/tmp/corpus-workspace",
};

let client: QueryClient;

function renderStrip(): ReturnType<typeof render> {
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <ConsoleStrip />
    </QueryClientProvider>
  );
  return render(tree);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe("ConsoleStrip", () => {
  it("renders one collapsed line as a flow sibling, never a fixed overlay", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const { container } = renderStrip();

    const console_ = container.querySelector(".console");
    expect(console_).not.toBeNull();
    expect(container.querySelector(".console-body")).toBeNull();
    expect(container.querySelectorAll(".console-strip")).toHaveLength(1);
    expect(console_?.querySelector(".c-caret")?.textContent).toBe("▴");
    expect(console_?.textContent).toContain("console");
  });

  it("reports an honest pending state while the probe is in flight", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    renderStrip();
    expect(screen.getByRole("status").textContent).toBe("checking server…");
  });

  it("reports the server version once the probe answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(HEALTH_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    renderStrip();
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("corpus 1.2.3");
    });
  });

  it("shows the server-unreachable notice instead of crashing the shell", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { container } = renderStrip();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
    expect(container.querySelector(".c-failed")).not.toBeNull();
    expect(container.querySelector(".console-strip")).not.toBeNull();
  });
});
