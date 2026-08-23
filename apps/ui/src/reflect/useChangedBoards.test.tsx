/** @vitest-environment jsdom */
import type { DocRow } from "@corpus/contract";
import { useDocs } from "@corpus/kit";
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { toBoard, type Board } from "../board/boardDoc";
import { useColumns } from "../board/useColumns";
import { boardRow, boardTransport, viewRow, type BoardTransport } from "../testing/boardFixture";
import { useChangedBoards } from "./useChangedBoards";
import { useReflectStatus } from "./useReflectStatus";

afterEach(cleanup);

/** The fixture clock: everything below is written either side of it. */
const CLOCK = "2026-08-01T09:00:00.000Z";

const VIEW = viewRow({ id: "doc_view_inbox", title: "Inbox", query: { folder: "inbox" } });
/** A perfectly good view on a board nobody has shown — its rows are not loaded. */
const UNSEEN_VIEW = viewRow({ id: "doc_view_notes", title: "Notes", query: { folder: "notes" } });

const BOARD: Board = toBoard(boardRow({ id: "doc_board_a", columns: [VIEW.id] }));
/** A board whose column is real and whose rows this browser has never fetched. */
const UNSEEN_BOARD: Board = toBoard(boardRow({ id: "doc_board_b", columns: [UNSEEN_VIEW.id] }));
/** A board whose only column names a view document that is not there. */
const EMPTY_BOARD: Board = toBoard(boardRow({ id: "doc_board_c", columns: ["doc_view_gone"] }));

function changedRow(overrides: Partial<DocRow> = {}): DocRow {
  return docRowFixture({ id: "doc_new", updated: "2026-08-02T09:00:00.000Z", ...overrides });
}

/**
 * Loads what a board on screen loads: its columns, and the first one's rows —
 * through the very code the board uses, so the cache key this fills is the key
 * `useChangedBoards` has to find. A probe that primed the cache by calling
 * `docsListKey` itself would agree with the hook by construction and prove
 * nothing about either agreeing with the *column*.
 */
function Primer({ board }: { readonly board: Board }): null {
  const columns = useColumns(board, [board]);
  useDocs(columns.columns[0]?.filter ?? {});
  useReflectStatus();
  return null;
}

/** What the board bar does with the answer: one dot per marked tab. */
function Marks({ boards }: { readonly boards: readonly Board[] }): ReactElement {
  const marked = useChangedBoards(boards);
  return (
    <ul>
      {boards.map((board) => (
        <li
          key={board.id}
          data-board={board.id}
          data-marked={marked.has(board.id) ? "" : undefined}
        >
          {board.title}
        </li>
      ))}
    </ul>
  );
}

const isMarked = (boardId: string): boolean =>
  document.querySelector(`li[data-board="${boardId}"]`)?.hasAttribute("data-marked") === true;

/**
 * A harness with the **production** freshness defaults (`staleTime: Infinity`),
 * because that is what the request-count assertion is about: mounting a second
 * observer on a query the board already holds must issue nothing, and the kit's
 * own `QueryClient` is what makes that true (`createCorpusQueryClient`).
 *
 * One provider for the whole test, so the priming render and the reading render
 * genuinely share a cache — two providers share a `QueryClient` and nothing
 * else, and the warning they print is the application telling the truth.
 */
function harnessFor(fetch: typeof globalThis.fetch) {
  return createCorpusTestHarness({
    fetch,
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
        mutations: { retry: false },
      },
    }),
  });
}

/** Mounts the primer, waits for the board's two reads to land, and returns the wire. */
async function primed(options: Parameters<typeof boardTransport>[0]): Promise<{
  readonly wire: BoardTransport;
  readonly show: (boards: readonly Board[]) => void;
}> {
  const wire = boardTransport(options);
  const harness = harnessFor(wire.fetch);
  const view = render(<Primer board={BOARD} />, { wrapper: harness.Wrapper });
  await waitFor(() => {
    expect(wire.calls.some((call) => call.path === "/api/workspace/reflect")).toBe(true);
    expect(wire.calls.some((call) => call.search.includes("folder=inbox"))).toBe(true);
  });
  return {
    wire,
    show: (boards) => {
      view.rerender(
        <>
          <Primer board={BOARD} />
          <Marks boards={boards} />
        </>,
      );
    },
  };
}

