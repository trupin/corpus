/** @vitest-environment jsdom */
import { createCorpusTestHarness } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardTransport } from "../testing/boardFixture";
import { buildRegistry, EMPTY_REGISTRY, setPluginRegistry } from "../plugins/registry";
import { columnRequest, type NewListChoice } from "./newList";
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

  it("offers registered plugin column types, and creates through the same choice path", () => {
    setPluginRegistry(
      buildRegistry([
        {
          dir: "fx",
          loaded: {
            module: {
              default: {
                id: "fx",
                name: "FX",
                docTypes: [],
                columns: [
                  {
                    type: "board",
                    label: "FX board",
                    icon: "▣",
                    Component: () => null,
                    defaultQuery: { type: "fx-item" },
                  },
                ],
              },
            },
          },
        },
      ]),
    );
    try {
      const { onChoose } = renderPicker();
      const item = screen.getByRole("menuitem", { name: /FX board/ });
      expect(item.textContent).toContain("fx/board");
      fireEvent.click(item);
      expect(onChoose).toHaveBeenCalledWith(
        expect.objectContaining({
          source: "plugin",
          column: "fx/board",
          query: { type: "fx-item" },
        }),
      );
      // The choice compiles to the same POST /api/docs body every column uses,
      // with the plugin reference and defaultQuery merged into frontmatter.
      const choice = (onChoose.mock.calls[0] as [NewListChoice])[0];
      expect(columnRequest(choice, 40)).toMatchObject({
        type: "view",
        pinned: true,
        order: 40,
        column: "fx/board",
        query: { type: "fx-item" },
      });
    } finally {
      setPluginRegistry(EMPTY_REGISTRY);
    }
  });

  it("offers no plugin entries when no plugin is installed", () => {
    setPluginRegistry(EMPTY_REGISTRY);
    const { container } = renderPicker();
    expect(container.querySelector("[data-newlist^='plugin:']")).toBeNull();
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
