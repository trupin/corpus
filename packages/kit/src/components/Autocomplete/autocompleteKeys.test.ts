import { describe, expect, it, vi } from "vitest";
import {
  handleAutocompleteKeyDown,
  type AutocompleteKeyEvent,
  type AutocompleteKeyOptions,
} from "./autocompleteKeys.js";

/**
 * The contract, tested where it lives rather than three times over in three
 * hosts — which is the point of it living somewhere (UI-053).
 */

interface Press {
  readonly event: AutocompleteKeyEvent;
  readonly prevented: () => boolean;
  readonly stopped: () => boolean;
}

type Modifiers = Partial<Pick<AutocompleteKeyEvent, "shiftKey" | "metaKey" | "ctrlKey" | "altKey">>;

function press(key: string, modifiers: Modifiers = {}): Press {
  let prevented = false;
  let stopped = false;
  return {
    event: {
      key,
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...modifiers,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    },
    prevented: () => prevented,
    stopped: () => stopped,
  };
}

function options(overrides: Partial<AutocompleteKeyOptions> = {}): AutocompleteKeyOptions {
  return {
    isOpen: true,
    count: 3,
    activeIndex: 0,
    setActiveIndex: vi.fn(),
    accept: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

describe("handleAutocompleteKeyDown", () => {
  it("leaves every key to the host while no menu is open", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"]) {
      const keypress = press(key);
      const opts = options({ isOpen: false });
      expect(handleAutocompleteKeyDown(keypress.event, opts)).toBe(false);
      expect(keypress.prevented()).toBe(false);
      expect(opts.accept).not.toHaveBeenCalled();
      expect(opts.dismiss).not.toHaveBeenCalled();
    }
  });

  // SPEC.md §11: "arrows move the highlight (wrapping at both ends)".
  it.each([
    ["ArrowDown", 0, 3, 1],
    ["ArrowDown", 2, 3, 0],
    ["ArrowUp", 0, 3, 2],
    ["ArrowUp", 1, 3, 0],
    ["ArrowDown", 0, 1, 0],
    ["ArrowUp", 0, 1, 0],
  ])("%s from %i of %i highlights %i", (key, activeIndex, count, expected) => {
    const keypress = press(key);
    const opts = options({ activeIndex, count });
    expect(handleAutocompleteKeyDown(keypress.event, opts)).toBe(true);
    expect(keypress.prevented()).toBe(true);
    expect(opts.setActiveIndex).toHaveBeenCalledWith(expected);
  });

  // The user report this issue exists for: "I want to be able to select one
  // with tab."
  it.each(["Tab", "Enter"])("%s accepts the highlighted item", (key) => {
    const keypress = press(key);
    const opts = options();
    expect(handleAutocompleteKeyDown(keypress.event, opts)).toBe(true);
    expect(opts.accept).toHaveBeenCalledTimes(1);
    // The half that keeps focus in the field, and the half that keeps `↵` from
    // also inserting the newline UI-052 gave it.
    expect(keypress.prevented()).toBe(true);
  });

  it("hands ↵ back when the host says the menu has not earned it", () => {
    const keypress = press("Enter");
    const opts = options({ enterAccepts: false });
    expect(handleAutocompleteKeyDown(keypress.event, opts)).toBe(false);
    expect(keypress.prevented()).toBe(false);
    expect(opts.accept).not.toHaveBeenCalled();
  });

  it("still accepts on ⇥ when ↵ is the host's", () => {
    const keypress = press("Tab");
    const opts = options({ enterAccepts: false });
    expect(handleAutocompleteKeyDown(keypress.event, opts)).toBe(true);
    expect(opts.accept).toHaveBeenCalledTimes(1);
  });

  it("keeps ⇥ in the field with nothing to accept, and lets ↵ be a newline", () => {
    const tab = press("Tab");
    const tabOptions = options({ count: 0 });
    expect(handleAutocompleteKeyDown(tab.event, tabOptions)).toBe(true);
    expect(tab.prevented()).toBe(true);
    expect(tabOptions.accept).not.toHaveBeenCalled();

    const enter = press("Enter");
    const enterOptions = options({ count: 0 });
    expect(handleAutocompleteKeyDown(enter.event, enterOptions)).toBe(false);
    expect(enter.prevented()).toBe(false);
    expect(enterOptions.accept).not.toHaveBeenCalled();
  });

  it("dismisses on esc and stops the layer underneath acting on the same press", () => {
    const keypress = press("Escape");
    const opts = options();
    expect(handleAutocompleteKeyDown(keypress.event, opts)).toBe(true);
    expect(opts.dismiss).toHaveBeenCalledTimes(1);
    expect(keypress.prevented()).toBe(true);
    expect(keypress.stopped()).toBe(true);
  });

  /**
   * PR #20 review, MINOR: an open menu answered *any* `Enter`, so the composer's
   * primary action (SPEC.md §11: "the primary action is always `⌘↵`") accepted a
   * completion instead of asking — and `⇧⇥`, the browser's reverse-focus key,
   * accepted one instead of moving focus back.
   */
  it.each([
    ["⌘↵", "Enter", { metaKey: true }],
    ["Ctrl+↵", "Enter", { ctrlKey: true }],
    ["⇧⌘↵", "Enter", { metaKey: true, shiftKey: true }],
    ["⇧↵", "Enter", { shiftKey: true }],
    ["⌥↵", "Enter", { altKey: true }],
    ["⇧⇥", "Tab", { shiftKey: true }],
    ["⌘⇥", "Tab", { metaKey: true }],
    ["⇧↓", "ArrowDown", { shiftKey: true }],
    ["⌘↑", "ArrowUp", { metaKey: true }],
  ])("hands %s back to the host, menu open or not", (_name, key, modifiers) => {
    const keypress = press(key, modifiers);
    const opts = options();
    expect(handleAutocompleteKeyDown(keypress.event, opts)).toBe(false);
    expect(keypress.prevented()).toBe(false);
    expect(keypress.stopped()).toBe(false);
    expect(opts.accept).not.toHaveBeenCalled();
    expect(opts.setActiveIndex).not.toHaveBeenCalled();
    expect(opts.dismiss).not.toHaveBeenCalled();
  });

  it("claims nothing else", () => {
    for (const key of ["a", " ", "Backspace", "ArrowLeft", "ArrowRight", "Home"]) {
      const keypress = press(key);
      expect(handleAutocompleteKeyDown(keypress.event, options())).toBe(false);
      expect(keypress.prevented()).toBe(false);
    }
  });
});
