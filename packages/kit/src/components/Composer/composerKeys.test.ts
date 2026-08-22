import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { handleComposerKeyDown } from "./composerKeys.js";

interface PressOptions {
  readonly key?: string;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly isComposing?: boolean;
}

interface Press {
  readonly event: KeyboardEvent;
  readonly prevented: () => boolean;
  readonly stopped: () => boolean;
}

/**
 * A `keydown` as the contract reads it. The whole surface it touches is five
 * booleans and two methods, so the double is the honest shape — mounting a
 * component to press a key would test the component, not the contract.
 */
function press({
  key = "Enter",
  shiftKey = false,
  metaKey = false,
  ctrlKey = false,
  isComposing = false,
}: PressOptions = {}): Press {
  let prevented = false;
  let stopped = false;
  const event = {
    key,
    shiftKey,
    metaKey,
    ctrlKey,
    nativeEvent: { isComposing },
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
  } as unknown as KeyboardEvent;
  return { event, prevented: () => prevented, stopped: () => stopped };
}

describe("the composer key contract (SPEC.md §10)", () => {
  it("leaves ↵ to the text: not consumed, not prevented, nothing submitted", () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const shot = press();
    expect(handleComposerKeyDown(shot.event, { onPrimary, onSecondary })).toBe(false);
    expect(shot.prevented()).toBe(false);
    expect(onPrimary).not.toHaveBeenCalled();
    expect(onSecondary).not.toHaveBeenCalled();
  });

  /** `⇧↵` was the newline under the old spec; it stays one under the new one. */
  it("leaves ⇧↵ to the text too", () => {
    const onPrimary = vi.fn();
    const shot = press({ shiftKey: true });
    expect(handleComposerKeyDown(shot.event, { onPrimary })).toBe(false);
    expect(shot.prevented()).toBe(false);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it.each<[string, PressOptions]>([
    ["⌘↵", { metaKey: true }],
    ["Ctrl+↵", { ctrlKey: true }],
  ])("submits the primary action on %s", (_name, modifier) => {
    const onPrimary = vi.fn();
    const shot = press(modifier);
    expect(handleComposerKeyDown(shot.event, { onPrimary })).toBe(true);
    expect(shot.prevented()).toBe(true);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("submits the secondary action on ⇧⌘↵, never the primary one", () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const shot = press({ metaKey: true, shiftKey: true });
    expect(handleComposerKeyDown(shot.event, { onPrimary, onSecondary })).toBe(true);
    expect(shot.prevented()).toBe(true);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  /** No composer invents a secondary action; ⇧⌘↵ in one is simply not a chord. */
  it("does nothing on ⇧⌘↵ where the composer has one submit", () => {
    const onPrimary = vi.fn();
    const shot = press({ metaKey: true, shiftKey: true });
    expect(handleComposerKeyDown(shot.event, { onPrimary })).toBe(false);
    expect(shot.prevented()).toBe(false);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it.each<[string, PressOptions]>([
    ["a bare commit", { isComposing: true }],
    ["one held with ⌘", { isComposing: true, metaKey: true }],
    ["one held with ⇧⌘", { isComposing: true, metaKey: true, shiftKey: true }],
  ])("never submits on an IME composition commit — %s", (_name, options) => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const claim = vi.fn(() => true);
    const shot = press(options);
    expect(handleComposerKeyDown(shot.event, { onPrimary, onSecondary, claim })).toBe(false);
    expect(shot.prevented()).toBe(false);
    expect(onPrimary).not.toHaveBeenCalled();
    expect(onSecondary).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("closes on esc where the composer has a close, and stops the press there", () => {
    const onEscape = vi.fn();
    const shot = press({ key: "Escape" });
    expect(handleComposerKeyDown(shot.event, { onPrimary: vi.fn(), onEscape })).toBe(true);
    expect(shot.prevented()).toBe(true);
    expect(shot.stopped()).toBe(true);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("leaves esc to the escape chain where the composer declares no close", () => {
    const shot = press({ key: "Escape" });
    expect(handleComposerKeyDown(shot.event, { onPrimary: vi.fn() })).toBe(false);
    expect(shot.prevented()).toBe(false);
    expect(shot.stopped()).toBe(false);
  });

  it("ignores every other key", () => {
    const onPrimary = vi.fn();
    const shot = press({ key: "a", metaKey: true });
    expect(handleComposerKeyDown(shot.event, { onPrimary })).toBe(false);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  describe("with an autocomplete menu open", () => {
    it("gives the menu ↵ before the contract sees it", () => {
      const onPrimary = vi.fn();
      const claim = vi.fn(() => true);
      const shot = press();
      expect(handleComposerKeyDown(shot.event, { onPrimary, claim })).toBe(true);
      expect(claim).toHaveBeenCalledWith(shot.event);
      expect(onPrimary).not.toHaveBeenCalled();
    });

    /** Dismissal is the menu's; once it stops claiming, `↵` is a newline again. */
    it("restores ↵ to the text as soon as the menu stops claiming it", () => {
      const onPrimary = vi.fn();
      const claim = vi.fn(() => false);
      const shot = press();
      expect(handleComposerKeyDown(shot.event, { onPrimary, claim })).toBe(false);
      expect(shot.prevented()).toBe(false);
      expect(onPrimary).not.toHaveBeenCalled();
    });

    /** ⌘↵ is not a menu key, so a claimless menu must not swallow a submit. */
    it("still submits on ⌘↵ when the menu declines the key", () => {
      const onPrimary = vi.fn();
      const shot = press({ metaKey: true });
      expect(handleComposerKeyDown(shot.event, { onPrimary, claim: () => false })).toBe(true);
      expect(onPrimary).toHaveBeenCalledTimes(1);
    });
  });
});
