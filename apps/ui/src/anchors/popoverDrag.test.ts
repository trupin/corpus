import { describe, expect, it } from "vitest";
import {
  clampToViewport,
  POPOVER_DRAG_STEP,
  POPOVER_DRAG_STEP_COARSE,
  POPOVER_EDGE_MARGIN,
  stepForKey,
} from "./popoverDrag.js";

/**
 * The arithmetic behind UI-112's "it cannot be dragged off-screen". The gesture
 * itself is exercised through the popover, where a drag is a drag; this is the
 * boundary case a pointer cannot reliably reach in a test.
 */

const BOX = { width: 320, height: 200 };
const SCREEN = { width: 1024, height: 768 };

describe("keeping a dragged popover on screen", () => {
  it("leaves a position that is already inside alone", () => {
    expect(clampToViewport({ top: 120, left: 80 }, BOX, SCREEN)).toEqual({ top: 120, left: 80 });
  });

  it("stops it at the near edges", () => {
    expect(clampToViewport({ top: -400, left: -900 }, BOX, SCREEN)).toEqual({
      top: POPOVER_EDGE_MARGIN,
      left: POPOVER_EDGE_MARGIN,
    });
  });

  it("stops it at the far edges, measured against the box's own size", () => {
    expect(clampToViewport({ top: 5000, left: 5000 }, BOX, SCREEN)).toEqual({
      top: 768 - 200 - POPOVER_EDGE_MARGIN,
      left: 1024 - 320 - POPOVER_EDGE_MARGIN,
    });
  });

  /**
   * A box with no in-bounds position at all — a narrow phone, or a popover
   * grown by a long quote. Pinning the top-left keeps the quote and the grip
   * reachable; pinning the far edge would put the foot on screen and the handle
   * off it, which is the one state with no way out.
   */
  it("pins a box bigger than the viewport to its near edge rather than a negative one", () => {
    const clamped = clampToViewport({ top: 300, left: 300 }, { width: 1400, height: 900 }, SCREEN);
    expect(clamped).toEqual({ top: POPOVER_EDGE_MARGIN, left: POPOVER_EDGE_MARGIN });
  });
});

describe("the keyboard's step", () => {
  it("moves one step per arrow, in the arrow's direction", () => {
    expect(stepForKey("ArrowLeft", false)).toEqual({ top: 0, left: -POPOVER_DRAG_STEP });
    expect(stepForKey("ArrowRight", false)).toEqual({ top: 0, left: POPOVER_DRAG_STEP });
    expect(stepForKey("ArrowUp", false)).toEqual({ top: -POPOVER_DRAG_STEP, left: 0 });
    expect(stepForKey("ArrowDown", false)).toEqual({ top: POPOVER_DRAG_STEP, left: 0 });
  });

  it("crosses ground with ⇧, for getting off a paragraph rather than nudging", () => {
    expect(stepForKey("ArrowRight", true)).toEqual({ top: 0, left: POPOVER_DRAG_STEP_COARSE });
    expect(POPOVER_DRAG_STEP_COARSE).toBeGreaterThan(POPOVER_DRAG_STEP);
  });

  it("declines every other key, so the composer's own keys still reach it", () => {
    expect(stepForKey("Enter", false)).toBeNull();
    expect(stepForKey("Escape", false)).toBeNull();
    expect(stepForKey("a", false)).toBeNull();
  });
});
