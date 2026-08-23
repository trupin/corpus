import { describe, expect, it } from "vitest";
import { MENU_MARGIN, MENU_SIZE, clampToViewport, menuRoom } from "./menuModel";

/**
 * A menu opens at the pointer and stays on screen — the board scrolls
 * horizontally under it, so either edge is reachable (`reader/popover.ts` makes
 * the same choice for the same reason).
 */

const VIEWPORT = { width: 1200, height: 800 };

describe("clampToViewport", () => {
  it("puts the menu at the pointer when it fits", () => {
    expect(clampToViewport(400, 300, VIEWPORT)).toEqual({ left: 400, top: 300 });
  });

  it("slides it back from the right edge rather than flipping it", () => {
    const { left } = clampToViewport(1190, 300, VIEWPORT);
    expect(left).toBe(VIEWPORT.width - MENU_SIZE.width - 4);
    expect(left + MENU_SIZE.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("slides it up from the bottom edge", () => {
    const { top } = clampToViewport(400, 795, VIEWPORT);
    expect(top).toBe(VIEWPORT.height - MENU_SIZE.height - 4);
  });

  it("never leaves the top-left corner", () => {
    expect(clampToViewport(-50, -80, VIEWPORT)).toEqual({ left: 4, top: 4 });
  });

  it("keeps the near edge visible on a viewport smaller than the menu", () => {
    expect(clampToViewport(10, 10, { width: 100, height: 100 })).toEqual({ left: 4, top: 4 });
  });
});

/**
 * SHARED-061 in arithmetic: *"a bound is derived from the room, not chosen as a
 * number"*.
 *
 * These are the rule's four cases, and none of them names a ceiling. The
 * browser measurement they stand for — a real menu whose computed `max-height`
 * is the room and whose content is therefore read rather than scrolled — is
 * `e2e/menu-room-geometry.spec.ts`, and it is the one that would have caught
 * UI-145: a unit test cannot see a cascade.
 */
describe("menuRoom", () => {
  const VIEWPORT_HEIGHT = 720;

  it("gives a menu that fits every pixel between it and the foot of the window", () => {
    expect(menuRoom(157, 253, VIEWPORT_HEIGHT)).toEqual({ top: 157, maxHeight: 559 });
  });

  it("grows the ceiling when the window grows, at the same pointer", () => {
    const short = menuRoom(157, 253, 720);
    const tall = menuRoom(157, 253, 1080);
    expect(tall.maxHeight).toBeGreaterThan(short.maxHeight);
    // …and it is the difference between the windows, not some other number.
    expect(tall.maxHeight - short.maxHeight).toBe(360);
  });

  it("slides a menu up to claim its room instead of scrolling it", () => {
    const { top, maxHeight } = menuRoom(600, 351, VIEWPORT_HEIGHT);
    expect(top).toBe(VIEWPORT_HEIGHT - MENU_MARGIN - 351);
    expect(maxHeight).toBe(351);
  });

  it("takes the whole window, and only then scrolls, for content that cannot fit", () => {
    const { top, maxHeight } = menuRoom(120, 900, 260);
    expect(top).toBe(MENU_MARGIN);
    expect(maxHeight).toBe(260 - 2 * MENU_MARGIN);
  });

  it("never leaves the top edge, on a window shorter than its own margins", () => {
    expect(menuRoom(0, 40, 6)).toEqual({ top: MENU_MARGIN, maxHeight: 0 });
  });
});
