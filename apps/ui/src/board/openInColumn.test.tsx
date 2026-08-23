/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { useMemo, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardNavigationProvider,
  COLUMN_FLASH_MS,
  openRequest,
  useOpenInColumn,
  useRegisterBoardNavigation,
  type BoardNavigation,
} from "./openInColumn";

afterEach(cleanup);

/*
 * `resolveColumn`, `docSubject` and `OpenSubject` — the pre-rider home-column
 * resolution — were deleted by UI-149 (SPEC.md §10, rider 3): every open lands
 * in a path, loose at the left edge unless the caller named the row it came
 * from. Where a document lands is now `strip.ts`'s contract, tested there and
 * through `Board.test.tsx`.
 */

/** UI-037: the one place a bare id and a full request are reconciled. */
describe("openRequest", () => {
  it("reads a bare id as the request it has always been", () => {
    expect(openRequest("doc_a")).toEqual({ docId: "doc_a" });
    expect(openRequest("doc_a").reveal).toBeUndefined();
  });

  it("passes a request through by reference, reveal and all", () => {
    const request = {
      docId: "doc_a",
      reveal: { kind: "item", exact: "Call the plumber" },
    } as const;
    expect(openRequest(request)).toBe(request);
  });
});

describe("the navigation seam", () => {
  it("is a no-op — never a throw — when no board is mounted", () => {
    const { result } = renderHook(() => useOpenInColumn(), {
      wrapper: ({ children }) => <BoardNavigationProvider>{children}</BoardNavigationProvider>,
    });
    expect(() => {
      result.current.open({ docId: "doc_a" });
      result.current.revealColumn("col_a");
    }).not.toThrow();
  });

  it("routes a caller's open through whatever the board registered", () => {
    const open = vi.fn();
    const revealColumn = vi.fn();

    function FakeBoard(): ReactElement {
      const handlers = useMemo<BoardNavigation>(() => ({ open, revealColumn }), []);
      useRegisterBoardNavigation(handlers);
      return <div />;
    }

    function Caller(): ReactElement {
      const board = useOpenInColumn();
      return (
        <button
          type="button"
          onClick={() => {
            board.open({ docId: "doc_a", selectTitle: true });
          }}
        >
          open
        </button>
      );
    }

    const { getByRole, unmount } = render(
      <BoardNavigationProvider>
        <FakeBoard />
        <Caller />
      </BoardNavigationProvider>,
    );

    act(() => {
      getByRole("button").click();
    });
    expect(open).toHaveBeenCalledWith({ docId: "doc_a", selectTitle: true });
    unmount();
  });

  it("keeps a stable `open` identity so a holder does not re-subscribe per render", () => {
    const { result, rerender } = renderHook(() => useOpenInColumn(), {
      wrapper: ({ children }) => <BoardNavigationProvider>{children}</BoardNavigationProvider>,
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("flashes for the prototype's 1.5 s", () => {
    expect(COLUMN_FLASH_MS).toBe(1500);
  });
});
