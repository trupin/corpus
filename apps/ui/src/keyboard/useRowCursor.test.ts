/** @vitest-environment jsdom */
import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnRows, useRowCursor, type RowCursor } from "./useRowCursor";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Scroll spies per row, so an assertion never has to detach the method. */
const scrolls = new Map<string, ReturnType<typeof vi.fn>>();

/** A board with two columns, the first holding `docs`. */
function board(docs: readonly string[], second: readonly string[] = []): HTMLElement {
  const element = document.createElement("main");
  element.className = "board";
  element.innerHTML = `
    <section class="col" data-col="one"><div class="col-list">
      ${docs.map((id) => `<div class="row" data-row-doc="${id}"></div>`).join("")}
    </div></section>
    <section class="col" data-col="two"><div class="col-list">
      ${second.map((id) => `<div class="row" data-row-doc="${id}"></div>`).join("")}
    </div></section>`;
  document.body.append(element);
  scrolls.clear();
  for (const row of element.querySelectorAll<HTMLElement>(".row")) {
    const spy = vi.fn();
    row.scrollIntoView = spy;
    scrolls.set(row.dataset["rowDoc"] ?? "", spy);
  }
  return element;
}

function boardRef(element: HTMLElement): { readonly current: HTMLElement | null } {
  const ref = createRef<HTMLElement>();
  Object.defineProperty(ref, "current", { value: element, writable: true });
  return ref;
}

function cursorOn(
  element: HTMLElement,
  columnId: string | null = "one",
): RenderHookResult<RowCursor, unknown> {
  const ref = boardRef(element);
  return renderHook(() => useRowCursor({ board: ref, activeColumnId: columnId }));
}

describe("useRowCursor", () => {
  it("reads the painted rows of one column", () => {
    const element = board(["d1", "d2"], ["d9"]);
    expect(columnRows(element, "one").map((row) => row.dataset["rowDoc"])).toEqual(["d1", "d2"]);
    expect(columnRows(element, "missing")).toEqual([]);
    expect(columnRows(null, "one")).toEqual([]);
  });

  it("lands on the first row on the first press, whichever direction", () => {
    const { result } = cursorOn(board(["d1", "d2", "d3"]));
    expect(result.current.docId).toBeNull();
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBe("d1");
  });

  it("moves down and up — the hook sees a delta, so ↓ and j are one path", () => {
    const { result } = cursorOn(board(["d1", "d2", "d3"]));
    act(() => {
      result.current.move(1);
    });
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBe("d2");
    act(() => {
      result.current.move(-1);
    });
    expect(result.current.docId).toBe("d1");
  });

  it("clamps at both ends and never wraps", () => {
    const { result } = cursorOn(board(["d1", "d2"]));
    act(() => {
      result.current.move(1);
    });
    act(() => {
      result.current.move(-1);
    });
    expect(result.current.docId).toBe("d1");
    act(() => {
      result.current.move(1);
    });
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBe("d2");
  });

  it("scrolls the cursor into view without scrolling the board sideways", () => {
    const { result } = cursorOn(board(["d1", "d2"]));
    act(() => {
      result.current.move(1);
    });
    expect(scrolls.get("d1")).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("hands back the highlighted element, for the callers that read its dataset", () => {
    const element = board(["d1", "d2"]);
    const { result } = cursorOn(element);
    expect(result.current.element()).toBeNull();
    act(() => {
      result.current.move(1);
    });
    expect(result.current.element()?.dataset["rowDoc"]).toBe("d1");
  });

  it("does nothing when the active column has no rows, or when there is no active column", () => {
    const { result } = cursorOn(board([]));
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBeNull();

    const { result: none } = cursorOn(board(["d1"]), null);
    act(() => {
      none.current.move(1);
    });
    expect(none.current.docId).toBeNull();
  });

  it("drops the cursor when the active column changes — it belongs to one column", () => {
    const ref = boardRef(board(["d1", "d2"], ["d9"]));
    const { result, rerender } = renderHook(
      ({ columnId }) => useRowCursor({ board: ref, activeColumnId: columnId }),
      { initialProps: { columnId: "one" } },
    );
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBe("d1");

    rerender({ columnId: "two" });
    expect(result.current.docId).toBeNull();
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBe("d9");
  });

  /** TEST-152: the rows changed under the keystroke. */
  it("clamps against the rows that are there now, not the ones that were", () => {
    const element = board(["d1", "d2", "d3"]);
    const { result } = cursorOn(element);
    act(() => {
      result.current.move(1);
    });
    act(() => {
      result.current.move(1);
    });
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBe("d3");

    element.querySelector('[data-row-doc="d3"]')?.remove();
    act(() => {
      result.current.move(1);
    });
    expect(result.current.docId).toBe("d1");
  });
});
