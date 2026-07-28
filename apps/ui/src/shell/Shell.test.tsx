/** @vitest-environment jsdom */
import { createCorpusTestHarness, type CorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardTransport } from "../testing/boardFixture";
import { memoryStorage } from "../testing/memoryStorage";
import { isOverlayOpen, Shell } from "./Shell";
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

describe("the search overlay's one global key", () => {
  const openShell = (): ReturnType<typeof render> =>
    renderShell(boardTransport({ views: [], tree: { folders: [] } }).fetch);

  it("is closed until asked for — the overlay is mounted, not hidden", () => {
    const { container } = openShell();
    expect(container.querySelector(".overlay")).toBeNull();
    expect(isOverlayOpen()).toBe(false);
  });

  it("opens on ⌘K and on the top bar's search button, and closes on Escape", async () => {
    const user = userEvent.setup();
    openShell();

    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
    });
    expect(isOverlayOpen()).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Search corpus" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
    });
  });

  it("opens on ⌃K too, for the keyboard the rest of the world uses", async () => {
    const user = userEvent.setup();
    openShell();
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
    });
  });

  it("returns focus to whatever opened it", async () => {
    const user = userEvent.setup();
    openShell();
    const searchbar = screen.getByRole("button", { name: "Search corpus" });

    await user.click(searchbar);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Search query"));
    });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(document.activeElement).toBe(searchbar);
    });
  });

  it("does not toggle itself shut when ⌘K is pressed again", async () => {
    const user = userEvent.setup();
    openShell();
    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
    });

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
  });
});
