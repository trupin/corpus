/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EscapeLayerPriority, resetEscapeLayers, useEscapeLayer } from "../reader/useEscapeStack";
import type { BoardCommands } from "./boardCommands";
import type { ShortcutContext } from "./shortcuts";
import {
  currentScope,
  isWritingSurface,
  ownsActivationKeys,
  resolveShortcut,
  useShortcuts,
} from "./useShortcuts";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  document.body.innerHTML = "";
});

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

function mount(context: ShortcutContext, extra?: ReactElement): void {
  function Harness(): ReactElement {
    useShortcuts(context);
    return <>{extra}</>;
  }
  render(<Harness />);
}

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent("keydown", init);

describe("useShortcuts", () => {
  it("binds every handler from the registry", () => {
    const board = boardSpy();
    const openCompose = vi.fn();
    const openSearch = vi.fn();
    const toggleCheatSheet = vi.fn();
    mount({ openCompose, openSearch, toggleCheatSheet, showNthBoard: vi.fn(), board });

    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Enter", altKey: true });
    fireEvent.keyDown(document, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(document, { key: "]" });
    fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(document, { key: "f" });
    fireEvent.keyDown(document, { key: "e" });
    fireEvent.keyDown(document, { key: "r" });
    fireEvent.keyDown(document, { key: "c" });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "?", shiftKey: true });

    expect(board.calls).toEqual([
      "moveRowCursor:1",
      "moveRowCursor:-1",
      "openRowAtCursor:path",
      "openRowAtCursor:here",
      "openRowAtCursor:fullScreen",
      "switchColumn:1",
      "moveActiveColumn:1",
      "toggleFocusMode",
      "archiveTarget",
      "focusReply",
    ]);
    expect(openCompose).toHaveBeenCalledTimes(1);
    expect(openSearch).toHaveBeenCalledTimes(1);
    expect(toggleCheatSheet).toHaveBeenCalledTimes(1);
  });

  it("never dispatches esc or ⌫ — that chain is the escape layer's", () => {
    const board = boardSpy();
    const onEscape = vi.fn();
    function Layered(): ReactElement {
      useEscapeLayer({ active: true, priority: EscapeLayerPriority.Reader, onEscape });
      return <span />;
    }
    mount(
      {
        openCompose: vi.fn(),
        openSearch: vi.fn(),
        toggleCheatSheet: vi.fn(),
        showNthBoard: vi.fn(),
        board,
      },
      <Layered />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(board.calls).toEqual([]);
  });

  describe("writing surfaces", () => {
    it("recognises inputs, textareas, contenteditable and opted-out subtrees", () => {
      document.body.innerHTML = `
        <input id="i" />
        <textarea id="t"></textarea>
        <div id="ce" contenteditable="true"><span id="inner">x</span></div>
        <div data-shortcuts="off"><button id="btn">x</button></div>
        <button id="plain">x</button>`;
      const at = (id: string): Element | null => document.getElementById(id);
      expect(isWritingSurface(at("i"))).toBe(true);
      expect(isWritingSurface(at("t"))).toBe(true);
      expect(isWritingSurface(at("ce"))).toBe(true);
      expect(isWritingSurface(at("inner"))).toBe(true);
      expect(isWritingSurface(at("btn"))).toBe(true);
      expect(isWritingSurface(at("plain"))).toBe(false);
      expect(isWritingSurface(null)).toBe(false);
    });

    /**
     * The guard reads `document.activeElement`, not the event's target —
     * ProseMirror re-targets its key events, and a `c` typed into the editor
     * would otherwise open the composer mid-sentence.
     */
    it("suppresses every binding but ⌘K while a field has the caret", () => {
      const board = boardSpy();
      const openCompose = vi.fn();
      const openSearch = vi.fn();
      mount({ openCompose, openSearch, toggleCheatSheet: vi.fn(), showNthBoard: vi.fn(), board });

      const field = document.createElement("input");
      document.body.append(field);
      field.focus();

      for (const pressed of ["c", "e", "f", "r", "j", "k", "?"]) {
        fireEvent.keyDown(document, { key: pressed, shiftKey: pressed === "?" });
      }
      expect(board.calls).toEqual([]);
      expect(openCompose).not.toHaveBeenCalled();

      fireEvent.keyDown(document, { key: "k", metaKey: true });
      expect(openSearch).toHaveBeenCalledTimes(1);
    });

    it('suppresses them under a `data-shortcuts="off"` root even without a caret in a field', () => {
      const editor = document.createElement("div");
      editor.setAttribute("data-shortcuts", "off");
      editor.tabIndex = 0;
      document.body.append(editor);
      editor.focus();
      expect(
        resolveShortcut(key({ key: "c" }), {
          scope: "board",
          editing: isWritingSurface(document.activeElement),
          controlFocused: ownsActivationKeys(document.activeElement),
        }),
      ).toBeNull();
    });
  });

  it("ignores a keystroke that is an IME composition", () => {
    const board = boardSpy();
    const openCompose = vi.fn();
    mount({
      openCompose,
      openSearch: vi.fn(),
      toggleCheatSheet: vi.fn(),
      showNthBoard: vi.fn(),
      board,
    });

    fireEvent.keyDown(document, { key: "c", isComposing: true });
    fireEvent.keyDown(document, { key: "c", keyCode: 229 });
    expect(openCompose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "c" });
    expect(openCompose).toHaveBeenCalledTimes(1);
  });

  describe("scope", () => {
    it("reads the overlay scope off the DOM contract, not off state", () => {
      expect(currentScope()).toBe("board");
      const overlay = document.createElement("div");
      overlay.className = "overlay open";
      document.body.append(overlay);
      expect(currentScope()).toBe("overlay");
    });

    it("refuses board bindings while an overlay is up, and keeps the global ones", () => {
      for (const pressed of ["c", "e", "f", "r", "j", "ArrowDown", "Enter"]) {
        expect(
          resolveShortcut(key({ key: pressed }), {
            scope: "overlay",
            editing: false,
            controlFocused: false,
          }),
          pressed,
        ).toBeNull();
      }
      expect(
        resolveShortcut(key({ key: "k", metaKey: true }), {
          scope: "overlay",
          editing: false,
          controlFocused: false,
        })?.id,
      ).toBe("search.open");
      // `?` reaches the shell even over an overlay, because the sheet has to be
      // able to close itself; whether it *replaces* one is the shell's ruling.
      expect(
        resolveShortcut(key({ key: "?" }), {
          scope: "overlay",
          editing: false,
          controlFocused: false,
        })?.id,
      ).toBe("cheatSheet.toggle");
    });

    /**
     * UI-028. `rows.open` is bound to `↵` on the board, and a focused menu item
     * activates on `↵` through its **default action** — which only happens if
     * nothing claims the key first. It did, and `↵` activated nothing in any
     * menu in the app while `Space` (bound to nothing) worked.
     */
    describe("an open menu", () => {
      const menu = (): HTMLElement => {
        const element = document.createElement("div");
        element.setAttribute("role", "menu");
        document.body.append(element);
        return element;
      };

      it("owns the keyboard, read off the ARIA role rather than off state", () => {
        expect(currentScope()).toBe("board");
        const open = menu();
        expect(currentScope()).toBe("overlay");
        open.remove();
        expect(currentScope()).toBe("board");
      });

      it("leaves ↵ to the focused item, in both of its spellings", () => {
        const board = boardSpy();
        mount({
          openCompose: vi.fn(),
          openSearch: vi.fn(),
          toggleCheatSheet: vi.fn(),
          showNthBoard: vi.fn(),
          board,
        });
        const open = menu();
        const item = document.createElement("button");
        item.setAttribute("role", "menuitem");
        open.append(item);
        item.focus();

        // `NumpadEnter` is the same `key` with a different `code`; both must
        // reach the button, and neither may be prevented.
        for (const code of ["Enter", "NumpadEnter"]) {
          const event = new KeyboardEvent("keydown", { key: "Enter", code, bubbles: true });
          item.dispatchEvent(event);
          expect(event.defaultPrevented, code).toBe(false);
        }
        expect(board.calls).toEqual([]);
      });

      it("keeps the board's other keys off the board behind it", () => {
        const board = boardSpy();
        const openCompose = vi.fn();
        mount({
          openCompose,
          openSearch: vi.fn(),
          toggleCheatSheet: vi.fn(),
          showNthBoard: vi.fn(),
          board,
        });
        menu();

        for (const pressed of ["c", "e", "f", "r", "j", "k"]) {
          fireEvent.keyDown(document, { key: pressed });
        }
        expect(board.calls).toEqual([]);
        expect(openCompose).not.toHaveBeenCalled();
      });
    });

    it("stops at the first match rather than running two handlers", () => {
      expect(
        resolveShortcut(key({ key: "Enter" }), {
          scope: "board",
          editing: false,
          controlFocused: false,
        })?.id,
      ).toBe("rows.open");
      expect(
        resolveShortcut(key({ key: "Enter", shiftKey: true }), {
          scope: "board",
          editing: false,
          controlFocused: false,
        })?.id,
      ).toBe("rows.openFullScreen");
    });
  });

  /**
   * UI-032. `↵` on a focused control presses that control, through the default
   * action the dispatcher's `preventDefault()` was cancelling — so no button in
   * board scope could be pressed by keyboard at all, and three separate controls
   * were patched locally before the cause was fixed once. The rule and the
   * alternatives rejected are on `Shortcut.yieldsToFocusedControl`.
   */
  describe("a focused control", () => {
    const focus = (html: string): HTMLElement => {
      document.body.innerHTML = html;
      const element = document.body.firstElementChild;
      if (!(element instanceof HTMLElement)) throw new Error("no element");
      element.tabIndex = element.tabIndex < 0 ? 0 : element.tabIndex;
      element.focus();
      return element;
    };

    it("owns ↵ wherever pressing it is what ↵ means there", () => {
      for (const html of [
        "<button>x</button>",
        '<a href="#x">x</a>',
        "<summary>x</summary>",
        '<div role="button">x</div>',
        '<div role="tab">x</div>',
        '<div role="menuitem">x</div>',
        '<div role="switch">x</div>',
        '<div role="option">x</div>',
      ]) {
        expect(ownsActivationKeys(focus(html)), html).toBe(true);
      }
    });

    it("is not claimed by anything inert, by an anchor without an href, or by nothing", () => {
      for (const html of ["<div>x</div>", "<span>x</span>", "<a>x</a>", "<p>x</p>"]) {
        expect(ownsActivationKeys(focus(html)), html).toBe(false);
      }
      expect(ownsActivationKeys(document.body)).toBe(false);
      expect(ownsActivationKeys(null)).toBe(false);
    });

    /**
     * The trap: the board's row is a control too, and `↵` on the highlighted row
     * is the scheme's own binding (SPEC.md §10). A rule phrased as "skip when a
     * button has focus" would have taken it away.
     */
    it("exempts the board's row, which is a control bound to ↵ on purpose", () => {
      expect(
        ownsActivationKeys(focus('<div class="row" data-row-doc="doc_a" role="button">x</div>')),
      ).toBe(false);
      expect(ownsActivationKeys(focus('<button class="row" data-row-doc="doc_a">x</button>'))).toBe(
        false,
      );
      // A `.row` that is not a board row — no document on it — is just a control.
      expect(ownsActivationKeys(focus('<div class="row" role="button">x</div>'))).toBe(true);
    });

    /** Which is why the match is on the element, not on its ancestors. */
    it("leaves a quick action inside a row a control of its own", () => {
      document.body.innerHTML =
        '<div class="row" data-row-doc="doc_a" role="button" tabindex="0">' +
        '<button id="act">Review</button></div>';
      const action = document.getElementById("act");
      action?.focus();
      expect(ownsActivationKeys(action)).toBe(true);
    });

    it("takes ↵ and ⇧↵ out of the scheme, and nothing else", () => {
      const focused = { scope: "board", editing: false, controlFocused: true } as const;
      expect(resolveShortcut(key({ key: "Enter" }), focused)).toBeNull();
      expect(resolveShortcut(key({ key: "Enter", shiftKey: true }), focused)).toBeNull();

      // Keys a button does not press itself with keep acting on the board.
      for (const pressed of ["j", "k", "c", "e", "f", "r", "ArrowDown", "ArrowRight", "["]) {
        expect(resolveShortcut(key({ key: pressed }), focused), pressed).not.toBeNull();
      }
      expect(resolveShortcut(key({ key: "k", metaKey: true }), focused)?.id).toBe("search.open");
      expect(resolveShortcut(key({ key: "F10", shiftKey: true }), focused)?.id).toBe("menu.open");
    });

    it("lets the press reach the control's own default action", () => {
      const board = boardSpy();
      mount({
        openCompose: vi.fn(),
        openSearch: vi.fn(),
        toggleCheatSheet: vi.fn(),
        showNthBoard: vi.fn(),
        board,
      });
      const trigger = document.createElement("button");
      document.body.append(trigger);
      trigger.focus();

      for (const code of ["Enter", "NumpadEnter"]) {
        const event = new KeyboardEvent("keydown", { key: "Enter", code, bubbles: true });
        trigger.dispatchEvent(event);
        expect(event.defaultPrevented, code).toBe(false);
      }
      expect(board.calls).toEqual([]);
    });

    it("still opens the highlighted row when the focus is the board's own row", () => {
      const board = boardSpy();
      mount({
        openCompose: vi.fn(),
        openSearch: vi.fn(),
        toggleCheatSheet: vi.fn(),
        showNthBoard: vi.fn(),
        board,
      });
      focus('<div class="row" data-row-doc="doc_a" role="button">x</div>');

      fireEvent.keyDown(document, { key: "Enter" });
      fireEvent.keyDown(document, { key: "Enter", shiftKey: true });
      expect(board.calls).toEqual(["openRowAtCursor:path", "openRowAtCursor:fullScreen"]);
    });

    it("still opens the highlighted row when nothing focusable holds focus", () => {
      const board = boardSpy();
      mount({
        openCompose: vi.fn(),
        openSearch: vi.fn(),
        toggleCheatSheet: vi.fn(),
        showNthBoard: vi.fn(),
        board,
      });
      fireEvent.keyDown(document, { key: "Enter" });
      expect(board.calls).toEqual(["openRowAtCursor:path"]);
    });
  });

  it("leaves a key nobody claims alone", () => {
    const board = boardSpy();
    mount({
      openCompose: vi.fn(),
      openSearch: vi.fn(),
      toggleCheatSheet: vi.fn(),
      showNthBoard: vi.fn(),
      board,
    });
    fireEvent.keyDown(document, { key: "q" });
    expect(board.calls).toEqual([]);
  });
});
