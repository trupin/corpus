/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardTransport } from "../testing/boardFixture";
import { NewListPicker } from "./NewListPicker";

afterEach(cleanup);

const TREE = {
  folders: [
    {
      path: "finance",
      name: "finance",
      count: 2,
      totalCount: 3,
      children: [],
    },
    { path: "inbox", name: "inbox", count: 1, totalCount: 1, children: [] },
  ],
};

function renderPicker(searchQuery = "") {
  const wire = boardTransport({ tree: TREE });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  const onChoose = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <NewListPicker
      position={{ left: 40, top: 60 }}
      searchQuery={searchQuery}
      onChoose={onChoose}
      onClose={onClose}
    />,
    { wrapper: harness.Wrapper },
  );
  return { ...view, onChoose, onClose, wire };
}

describe("NewListPicker", () => {
  it("opens at the point it was given", () => {
    const { container } = renderPicker();
    const menu = container.querySelector<HTMLElement>(".ac-menu.open");
    expect(menu?.style.left).toBe("40px");
    expect(menu?.style.top).toBe("60px");
  });

  it("lists the workspace's real folders with the counts the tree reports", async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /finance/ })).toBeDefined();
    });
    expect(screen.getByRole("menuitem", { name: /finance/ }).textContent).toContain("3 docs");
    expect(screen.getByRole("menuitem", { name: /inbox/ }).textContent).toContain("1 doc");
  });

  it("offers presets", () => {
    expect(renderPicker()).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Due this week/ })).toBeDefined();
  });

  /**
   * Three sources and no fourth: the workspace's folders, the presets and the
   * current search. Nothing in this menu is discovered at runtime, so what a
   * person can start a list from is what the corpus holds.
   */
  it("offers folders, presets and the search — and nothing from anywhere else", async () => {
    const { container } = renderPicker("mortgage");
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /finance/ })).toBeDefined();
    });
    const sources = [...container.querySelectorAll("[data-newlist]")].map(
      (item) => (item.getAttribute("data-newlist") ?? "").split(":")[0],
    );
    expect(new Set(sources)).toEqual(new Set(["folder", "preset", "search"]));
  });

  it("omits the from-search entry when no search query is active", () => {
    renderPicker();
    expect(screen.queryByRole("menuitem", { name: /From search|🔎/ })).toBeNull();
  });

  it("offers the current search when there is one", () => {
    renderPicker("mortgage");
    expect(screen.getByRole("menuitem", { name: /mortgage/ }).textContent).toContain("q=mortgage");
  });

  it("hands the chosen list back rather than creating it itself", async () => {
    const { onChoose, wire } = renderPicker();
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /finance/ })).toBeDefined();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /finance/ }));

    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ source: "folder", query: { folder: "finance" } }),
    );
    // The picker writes nothing; the board does.
    expect(wire.writes("POST")).toEqual([]);
  });

  it("closes on an outside click and on Escape, but not on a click inside", () => {
    const { onClose, container } = renderPicker();
    fireEvent.mouseDown(container.querySelector(".ac-menu") as Element);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
