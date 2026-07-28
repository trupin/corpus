import { describe, expect, it } from "vitest";
import { POPOVER_MARGIN, popoverShift } from "./popover";

describe("popoverShift", () => {
  it("leaves a popover that already fits exactly where it is", () => {
    expect(popoverShift({ left: 400, right: 700 }, 1200)).toBe(0);
  });

  it("slides a popover hanging off the right edge back inside", () => {
    // A column at the right edge of a horizontally scrolled board.
    expect(popoverShift({ left: 1000, right: 1300 }, 1200)).toBe(1300 - (1200 - POPOVER_MARGIN));
  });

  it("never pushes the left edge out of view to rescue the right one", () => {
    // 700px wide in a 600px viewport: clipped on the right, readable from the
    // start, which is the better of two bad options.
    expect(popoverShift({ left: 20, right: 720 }, 600)).toBe(12);
  });

  it("respects a custom margin", () => {
    expect(popoverShift({ left: 500, right: 1000 }, 1000, 40)).toBe(40);
  });

  it("slides a popover hanging off the left edge back inside", () => {
    // The board scrolls under the anchor, so either edge can be the near one.
    expect(popoverShift({ left: -15, right: 285 }, 900)).toBe(-(POPOVER_MARGIN + 15));
  });

  it("never pushes the right edge out of view to rescue the left one", () => {
    expect(popoverShift({ left: -50, right: 590 }, 600)).toBe(-2);
  });
});
