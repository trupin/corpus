import { describe, expect, it } from "vitest";
import {
  clampToRect,
  clampToViewport,
  placeInRoom,
  POPOVER_DRAG_STEP,
  POPOVER_DRAG_STEP_COARSE,
  POPOVER_EDGE_MARGIN,
  stepForKey,
  type PopoverRect,
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

/**
 * UI-159's arithmetic: **which side of the words the box opens on, and against
 * what.**
 *
 * Every number below is an input rather than a threshold. That is the point of
 * the issue: the same defect had been fixed twice with a constant that was true
 * of the layout on the day it was measured, and a third band of chrome — the
 * board bar and the column strip together — made both constants wrong.
 */
describe("placing a popover in the room its chrome leaves", () => {
  /** The board's band on a 1024×768 screen with 100px of chrome above and 60 below. */
  const ROOM: PopoverRect = { top: 100, left: 0, right: 1024, bottom: 708 };

  it("opens under the words when the room under them is the larger part", () => {
    // 400 under (708 − 8 − 300) against 188 over (288 − 8 − 100).
    const at = placeInRoom({ below: 300, above: 288, left: 120 }, BOX, ROOM, SCREEN);
    expect(at).toEqual({ top: 300, left: 120 });
  });

  it("opens over the words when the room over them is the larger part", () => {
    // The same box 300px further down: 100 under, 388 over.
    const at = placeInRoom({ below: 600, above: 588, left: 120 }, BOX, ROOM, SCREEN);
    expect(at).toEqual({ top: 588 - BOX.height, left: 120 });
  });

  /**
   * The regression, as arithmetic. A band of chrome added above the board moves
   * the words down and takes the room off one side; nothing here is told about
   * the band, and the answer changes anyway.
   */
  it("follows a band of chrome added above the board, with no number of its own", () => {
    const words = { below: 470, above: 458, left: 120 };
    const before = placeInRoom(words, BOX, ROOM, SCREEN);
    // 230 under against 350 over — over, already.
    expect(before.top).toBe(458 - BOX.height);

    // 84px of new chrome: the room starts lower and the words sit lower with it.
    const after = placeInRoom(
      { below: words.below + 84, above: words.above + 84, left: 120 },
      BOX,
      { ...ROOM, top: ROOM.top + 84 },
      SCREEN,
    );
    expect(after.top).toBe(458 + 84 - BOX.height);
    // And the foot of the box is inside the room either way, which is the claim.
    expect(before.top + BOX.height).toBeLessThanOrEqual(ROOM.bottom - POPOVER_EDGE_MARGIN);
    expect(after.top + BOX.height).toBeLessThanOrEqual(ROOM.bottom - POPOVER_EDGE_MARGIN);
  });

  it("keeps the box inside the room on the side it took", () => {
    // Words at the very foot of the room: the larger side is over them, and the
    // box would still start above the room's top, so it is pinned to it.
    const at = placeInRoom({ below: 700, above: 130, left: 120 }, BOX, ROOM, SCREEN);
    expect(at.top).toBe(ROOM.top + POPOVER_EDGE_MARGIN);
  });

  /**
   * **The screen has the last word.** A room too short for the box cannot hold
   * it, and §10 would rather the box overflow its room than put its Send button
   * where no pointer can reach it.
   */
  it("keeps a box taller than its room on the screen", () => {
    const cramped: PopoverRect = { top: 600, left: 0, right: 1024, bottom: 700 };
    const at = placeInRoom({ below: 660, above: 648, left: 120 }, BOX, cramped, SCREEN);
    expect(at.top + BOX.height).toBeLessThanOrEqual(SCREEN.height - POPOVER_EDGE_MARGIN);
  });

  it("clamps into a rectangle that is not the screen", () => {
    expect(clampToRect({ top: 0, left: 0 }, BOX, ROOM)).toEqual({
      top: ROOM.top + POPOVER_EDGE_MARGIN,
      left: POPOVER_EDGE_MARGIN,
    });
    expect(clampToRect({ top: 5000, left: 0 }, BOX, ROOM)).toEqual({
      top: ROOM.bottom - BOX.height - POPOVER_EDGE_MARGIN,
      left: POPOVER_EDGE_MARGIN,
    });
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
