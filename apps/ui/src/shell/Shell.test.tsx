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

/**
 * The three overlays are one layer, and the shell is where that is enforced —
 * `?` never stacks on the composer, ⌘K replaces it, and every one of them is a
 * `.overlay.open` so `isOverlayOpen()` keeps telling the truth.
 */
describe("the shell's one overlay layer", () => {
  const openShell = (): ReturnType<typeof render> =>
    renderShell(boardTransport({ views: [], tree: { folders: [] } }).fetch);

  const composer = (): HTMLElement | null =>
    screen.queryByRole("dialog", { name: "Ask or capture" });
  const cheatSheet = (): HTMLElement | null => screen.queryByRole("dialog", { name: "Keyboard" });

  it("opens the composer from `c` and from the top bar's button, with the caret in the textarea", async () => {
    const user = userEvent.setup();
    openShell();

    await user.keyboard("c");
    await waitFor(() => {
      expect(composer()).not.toBeNull();
    });
    expect(isOverlayOpen()).toBe(true);
    expect(document.activeElement?.getAttribute("data-composer")).toBe("compose");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(composer()).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: /Ask \/ Capture/ }));
    await waitFor(() => {
      expect(composer()).not.toBeNull();
    });
  });

  it("shows the `c` hint on the button, because a shortcut nobody sees is unused", () => {
    openShell();
    expect(
      screen.getByRole("button", { name: /Ask \/ Capture/ }).querySelector("kbd")?.textContent,
    ).toBe("c");
  });

  it("toggles the cheat sheet with `?` and closes it with escape", async () => {
    const user = userEvent.setup();
    openShell();

    await user.keyboard("?");
    await waitFor(() => {
      expect(cheatSheet()).not.toBeNull();
    });
    await user.keyboard("?");
    await waitFor(() => {
      expect(cheatSheet()).toBeNull();
    });

    await user.keyboard("?");
    await waitFor(() => {
      expect(cheatSheet()).not.toBeNull();
    });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(cheatSheet()).toBeNull();
    });
  });

  it("refuses `?` while another overlay is up rather than stacking a second one", async () => {
    const user = userEvent.setup();
    openShell();
    await user.keyboard("c");
    await waitFor(() => {
      expect(composer()).not.toBeNull();
    });

    await user.keyboard("?");
    expect(cheatSheet()).toBeNull();
    expect(composer()).not.toBeNull();
    expect(document.querySelectorAll(".overlay.open")).toHaveLength(1);
  });

  it("lets ⌘K replace the composer — one overlay at a time", async () => {
    const user = userEvent.setup();
    openShell();
    await user.keyboard("c");
    await waitFor(() => {
      expect(composer()).not.toBeNull();
    });

    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Search" })).toBeDefined();
    });
    expect(composer()).toBeNull();
    expect(document.querySelectorAll(".overlay.open")).toHaveLength(1);
  });

  it("types a `c` into the composer instead of reopening it", async () => {
    const user = userEvent.setup();
    openShell();
    await user.keyboard("c");
    await waitFor(() => {
      expect(composer()).not.toBeNull();
    });

    await user.keyboard("cat");
    expect(screen.getByLabelText("Ask the agent, or capture a thought")).toHaveProperty(
      "value",
      "cat",
    );
    expect(document.querySelectorAll(".overlay.open")).toHaveLength(1);
  });

  it("types `c`, `e`, `f`, `r`, `j`, `k` and `?` into the search input rather than acting on them", async () => {
    const user = userEvent.setup();
    openShell();
    await user.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => {
      expect(screen.getByLabelText("Search query")).toBeDefined();
    });

    await user.keyboard("cefrjk?");
    expect(screen.getByLabelText("Search query")).toHaveProperty("value", "cefrjk?");
    expect(cheatSheet()).toBeNull();
    expect(composer()).toBeNull();
  });

  it("renders the cheat sheet from the registry, one row per binding", async () => {
    const user = userEvent.setup();
    const { container } = openShell();
    await user.keyboard("?");
    await waitFor(() => {
      expect(cheatSheet()).not.toBeNull();
    });
    expect(container.ownerDocument.querySelectorAll(".kbd-row").length).toBeGreaterThan(0);
    expect(screen.getByText("Ask / Capture composer")).toBeDefined();
    expect(screen.getByText("this cheat-sheet")).toBeDefined();
  });
});
