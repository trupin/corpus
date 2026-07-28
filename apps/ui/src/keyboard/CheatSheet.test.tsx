/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { isOverlayOpen } from "../shell/overlays";

/**
 * A binding that exists nowhere in the product, injected into the registry the
 * component reads. It is the whole point of the suite: if the panel renders it
 * without this file touching `CheatSheet.tsx`, the legend is generated. A
 * hand-written legend cannot pass this and can pass everything else.
 */
const FIXTURE = {
  id: "fixture.invented",
  chords: [{ keys: ["z"], shift: false, label: "z" }],
  scope: "board" as const,
  group: "fixture",
  description: "a binding no one wrote a row for",
  run: () => undefined,
};

vi.mock("./shortcuts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shortcuts")>();
  return { ...actual, SHORTCUTS: [...actual.SHORTCUTS, FIXTURE] };
});

const { CheatSheet } = await import("./CheatSheet");
const { SHORTCUTS } = await import("./shortcuts");

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

describe("CheatSheet", () => {
  it("renders exactly one row per registry entry, the fixture included", () => {
    const { container } = render(<CheatSheet onClose={() => undefined} />);
    const rows = container.querySelectorAll(".kbd-row");
    expect(rows).toHaveLength(SHORTCUTS.length);
    expect(container.querySelector('.kbd-row[data-shortcut="fixture.invented"]')).not.toBeNull();
    expect(container.querySelector('[data-shortcut="fixture.invented"] .d')?.textContent).toBe(
      FIXTURE.description,
    );
  });

  it("renders the prototype's panel: a Keyboard header over a two-column grid", () => {
    const { container } = render(<CheatSheet onClose={() => undefined} />);
    const panel = container.querySelector(".search-panel.kbd-panel");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.querySelector("h3")?.textContent).toBe("Keyboard");
    expect(panel?.querySelector(".kbd-grid")).not.toBeNull();
  });

  it("chips only the keys the prototype chips, and names the rest in the description", () => {
    const { container } = render(<CheatSheet onClose={() => undefined} />);
    const rowKeys = (id: string): string[] =>
      [...(container.querySelectorAll(`[data-shortcut="${id}"] .keys kbd`) ?? [])].map(
        (chip) => chip.textContent ?? "",
      );
    expect(rowKeys("rows.move")).toEqual(["↑", "↓"]);
    expect(rowKeys("columns.switch")).toEqual(["←", "→"]);
    expect(rowKeys("columns.move")).toEqual(["⇧←", "⇧→"]);
    expect(rowKeys("layers.close")).toEqual(["esc"]);
    expect(rowKeys("search.open")).toEqual(["⌘K"]);
  });

  it("carries `.overlay.open`, so `isOverlayOpen()` tells the truth about it", () => {
    render(<CheatSheet onClose={() => undefined} />);
    expect(isOverlayOpen()).toBe(true);
  });

  it("closes on escape, through the one escape chain", () => {
    const onClose = vi.fn();
    render(<CheatSheet onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the scrim itself is pressed, and not when the panel is", () => {
    const onClose = vi.fn();
    const { container } = render(<CheatSheet onClose={onClose} />);
    fireEvent.mouseDown(container.querySelector(".kbd-panel") as Element);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector(".overlay") as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
