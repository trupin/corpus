/** @vitest-environment jsdom */
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../testing/memoryStorage";
import { Shell } from "./Shell";
import { THEME_ATTRIBUTE } from "./theme";

/**
 * Adapted for UI-002: the console strip's health probe is a kit hook now, so
 * the shell renders inside a `CorpusProvider` instead of a bare
 * `QueryClientProvider`. The assertions are UI-001's, unchanged.
 */

let harness: CorpusTestHarness | undefined;

function renderShell(fetchImpl?: unknown): ReturnType<typeof render> {
  harness = createCorpusTestHarness({
    fetch: (fetchImpl ?? vi.fn().mockReturnValue(new Promise(() => {}))) as typeof globalThis.fetch,
  });
  return render(<Shell />, { wrapper: harness.Wrapper });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  harness?.queryClient.clear();
  harness = undefined;
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
    const { container } = renderShell(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("server unreachable");
    });
    expect(container.querySelector(".topbar")).not.toBeNull();
    expect(container.querySelector(".board")).not.toBeNull();
    expect(container.querySelector(".console")).not.toBeNull();
  });
});
