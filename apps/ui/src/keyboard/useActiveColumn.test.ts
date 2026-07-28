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
