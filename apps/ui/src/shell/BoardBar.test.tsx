/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { boardRow, boardTransport, type BoardTransport } from "../testing/boardFixture";
import { createBoardHarness } from "../testing/boardHarness";
import { memoryStorage } from "../testing/memoryStorage";
import { BoardBar, NO_BOARDS_LABEL } from "./BoardBar";

/**
 * The board bar, through the real provider (SPEC.md §10, rider 2).
 *
 * Every assertion here is about a **document**: which boards the bar draws comes
 * from `type: board` rows, and every act it offers is one write to one of them.
 * Nothing about the bar is layout state the app holds.
 */

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BOARDS = [
  boardRow({ id: "b_attention", title: "Attention", order: 1, columns: ["doc_v1"] }),
  boardRow({ id: "b_status", title: "Notes by status", order: 2, columns: null }),
  boardRow({ id: "b_files", title: "Files", order: 3, columns: [], defaultOpen: true }),
];

function renderBar(wire: BoardTransport): ReturnType<typeof render> {
  const harness = createBoardHarness(wire.fetch);
  function Wrapper({ children }: { readonly children?: ReactNode }): ReactElement {
    return (
      <harness.Wrapper>
        <ContextMenuProvider>{children}</ContextMenuProvider>
      </harness.Wrapper>
    );
  }
  return render(<BoardBar />, { wrapper: Wrapper });
}

/**
 * jsdom implements no `DragEvent`, so `fireEvent.dragOver` falls back to a plain
 * `Event` and drops `clientX` — the one property the drop-side arithmetic reads.
 * A `MouseEvent` carries it, and React reads it off the native event either way.
 */
function dragEventAt(type: string, clientX: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, "dataTransfer", {
    value: { dropEffect: "", effectAllowed: "", setData: () => undefined },
  });
  return event;
}

const tabs = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".board-tab[data-board] .board-tab-title")].map(
    (node) => node.textContent ?? "",
  );

async function settle(container: HTMLElement, count: number): Promise<void> {
  await waitFor(() => {
    expect(container.querySelectorAll(".board-tab[data-board]")).toHaveLength(count);
  });
}

