/** @vitest-environment jsdom */
import { docRowFixture } from "@corpus/kit/testing";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { useMemo, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardNavigationProvider,
  COLUMN_FLASH_MS,
  docSubject,
  openRequest,
  resolveColumn,
  useOpenInColumn,
  useRegisterBoardNavigation,
  type BoardNavigation,
  type OpenSubject,
} from "./openInColumn";
import { toBoardColumn, type BoardColumn } from "./viewDoc";

afterEach(cleanup);

/** A column built the way the board builds one: a view document a board lists. */
function column(id: string, query: Record<string, string>, title = id): BoardColumn {
  return toBoardColumn(
    id,
    docRowFixture({ id, title, type: "view", query, path: "data/docs/views/v.md" }),
  );
}

const subject = (overrides: Partial<OpenSubject> = {}): OpenSubject => ({
  folder: "finance/housing",
  type: "note",
  status: "open",
  ...overrides,
});

describe("docSubject", () => {
  it("reads a document's placement off the row the search already returned", () => {
    expect(
      docSubject({ path: "data/docs/finance/housing/m.md", type: "note", status: "open" }),
    ).toEqual({ folder: "finance/housing", type: "note", status: "open" });
  });

  it("calls a document at the docs root folderless rather than empty-stringed", () => {
    expect(docSubject({ path: "data/docs/m.md", type: "note", status: "open" }).folder).toBeNull();
  });

  it("gives a thread file no folder — `data/threads/` is storage, not placement", () => {
    expect(
      docSubject({ path: "data/threads/th_a.md", type: "thread", status: "open" }).folder,
    ).toBeNull();
  });
});

describe("resolveColumn", () => {
  it("prefers a folder column, most specific first", () => {
    const columns = [
      column("col_all", { type: "note" }),
      column("col_finance", { folder: "finance" }),
      column("col_housing", { folder: "finance/housing" }),
    ];
    expect(resolveColumn(columns, subject())).toBe("col_housing");
  });

  it("matches a folder's descendants but not a folder that merely starts the same", () => {
    expect(resolveColumn([column("col_fin", { folder: "finance" })], subject())).toBe("col_fin");
    expect(resolveColumn([column("col_fin", { folder: "fin" })], subject())).toBe("col_fin");
    // `financial` is a different folder, so this falls through to the fallback.
    const columns = [
      column("col_first", { type: "view" }),
      column("col_x", { folder: "financial" }),
    ];
    expect(resolveColumn(columns, subject())).toBe("col_first");
  });

  it("falls back to a type/status column when no folder column contains it", () => {
    const columns = [
      column("col_views", { type: "view" }),
      column("col_open", { status: "open" }),
      column("col_notes", { type: "note" }),
    ];
    expect(resolveColumn(columns, subject({ folder: null }))).toBe("col_notes");
  });

  it("prefers a column matching both type and status over one matching either", () => {
    const columns = [
      column("col_open", { status: "open" }),
      column("col_both", { type: "note", status: "open" }),
    ];
    expect(resolveColumn(columns, subject({ folder: null }))).toBe("col_both");
  });

  it("never opens a document in a column whose filter it contradicts", () => {
    const columns = [column("col_threads", { type: "thread" }), column("col_any", {})];
    expect(resolveColumn(columns, subject({ folder: null }))).toBe("col_any");
  });

  it("falls back to the first column when the home column was archived away", () => {
    const columns = [
      column("col_first", { type: "thread" }),
      column("col_second", { folder: "x" }),
    ];
    expect(resolveColumn(columns, subject())).toBe("col_first");
  });

  it("opens in the first column when the caller knows nothing about the document", () => {
    const columns = [column("col_first", {}), column("col_second", {})];
    expect(resolveColumn(columns, null)).toBe("col_first");
  });

  it("resolves nothing on a board with no columns", () => {
    expect(resolveColumn([], subject())).toBeNull();
    expect(resolveColumn([], null)).toBeNull();
  });
});

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
