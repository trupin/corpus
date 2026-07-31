import { describe, expect, it } from "vitest";
import { MENU_SIZE, clampToViewport } from "./menuModel";

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
