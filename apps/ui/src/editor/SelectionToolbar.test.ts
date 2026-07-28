import { describe, expect, it } from "vitest";
import { selectionPlacement } from "./SelectionToolbar.js";

/**
 * Where the pill lands.
 *
 * Centred over the selection and 44px above it — the prototype's block — and
 * never off the edge of the viewport, which is the case a selection at the top
 * or the far right of a column produces every time.
 */

describe("placement", () => {
  it("centres the pill over the selection, 44px above it", () => {
    expect(selectionPlacement({ top: 300, left: 400, width: 100 }, 170, 1200)).toEqual({
      top: 256,
      left: 365,
    });
  });

  it("keeps the pill below the top edge", () => {
    // A selection in the first line: 44px above it is off-screen.
    expect(selectionPlacement({ top: 10, left: 400, width: 100 }, 170, 1200).top).toBe(8);
  });

  it("keeps the pill inside the left edge", () => {
    expect(selectionPlacement({ top: 300, left: 0, width: 20 }, 170, 1200).left).toBe(8);
  });

  it("keeps the pill inside the right edge", () => {
    expect(selectionPlacement({ top: 300, left: 1150, width: 40 }, 170, 1200).left).toBe(1022);
  });

  it("degrades sanely in a viewport narrower than the pill", () => {
    const { left } = selectionPlacement({ top: 300, left: 20, width: 40 }, 170, 100);
    expect(left).toBe(8);
  });
});
