/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useActiveColumn } from "./useActiveColumn";

const columns = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("useActiveColumn", () => {
  it("starts on the first column, so the keyboard always has somewhere to be", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    expect(result.current.id).toBe("a");
    expect(result.current.index).toBe(0);
  });

  it("has no active column only when the board has none", () => {
    const { result } = renderHook(() => useActiveColumn([]));
    expect(result.current.id).toBeNull();
    expect(result.current.switchBy(1)).toBeNull();
  });

  it("follows hover, focus or a click through `activate`", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.activate("c");
    });
    expect(result.current.id).toBe("c");
    expect(result.current.index).toBe(2);
  });

  it("switches one column at a time and reports where it landed", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    let landed: string | null = null;
    act(() => {
      landed = result.current.switchBy(1);
    });
    expect(landed).toBe("b");
    expect(result.current.id).toBe("b");
  });

  it("clamps at both ends — a board is a strip, not a carousel", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      expect(result.current.switchBy(-1)).toBeNull();
    });
    expect(result.current.id).toBe("a");

    act(() => {
      result.current.activate("c");
    });
    act(() => {
      expect(result.current.switchBy(1)).toBeNull();
    });
    expect(result.current.id).toBe("c");
  });

  it("keeps a keyboard-pinned column against a stationary pointer, and yields when it moves", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.pin("b");
    });
    // A re-render under a still cursor fires `mouseover`, not `mousemove`.
    act(() => {
      result.current.activate("a");
    });
    expect(result.current.id).toBe("b");

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove"));
    });
    act(() => {
      result.current.activate("a");
    });
    expect(result.current.id).toBe("a");
  });

  /**
   * UI-031. Closing full screen is a programmatic act whose pointer never
   * moved: the overlay unmounts, whatever column is under the resting cursor
   * fires `mouseover`, and without the latch the board adopts it.
   */
  it("holds the active column against a stationary pointer without moving it", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.activate("b");
    });

    act(() => {
      result.current.hold();
    });
    // Held, not moved: `hold` is `pin` without the argument.
    expect(result.current.id).toBe("b");

    act(() => {
      result.current.activate("c");
    });
    expect(result.current.id).toBe("b");
  });

  it("releases the hold on the very first real movement, with no second move needed", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.hold();
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove"));
    });
    act(() => {
      result.current.activate("c");
    });
    expect(result.current.id).toBe("c");
  });

  /**
   * UI-033 — **the event order a real pointer produces, and the phase it forces.**
   *
   * A movement's boundary events are dispatched **before** its `mousemove`, so
   * the first real movement after `hold()` has its `mouseover` evaluated while
   * the latch is still armed. That activation is dropped, and the `mousemove`
   * that disarms the latch carries none of its own — which is why `Column`
   * activates on `mousemove` as well. This is the first half of it: with the
   * events in the order the browser sends them, the boundary event alone leaves
   * the column inactive.
   */
  it("drops the boundary event that arrives before the movement, as the browser sends it", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.hold();
    });

    // `mouseover` first, which is what Chromium does.
    act(() => {
      result.current.activate("c");
    });
    expect(result.current.id).toBe("a");

    // Then the movement itself: the latch goes, and the column that also
    // activates on `mousemove` gets the board.
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      result.current.activate("c");
    });
    expect(result.current.id).toBe("c");
  });

  /**
   * The second half, and the one only a browser found: **the release has to be
   * in the capture phase.**
   *
   * React 18 attaches its handlers at the root container, which sits inside
   * `document`'s bubble path — so a bubble-phase release on `document` runs
   * *after* the column's own `onMouseMove`, which would therefore still see the
   * latch armed and drop the very activation it was added to carry. The listener
   * below stands in for React's root: it is attached to a container element in
   * the bubble phase and calls `activate`, exactly as `Column` does.
   *
   * Falsify by taking `{ capture: true }` off the hook's listener — the
   * container's handler then runs first, the latch is still armed, and the
   * column stays inactive.
   */
  it("releases before React's own handlers, not after them", () => {
    const root = document.createElement("div");
    const inner = document.createElement("div");
    root.append(inner);
    document.body.append(root);

    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.hold();
    });

    const onMove = (): void => {
      result.current.activate("c");
    };
    root.addEventListener("mousemove", onMove);
    act(() => {
      inner.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
    root.removeEventListener("mousemove", onMove);
    root.remove();

    expect(result.current.id).toBe("c");
  });

  /**
   * UI-033 asked for `pin()` to be **decided explicitly**, so: it keeps the same
   * latch and gets the same release, on the first real movement.
   *
   * The alternative — a pin that outlives a movement — was rejected. The latch
   * exists to stop a *forged* hover taking the board: a re-order or an unmount
   * changes what is under a stationary cursor and Chromium emits `mouseover`
   * with no `mousemove` beside it. A hand that actually moves is not a forgery,
   * and §10 says the active column follows hover. Making `⇧←`/`⇧→` sticky
   * against real movement would be a second rule, unwritten, that a person would
   * discover by finding hover stop working after an arrow press.
   */
  it("hands a pinned column over on the first movement, exactly as `hold` does", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.pin("b");
    });
    // The boundary event of that same movement, still dropped.
    act(() => {
      result.current.activate("c");
    });
    expect(result.current.id).toBe("b");

    // The movement itself — one, not two.
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      result.current.activate("c");
    });
    expect(result.current.id).toBe("c");
  });

  it("pins through `switchBy` too — an arrow press is the keyboard's authority", () => {
    const { result } = renderHook(() => useActiveColumn(columns));
    act(() => {
      result.current.switchBy(1);
    });
    act(() => {
      result.current.activate("c");
    });
    expect(result.current.id).toBe("b");
  });

  /** TEST-152: an SSE frame unpinned the active column between two keystrokes. */
  it("falls back to a valid column when the active one disappears", () => {
    const { result, rerender } = renderHook(({ set }) => useActiveColumn(set), {
      initialProps: { set: columns },
    });
    act(() => {
      result.current.activate("c");
    });
    expect(result.current.id).toBe("c");

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove"));
    });
    rerender({ set: [{ id: "a" }, { id: "b" }] });
    expect(result.current.id).toBe("a");
    expect(result.current.index).toBe(0);
    act(() => {
      expect(result.current.switchBy(1)).toBe("b");
    });
  });
});
