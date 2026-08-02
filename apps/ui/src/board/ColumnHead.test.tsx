/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuProvider } from "../menu/ContextMenuHost";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { viewRow } from "../testing/boardFixture";
import { ColumnHead } from "./ColumnHead";
import { toBoardColumn } from "./viewDoc";

afterEach(() => {
  cleanup();
  resetEscapeLayers();
});

const column = toBoardColumn(
  viewRow({
    id: "doc_threads",
    title: "Conversations",
    order: 30,
    query: { type: "thread", status: "open" },
  }),
);

function renderHead(overrides: Partial<Parameters<typeof ColumnHead>[0]> = {}) {
  const props = {
    column,
    count: 4,
    onAdd: vi.fn(),
    onRename: vi.fn(),
    onEditQuery: vi.fn(),
    onUnpin: vi.fn(),
    onHandle: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(
      <ContextMenuProvider>
        <ColumnHead {...props} />
      </ContextMenuProvider>,
    ),
  };
}

describe("ColumnHead", () => {
  it("renders the prototype's anatomy from the view document", () => {
    const { container } = renderHead();

    expect(container.querySelector(".col-title")?.textContent).toBe("Conversations");
    expect(container.querySelector(".col-kind")?.textContent).toBe("view");
    expect(container.querySelector(".col-count")?.textContent).toBe("4");
    expect([...container.querySelectorAll(".chips > .chip.on")].map((n) => n.textContent)).toEqual([
      "type: thread",
      "status: open",
    ]);
    expect(container.querySelector(".chips > .sort")?.textContent).toBe("last activity ↓");
  });

  it("says the count is unknown rather than showing a zero it has not been told", () => {
    const { container } = renderHead({ count: null });
    expect(container.querySelector(".col-count")?.textContent).toBe("—");
  });

  it("arms the drag handle on the header but not on its buttons", () => {
    const onHandle = vi.fn();
    const { container } = renderHead({ onHandle });
    const head = container.querySelector(".col-head");
    if (head === null) throw new Error("no header");

    fireEvent.mouseDown(head);
    expect(onHandle).toHaveBeenCalledWith(true);
    fireEvent.mouseUp(head);
    expect(onHandle).toHaveBeenLastCalledWith(false);

    onHandle.mockClear();
    fireEvent.mouseDown(screen.getByRole("button", { name: /New document/ }));
    expect(onHandle).not.toHaveBeenCalled();
  });

  it("fires ＋ without starting a drag", () => {
    const { props } = renderHead();
    fireEvent.click(screen.getByRole("button", { name: /New document/ }));
    expect(props.onAdd).toHaveBeenCalledTimes(1);
  });

  it("renames through the ⋯ menu, editing the view document's title", () => {
    const { props } = renderHead();
    fireEvent.click(screen.getByRole("button", { name: /List options/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));

    const field = screen.getByLabelText("Rename Conversations");
    expect(field).toHaveProperty("value", "Conversations");
    fireEvent.change(field, { target: { value: "Discussions" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(props.onRename).toHaveBeenCalledWith("Discussions");
  });

  it("does not write a rename that changes nothing, or one that empties the title", () => {
    const { props } = renderHead();
    fireEvent.click(screen.getByRole("button", { name: /List options/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));

    const field = screen.getByLabelText("Rename Conversations");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("abandons an edit on Escape", () => {
    const { props } = renderHead();
    fireEvent.click(screen.getByRole("button", { name: /List options/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));

    const field = screen.getByLabelText("Rename Conversations");
    fireEvent.change(field, { target: { value: "Nope" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Rename Conversations")).toBeNull();
  });

  it("edits the stored query in the wire's own grammar", () => {
    const { props, container } = renderHead();
    fireEvent.click(screen.getByRole("button", { name: /List options/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit query/ }));

    const field = screen.getByLabelText("Edit query for Conversations");
    expect(field).toHaveProperty("value", "type=thread&status=open");
    // While editing, the chips give way to the field they describe.
    expect(container.querySelector(".chips")).toBeNull();

    fireEvent.change(field, { target: { value: "type=thread&status=resolved" } });
    fireEvent.blur(field);
    expect(props.onEditQuery).toHaveBeenCalledWith({ type: "thread", status: "resolved" });
  });

  /**
   * PR #10 finding 19. The rename branch has always declined a no-op; the query
   * branch wrote unconditionally, so opening the field and clicking away
   * rewrote the view document, bumped `updated` and left a commit in the log
   * for an edit nobody made.
   */
  describe("an Edit-query field that changes nothing", () => {
    function openQueryField(): HTMLElement {
      fireEvent.click(screen.getByRole("button", { name: /List options/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Edit query/ }));
      return screen.getByLabelText("Edit query for Conversations");
    }

    it("writes nothing when the field is blurred untouched", () => {
      const { props } = renderHead();
      fireEvent.blur(openQueryField());
      expect(props.onEditQuery).not.toHaveBeenCalled();
    });

    it("writes nothing when the text is re-typed identically", () => {
      const { props } = renderHead();
      const field = openQueryField();
      fireEvent.change(field, { target: { value: "type=thread&status=open" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(props.onEditQuery).not.toHaveBeenCalled();
    });

    it("writes nothing when only the order of the filters changed", () => {
      const { props } = renderHead();
      const field = openQueryField();
      fireEvent.change(field, { target: { value: "status=open&type=thread" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(props.onEditQuery).not.toHaveBeenCalled();
    });

    it("still writes when a filter is dropped", () => {
      const { props } = renderHead();
      const field = openQueryField();
      fireEvent.change(field, { target: { value: "type=thread" } });
      fireEvent.blur(field);
      expect(props.onEditQuery).toHaveBeenCalledWith({ type: "thread" });
    });
  });

  it("unpins through the menu and closes it", () => {
    const { props } = renderHead();
    fireEvent.click(screen.getByRole("button", { name: /List options/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Unpin/ }));

    expect(props.onUnpin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the menu on a click outside, on Escape, and on a second ⋯", () => {
    renderHead();
    const trigger = screen.getByRole("button", { name: /List options/ });

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the menu open for a click inside it", () => {
    renderHead();
    fireEvent.click(screen.getByRole("button", { name: /List options/ }));
    const menu = screen.getByRole("menu");
    fireEvent.mouseDown(menu);
    expect(screen.getByRole("menu")).toBeDefined();
  });

  /**
   * UI-038. jsdom has no layout, so the widths are supplied — the header's own
   * rule (measure, compare, degrade, restore) is what is under test, and the
   * pixels themselves are asserted in `e2e/column-header.spec.ts`.
   */
  describe("the one-row rule", () => {
    let callbacks: ResizeObserverCallback[] = [];

    class TestResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        callbacks = callbacks.filter((entry) => entry !== this.callback);
      }
    }

    beforeEach(() => {
      callbacks = [];
      vi.stubGlobal("ResizeObserver", TestResizeObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    interface Layout {
      /** The visible row's content width. */
      readonly row: number;
      /** What the row's copy needs for its chips and the full label. */
      readonly required: number;
    }

    function layOut(container: HTMLElement, layout: Layout): void {
      const row = container.querySelector(".chips");
      const probe = container.querySelector(".chips-probe");
      if (row === null || probe === null) throw new Error("no chips row");
      Object.defineProperty(row, "clientWidth", { value: layout.row, configurable: true });
      probe.getBoundingClientRect = () => ({ width: layout.required }) as DOMRect;
      act(() => {
        for (const callback of [...callbacks]) callback([], {} as ResizeObserver);
      });
    }

    function sortText(container: HTMLElement): string {
      return container.querySelector(".chips > .sort")?.textContent ?? "";
    }

    it("keeps the label whole while the row has room for it", () => {
      const { container } = renderHead();
      layOut(container, { row: 400, required: 304 });

      expect(sortText(container)).toBe("last activity ↓");
      expect(
        container.querySelector(".chips > .sort")?.getAttribute("data-sort-compact"),
      ).toBeNull();
    });

    it("sheds the word the label can spare rather than wrapping", () => {
      const { container } = renderHead();
      layOut(container, { row: 212, required: 304 });

      expect(sortText(container)).toBe("last ↓");
      expect(container.querySelector(".chips > .sort")?.getAttribute("data-sort-compact")).toBe("");
    });

    it("restores the full label when the width comes back", () => {
      const { container } = renderHead();
      layOut(container, { row: 212, required: 304 });
      expect(sortText(container)).toBe("last ↓");

      layOut(container, { row: 400, required: 304 });
      expect(sortText(container)).toBe("last activity ↓");
    });

    it("measures a copy of the row that carries every chip and the full label", () => {
      // Four chips: what the row needs is the chips it has, not its width.
      const busy = toBoardColumn(
        viewRow({
          title: "Conversations",
          query: { type: "thread", status: "open", tag: "finance", folder: "inbox" },
        }),
      );
      const { container } = renderHead({ column: busy });
      const probe = container.querySelector(".chips-probe");

      expect([...(probe?.querySelectorAll(".chip") ?? [])].map((n) => n.textContent)).toEqual([
        "type: thread",
        "status: open",
        "tag: finance",
        "folder: inbox/",
      ]);
      expect(probe?.querySelector(".sort")?.textContent).toBe("last activity ↓");
    });

    it("keeps the copy out of the accessibility tree, degraded or not", () => {
      const { container } = renderHead();
      layOut(container, { row: 212, required: 304 });

      const probe = container.querySelector(".chips-probe");
      expect(probe?.getAttribute("aria-hidden")).toBe("true");
      // The visible row degraded; the copy it is measured against did not.
      expect(sortText(container)).toBe("last ↓");
      expect(probe?.querySelector(".sort")?.textContent).toBe("last activity ↓");
      expect(container.querySelectorAll(".chips > .chip")).toHaveLength(2);
    });

    it("measures again on the row the Edit-query field leaves behind", () => {
      const { container } = renderHead();
      layOut(container, { row: 212, required: 304 });
      expect(sortText(container)).toBe("last ↓");

      fireEvent.click(screen.getByRole("button", { name: /List options/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Edit query/ }));
      expect(container.querySelector(".chips")).toBeNull();

      fireEvent.blur(screen.getByLabelText("Edit query for Conversations"));
      // A fresh row element: the observer has to be re-armed on it, and the
      // label starts whole again until that measurement says otherwise.
      expect(sortText(container)).toBe("last activity ↓");
      layOut(container, { row: 212, required: 304 });
      expect(sortText(container)).toBe("last ↓");
    });
  });

  it("names the kind a folder column really is", () => {
    const folder = toBoardColumn(viewRow({ title: "Finance", query: { folder: "finance" } }));
    const { container } = renderHead({ column: folder });
    expect(container.querySelector(".col-kind")?.textContent).toBe("folder");
    expect(container.querySelector(".chips > .chip.on")?.textContent).toBe("folder: finance/");
  });
});