describe("the board bar", () => {
  it("draws one tab per board in `order`, with the showing one marked", async () => {
    const { container } = renderBar(boardTransport({ boards: BOARDS }));
    await settle(container, 3);

    expect(tabs(container)).toEqual(["Attention", "Notes by status", "Files"]);
    // No board was chosen, so the `default-open` one is showing.
    expect(container.querySelector(".board-tab.on")?.getAttribute("data-board")).toBe("b_files");
  });

  it("names the key that reaches each tab, in bar order", async () => {
    const { container } = renderBar(boardTransport({ boards: BOARDS }));
    await settle(container, 3);
    // The title sits on the tab's own control, which is a sibling of the `✕`
    // rather than its parent — an interactive element inside a `<button>` is
    // invalid, and the outer name would swallow the inner one's.
    const titles = [...container.querySelectorAll(".board-tab[data-board] .board-tab-open")].map(
      (node) => node.getAttribute("title"),
    );
    expect(titles[0]).toContain("⌘1");
    expect(titles[2]).toContain("⌘3");
  });

  it("switches board on a click, and remembers the choice", async () => {
    const { container } = renderBar(boardTransport({ boards: BOARDS }));
    await settle(container, 3);

    fireEvent.click(
      container.querySelector('.board-tab[data-board="b_attention"] .board-tab-open') as Element,
    );
    await waitFor(() => {
      expect(container.querySelector(".board-tab.on")?.getAttribute("data-board")).toBe(
        "b_attention",
      );
    });
    expect(globalThis.localStorage.getItem("corpus.board")).toContain("b_attention");
  });

  /**
   * A kanban board's tag, and the one board that receives every open naming no
   * board (`design/navigation.html`'s two `.tag` spans).
   */
  it("marks a kanban board and the default-open board", async () => {
    const { container } = renderBar(
      boardTransport({
        boards: [
          boardRow({ id: "b_a", title: "Plain", order: 1, defaultOpen: true }),
          boardRow({
            id: "b_k",
            title: "Kanban",
            order: 2,
            columns: null,
            kanban: { field: "status", stages: ["open", "resolved"] },
          }),
        ],
      }),
    );
    await settle(container, 2);

    const first = container.querySelector('.board-tab[data-board="b_a"]');
    const second = container.querySelector('.board-tab[data-board="b_k"]');
    expect([...(first?.querySelectorAll(".tag") ?? [])].map((n) => n.textContent)).toEqual([
      "default",
    ]);
    expect([...(second?.querySelectorAll(".tag") ?? [])].map((n) => n.textContent)).toEqual([
      "kanban",
    ]);
  });

  it("creates an empty board document and switches to it", async () => {
    const wire = boardTransport({ boards: BOARDS });
    const { container } = renderBar(wire);
    await settle(container, 3);

    // `＋` offers the two kinds of board there are (UI-152): an empty one, and a
    // kanban whose columns are its stages.
    fireEvent.click(screen.getByRole("button", { name: "New board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Empty board/ }));

    await waitFor(() => {
      expect(wire.writes("POST")).toHaveLength(1);
    });
    expect(wire.writes("POST")[0]?.body).toEqual({
      type: "board",
      title: "New board",
      folder: "boards",
      columns: [],
      // Last on the bar: the highest `order` plus one step.
      order: 4,
    });
    expect(globalThis.localStorage.getItem("corpus.board")).toContain("doc_created");
  });

  it("archives a board through the tab's ✕", async () => {
    const wire = boardTransport({ boards: BOARDS });
    const { container } = renderBar(wire);
    await settle(container, 3);

    fireEvent.click(screen.getByRole("button", { name: "Archive Attention" }));

    await waitFor(() => {
      expect(
        wire.calls.filter((call) => call.path === "/api/docs/b_attention/archive"),
      ).toHaveLength(1);
    });
  });

  /**
   * "One board is always showing: archiving the last board is refused"
   * (SPEC.md §10, rider 2). The `×` is absent, and the menu's Archive is present
   * and disabled with its reason — an affordance may vanish, an answer may not.
   */
  it("hides the ✕ on the only board and disables the menu's archive", async () => {
    const wire = boardTransport({ boards: [boardRow({ id: "b_only", title: "Only", order: 1 })] });
    const { container } = renderBar(wire);
    await settle(container, 1);

    expect(container.querySelector(".board-tab-close")).toBeNull();

    fireEvent.contextMenu(container.querySelector(".board-tab[data-board]") as Element, {
      clientX: 10,
      clientY: 10,
    });
    const archive = screen.getByRole("menuitem", { name: /Archive board/ });
    expect(archive.hasAttribute("disabled")).toBe(true);
    expect(archive.textContent).toContain("one board is always showing");

    fireEvent.click(archive);
    expect(wire.calls.filter((call) => call.path.endsWith("/archive"))).toEqual([]);
  });

  it("offers the prototype's tab menu, and asks before deleting", async () => {
    const wire = boardTransport({ boards: BOARDS });
    const { container } = renderBar(wire);
    await settle(container, 3);

    fireEvent.contextMenu(container.querySelector('.board-tab[data-board="b_status"]') as Element, {
      clientX: 10,
      clientY: 10,
    });
    expect(
      [...document.querySelectorAll("[role='menuitem']")].map((n) => n.getAttribute("data-act")),
    ).toEqual(["rename", "move-left", "move-right", "default-open", "archive", "delete"]);

    // The first activation only re-labels; nothing reaches the wire.
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete board/ }));
    expect(wire.writes("DELETE")).toEqual([]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Really delete this board/ }));
    await waitFor(() => {
      expect(wire.writes("DELETE").map((call) => call.path)).toEqual(["/api/docs/b_status"]);
    });
  });

  it("renames in place, writing the board document's title", async () => {
    const wire = boardTransport({ boards: BOARDS });
    const { container } = renderBar(wire);
    await settle(container, 3);

    fireEvent.contextMenu(container.querySelector('.board-tab[data-board="b_status"]') as Element, {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /^Rename/ }));

    const field = screen.getByLabelText("Rename Notes by status");
    fireEvent.change(field, { target: { value: "Workflow" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]).toMatchObject({
      path: "/api/docs/b_status",
      body: { title: "Workflow" },
    });
  });

  /**
   * "Setting `default-open` on one clears every other board server-side, in the
   * same commit" (SERVER-138), so the client writes exactly one document.
   */
  it("sets the default-open flag with one write, clearing nothing itself", async () => {
    const wire = boardTransport({ boards: BOARDS });
    const { container } = renderBar(wire);
    await settle(container, 3);

    fireEvent.contextMenu(container.querySelector('.board-tab[data-board="b_status"]') as Element, {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Make it the default open target/ }));

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(1);
    });
    expect(wire.writes("PUT")[0]).toMatchObject({
      path: "/api/docs/b_status",
      body: { defaultOpen: true },
    });
  });

  it("moves a board left through the menu, writing `order` on every board that moved", async () => {
    const wire = boardTransport({ boards: BOARDS });
    const { container } = renderBar(wire);
    await settle(container, 3);

    fireEvent.contextMenu(container.querySelector('.board-tab[data-board="b_files"]') as Element, {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Move left/ }));

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(2);
    });
    expect(wire.writes("PUT").map((call) => [call.path, call.body])).toEqual([
      ["/api/docs/b_files", { order: 2 }],
      ["/api/docs/b_status", { order: 3 }],
    ]);
  });

  it("drags a tab to reorder, writing every board that moved", async () => {
    const wire = boardTransport({ boards: BOARDS });
    const { container } = renderBar(wire);
    await settle(container, 3);

    const last = container.querySelector('.board-tab[data-board="b_files"]') as HTMLElement;
    const first = container.querySelector('.board-tab[data-board="b_attention"]') as HTMLElement;
    first.getBoundingClientRect = () => ({ left: 0, width: 100, right: 100 }) as DOMRect;

    fireEvent.dragStart(last, {
      dataTransfer: { effectAllowed: "", setData: () => undefined },
    });
    // Fired on the tab so the handler on `.board-tabs` receives it by bubbling
    // with the right `target` — which is what decides the drop side.
    fireEvent(first, dragEventAt("dragover", 10));
    fireEvent(container.querySelector(".board-tabs") as Element, dragEventAt("drop", 10));

    await waitFor(() => {
      expect(wire.writes("PUT")).toHaveLength(3);
    });
    expect(wire.writes("PUT").map((call) => [call.path, call.body])).toEqual([
      ["/api/docs/b_files", { order: 1 }],
      ["/api/docs/b_attention", { order: 2 }],
      ["/api/docs/b_status", { order: 3 }],
    ]);
  });

  /**
   * UI-148's third edge case: a workspace that never ran the migration. The bar
   * says what to run and invents nothing.
   */
  it("shows one disabled tab naming `corpus upgrade` when there are no boards", async () => {
    const { container } = renderBar(boardTransport({ boards: [] }));
    await waitFor(() => {
      expect(container.querySelector(".board-tab[disabled]")).not.toBeNull();
    });
    expect(container.querySelector(".board-tab[disabled]")?.textContent).toBe(NO_BOARDS_LABEL);
    expect(container.querySelectorAll(".board-tab[data-board]")).toHaveLength(0);
  });

  it("says nothing about a missing board while the read is still in flight", () => {
    const pending = (): Promise<Response> => new Promise(() => undefined);
    const { container } = renderBar({
      fetch: pending,
      calls: [],
      writes: () => [],
    });
    expect(container.querySelector(".board-tab[disabled]")).toBeNull();
  });
});
