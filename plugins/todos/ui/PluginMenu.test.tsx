/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampToViewport, PluginMenu, type PluginMenuAction } from "./PluginMenu.js";

afterEach(cleanup);

/**
 * The frame's half of "the menu behaves like every other menu in the app"
 * (SPEC.md §10: `esc` dismisses, arrows navigate, `↵` activates). What is *in*
 * the menu is `TodoItemMenu`'s business and is tested there.
 */

const action = (id: string, overrides: Partial<PluginMenuAction> = {}): PluginMenuAction => ({
  id,
  label: id,
  meta: `${id} meta`,
  run: vi.fn(),
  ...overrides,
});

interface Mounted {
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly actions: readonly PluginMenuAction[];
}

function mount(actions: readonly PluginMenuAction[], autoFocus = false): Mounted {
  const onClose = vi.fn();
  render(
    <PluginMenu
      label="Actions for «Call the plumber»"
      clientX={40}
      clientY={60}
      autoFocus={autoFocus}
      actions={actions}
      onClose={onClose}
    />,
  );
  return { onClose, actions };
}

const items = (): HTMLElement[] => screen.getAllByRole("menuitem");
const frame = (): HTMLElement => screen.getByRole("menu");

describe("PluginMenu", () => {
  it("declares itself a menu, so the app's shortcut scope knows one is open", () => {
    mount([action("toggle"), action("comment")]);
    // `apps/ui/src/shell/overlays.ts` asks the DOM `[role="menu"]`; that is the
    // whole interop contract, and it is how `↵` reaches a menu item instead of
    // the board's own `rows.open` (UI-028).
    expect(frame().getAttribute("aria-label")).toBe("Actions for «Call the plumber»");
    expect(frame().className).toContain("ac-menu");
    expect(items().map((node) => node.dataset["act"])).toEqual(["toggle", "comment"]);
    expect(items()[0]?.textContent).toContain("toggle meta");
  });

  it("runs an action once and closes, so a second press cannot repeat it", () => {
    const run = vi.fn();
    const { onClose } = mount([action("toggle", { run })]);
    fireEvent.click(items()[0] as HTMLElement);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the frame for a pointer and the first item for a key", () => {
    mount([action("toggle"), action("comment")]);
    expect(document.activeElement).toBe(frame());
    cleanup();
    mount([action("toggle"), action("comment")], true);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("walks the items with the arrows, Home and End, and stops at the ends", () => {
    mount([action("a"), action("b"), action("c")], true);
    fireEvent.keyDown(frame(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(frame(), { key: "End" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(frame(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(frame(), { key: "Home" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(frame(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[0]);
  });

  it("never lands the keyboard on a disabled item", () => {
    mount([action("a"), action("b", { disabled: true }), action("c")], true);
    fireEvent.keyDown(frame(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[2]);
  });

  it("dismisses on Escape before anything behind it can act", () => {
    const behind = vi.fn();
    // The app's escape chain listens on `document` in the capture phase; this
    // menu listens on `window`, which captures first — so a reader underneath
    // never sees the press and stays open.
    document.addEventListener("keydown", behind, true);
    const { onClose } = mount([action("toggle")]);
    fireEvent.keyDown(frame(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
    document.removeEventListener("keydown", behind, true);
  });

  it("dismisses on Tab rather than walking the document behind it", () => {
    const { onClose } = mount([action("toggle")]);
    fireEvent.keyDown(frame(), { key: "Tab" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on a click outside, and not on one inside", () => {
    const { onClose } = mount([action("toggle")]);
    fireEvent.mouseDown(frame());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to whatever opened it", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    mount([action("toggle")]);
    expect(document.activeElement).not.toBe(opener);
    cleanup();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("clampToViewport", () => {
  const viewport = { width: 1000, height: 800 };

  it("opens at the pointer when there is room", () => {
    expect(clampToViewport(120, 240, viewport)).toEqual({ left: 120, top: 240 });
  });

  it("slides back from an edge rather than flipping across the pointer", () => {
    expect(clampToViewport(990, 790, viewport)).toEqual({ left: 736, top: 596 });
  });

  it("never leaves the viewport on the near side either", () => {
    expect(clampToViewport(-50, -50, viewport)).toEqual({ left: 4, top: 4 });
  });
});