describe("useChangedBoards", () => {
  it("marks a board holding a document changed since the clock", async () => {
    const { show } = await primed({
      views: [VIEW, UNSEEN_VIEW],
      defaultRows: [changedRow()],
      reflect: { reflected: CLOCK },
    });
    show([BOARD]);
    await waitFor(() => {
      expect(isMarked(BOARD.id)).toBe(true);
    });
  });

  /**
   * SPEC.md §7's amendment: the agent's own writes are its output, not new work
   * for it — so the digest thread a reflection posts never lights the tab that
   * holds it.
   */
  it("does not mark a board whose only recent write is the agent's", async () => {
    const { show } = await primed({
      views: [VIEW, UNSEEN_VIEW],
      defaultRows: [changedRow({ lastActor: "agent" })],
      reflect: { reflected: CLOCK },
    });
    show([BOARD]);
    await waitFor(() => {
      expect(document.querySelector("li[data-board]")).not.toBeNull();
    });
    expect(isMarked(BOARD.id)).toBe(false);
  });

  /**
   * A clock of `null` on the wire means "never reflected", under which
   * everything counts — but a clock this browser has not read yet means nothing
   * at all, and lighting every tab for one round trip is the failure that
   * distinction exists to prevent.
   */
  it("claims nothing before the status has arrived", async () => {
    const wire = boardTransport({
      views: [VIEW],
      defaultRows: [changedRow()],
      reflect: { reflected: CLOCK },
    });
    /*
     * The clock never answers, and everything else does. That is the state the
     * distinction is about, and it is the only one that can catch a
     * `?? null` in the hook: with the rows loaded and no status, every row is
     * newer than a clock of `null`, so a flattened implementation lights the
     * tab and this goes red.
     */
    const hangingClock: typeof globalThis.fetch = (input, init) => {
      const url = new URL(new Request(input, init).url);
      if (url.pathname === "/api/workspace/reflect") return new Promise<Response>(() => undefined);
      return wire.fetch(input, init);
    };
    const harness = harnessFor(hangingClock);
    const view = render(<Primer board={BOARD} />, { wrapper: harness.Wrapper });
    await waitFor(() => {
      expect(wire.calls.some((call) => call.search.includes("folder=inbox"))).toBe(true);
    });

    view.rerender(
      <>
        <Primer board={BOARD} />
        <Marks boards={[BOARD]} />
      </>,
    );
    await waitFor(() => {
      expect(document.querySelector("li[data-board]")).not.toBeNull();
    });
    expect(isMarked(BOARD.id)).toBe(false);
  });

  /**
   * The honest gap. Two shapes of it, because they take different branches: a
   * board whose column resolves to no view document at all, and a board whose
   * column is perfectly good and whose rows this browser has simply never
   * fetched. Neither is marked, and neither is asked about.
   */
  it("says nothing about a board whose columns were never loaded", async () => {
    const { show } = await primed({
      views: [VIEW, UNSEEN_VIEW],
      defaultRows: [changedRow()],
      reflect: { reflected: CLOCK },
    });
    show([BOARD, UNSEEN_BOARD, EMPTY_BOARD]);
    await waitFor(() => {
      expect(isMarked(BOARD.id)).toBe(true);
    });
    expect(isMarked(UNSEEN_BOARD.id)).toBe(false);
    expect(isMarked(EMPTY_BOARD.id)).toBe(false);
  });

  /**
   * The constraint the issue states outright: the tab dot is "derived from the
   * rows already loaded, **never an extra request**".
   *
   * `UNSEEN_BOARD` is what makes this falsifiable. A board whose rows are
   * already cached would stay silent under a fetching implementation too — the
   * kit caches with `staleTime: Infinity`, so an *enabled* observer on a fresh
   * entry issues nothing either. A column nobody has loaded is the only case
   * where "reads the cache" and "fetches what it needs" part company, and this
   * asserts the wire directly rather than only the call count.
   */
  it("issues no request of its own, not even for a board it cannot answer for", async () => {
    const { wire, show } = await primed({
      views: [VIEW, UNSEEN_VIEW],
      defaultRows: [changedRow()],
      reflect: { reflected: CLOCK },
    });
    const before = wire.calls.length;
    show([BOARD, UNSEEN_BOARD]);
    await waitFor(() => {
      expect(isMarked(BOARD.id)).toBe(true);
    });
    expect(wire.calls.filter((call) => call.search.includes("folder=notes"))).toEqual([]);
    expect(wire.calls.length).toBe(before);
  });
});
