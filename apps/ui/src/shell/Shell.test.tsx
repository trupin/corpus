/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../testing/memoryStorage";
import { Shell } from "./Shell";
import { THEME_ATTRIBUTE } from "./theme";

let client: QueryClient;

function renderShell(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
});

describe("Shell", () => {
  it("renders top bar, board and console strip in that document order", () => {
    const { container } = renderShell();
    const app = container.querySelector(".app");
    expect(app).not.toBeNull();

    const regions = [...(app?.children ?? [])].map((child) => child.className);
    expect(regions).toEqual(["topbar", "board", "console"]);
  });

  it("has no sidebar", () => {
    const { container } = renderShell();
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
  });

  it("keeps the board as the only scrolling region between the two fixed strips", () => {
    const { container } = renderShell();
    expect(container.querySelector(".board")).not.toBeNull();
    expect(container.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".console-strip")).not.toBeNull();
  });

  it("still renders every region when the health probe fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { container } = renderShell();

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
    expect(container.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".board")).not.toBeNull();
    expect(container.querySelector(".console")).not.toBeNull();
  });
});
