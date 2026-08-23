/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCommands } from "../keyboard/boardCommands";
import { useShortcuts } from "../keyboard/useShortcuts";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { ContextMenuProvider, useContextMenu } from "./ContextMenuHost";
import { MenuItems } from "./MenuItems";
import type { MenuAction } from "./menuModel";

/**
 * The menu frame's own contract (SPEC.md §10): *"`esc` dismisses, arrows
 * navigate, `↵` activates"*, an outside click closes, and focus returns to
 * whatever opened it.
 *
 * It is tested once, here, because there is one frame — a second dismissal
 * implementation is what sprint-016 TEST-442 exists to prevent.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const ARCHIVE = vi.fn();
const DELETE = vi.fn();

beforeEach(() => {
  ARCHIVE.mockClear();
  DELETE.mockClear();
});

/** A board that records rather than acts, so a swallowed key is visible. */
function boardSpy(): BoardCommands & { readonly calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(args.length === 0 ? name : `${name}:${String(args[0])}`);
    };
  return {
    calls,
    moveRowCursor: record("moveRowCursor"),
    openRowAtCursor: record("openRowAtCursor"),
    closeAllPaths: record("closeAllPaths"),
    switchColumn: record("switchColumn"),
    moveActiveColumn: record("moveActiveColumn"),
    toggleFocusMode: record("toggleFocusMode"),
    archiveTarget: record("archiveTarget"),
    focusReply: record("focusReply"),
    openContextMenu: record("openContextMenu"),
  };
}

function actions(): MenuAction[] {
  return [
    { id: "archive", label: "Archive", meta: "reversible", run: ARCHIVE },
    { id: "nope", label: "Unavailable", meta: "not now", disabled: true, run: () => undefined },
    {
      id: "delete",
      label: "Delete…",
      meta: "click twice",
      danger: true,
      confirm: { label: "Really delete?", meta: "permanent" },
      keepOpen: true,
      run: DELETE,
    },
  ];
}

function Opener({ autoFocus }: { readonly autoFocus?: boolean }): ReactElement {
  const menu = useContextMenu();
  const [count, setCount] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCount(count + 1);
          menu.open({
            label: "Actions for Mortgage options",
            clientX: 120,
            clientY: 90,
            ...(autoFocus === true ? { autoFocus: true } : {}),
            items: (close) => <MenuItems actions={actions()} onDone={close} />,
          });
        }}
      >
        open menu {count}
      </button>
      <input aria-label="elsewhere" />
    </>
  );
}

function mount(autoFocus = false): void {
  render(
    <ContextMenuProvider>
      <Opener autoFocus={autoFocus} />
    </ContextMenuProvider>,
  );
}

function items(): HTMLElement[] {
  return screen.getAllByRole("menuitem");
}

describe("the context menu frame", () => {
  it("opens at the pointer with the caller's items and name", () => {
    mount();
    fireEvent.click(screen.getByText(/open menu/));

    const menu = screen.getByRole("menu", { name: "Actions for Mortgage options" });
    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("90px");
    expect(items().map((item) => item.dataset["act"])).toEqual(["archive", "nope", "delete"]);
  });

  it("dismisses on Escape, through the precedence chain", () => {
    mount();
    fireEvent.click(screen.getByText(/open menu/));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("dismisses on an outside click and keeps a click inside", () => {
    mount();
    fireEvent.click(screen.getByText(/open menu/));
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.queryByRole("menu")).not.toBeNull();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("walks the enabled items with the arrows, skipping the disabled one", () => {
    mount();
    fireEvent.click(screen.getByText(/open menu/));
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items()[0]);
  });

  it("focuses the first item when a key opened it, and not when a pointer did", () => {
    mount(true);
    fireEvent.click(screen.getByText(/open menu/));
    expect(document.activeElement).toBe(items()[0]);

    cleanup();
    resetEscapeLayers();
    mount(false);
    fireEvent.click(screen.getByText(/open menu/));
    expect(document.activeElement).not.toBe(items()[0]);
  });

  /**
   * PR #12 review, MINOR 16. Tab was neither trapped nor dismissing: focus
   * walked out of a surface painted over the page and left the menu standing
   * over content the keyboard was now in.
   */
  it("dismisses on Tab and hands focus back, as a native menu does", () => {
    mount(true);
    const opener = screen.getByText(/open menu/);
    opener.focus();
    fireEvent.click(opener);
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "Tab" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to whatever opened it", () => {
    mount(true);
    const opener = screen.getByText(/open menu/);
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("runs an ordinary item once and closes", () => {
    mount();
    fireEvent.click(screen.getByText(/open menu/));
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));
    expect(ARCHIVE).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("arms a confirming item on the first activation and issues nothing", () => {
    mount();
    fireEvent.click(screen.getByText(/open menu/));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(DELETE).not.toHaveBeenCalled();
    expect(screen.getByText("Really delete?")).toBeTruthy();
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /Really delete/ }));
    expect(DELETE).toHaveBeenCalledTimes(1);
  });

  it("opens a second menu unarmed rather than inheriting the first one's state", () => {
    mount();
    fireEvent.click(screen.getByText(/open menu/));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(screen.getByText("Really delete?")).toBeTruthy();

    fireEvent.click(screen.getByText(/open menu/));
    expect(screen.queryByText("Really delete?")).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Delete…/ })).toBeTruthy();
  });

  /**
   * SPEC.md §10's "`↵` activates", and UI-028's regression.
   *
   * The frame does not implement `↵` — a focused `<button>` activates on it
   * through its default action. What broke it was the board's own `↵` binding
   * (`rows.open`) matching first on the document listener and calling
   * `preventDefault()`, which cancels that default action. So what is asserted
   * here is the whole chain with the real dispatcher mounted: the key reaches
   * the item **unprevented**, no board command ran, and the activation the
   * browser then performs runs the action and closes the menu.
   */
  describe("↵ activates the focused item", () => {
    function mountWithShortcuts(): BoardCommands & { readonly calls: string[] } {
      const board = boardSpy();
      function Harness(): ReactElement {
        useShortcuts({
          openCompose: () => undefined,
          openSearch: () => undefined,
          toggleCheatSheet: () => undefined,
          showNthBoard: () => undefined,
          board,
        });
        return (
          <ContextMenuProvider>
            <Opener autoFocus />
          </ContextMenuProvider>
        );
      }
      render(<Harness />);
      return board;
    }

    for (const code of ["Enter", "NumpadEnter"]) {
      it(`reaches the item unprevented on ${code}`, () => {
        const board = mountWithShortcuts();
        fireEvent.click(screen.getByText(/open menu/));
        const first = items()[0];
        expect(document.activeElement).toBe(first);

        const event = new KeyboardEvent("keydown", { key: "Enter", code, bubbles: true });
        first?.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(board.calls).toEqual([]);
        // The default action the browser performs on an unprevented ↵: a click
        // on the focused button. jsdom does not synthesise it, so it is fired.
        fireEvent.click(first as HTMLElement);
        expect(ARCHIVE).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("menu")).toBeNull();
      });
    }

    it("still lets esc dismiss without running anything", () => {
      const board = mountWithShortcuts();
      fireEvent.click(screen.getByText(/open menu/));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(ARCHIVE).not.toHaveBeenCalled();
      expect(board.calls).toEqual([]);
    });
  });

  it("is a no-op, not a crash, with no host above it", () => {
    render(<Opener />);
    fireEvent.click(screen.getByText(/open menu/));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
