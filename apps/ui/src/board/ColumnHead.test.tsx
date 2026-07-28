/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viewRow } from "../testing/boardFixture";
import { ColumnHead } from "./ColumnHead";
import { toBoardColumn } from "./viewDoc";

afterEach(cleanup);

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
  return { props, ...render(<ColumnHead {...props} />) };
}

describe("ColumnHead", () => {
  it("renders the prototype's anatomy from the view document", () => {
    const { container } = renderHead();

    expect(container.querySelector(".col-title")?.textContent).toBe("Conversations");
    expect(container.querySelector(".col-kind")?.textContent).toBe("view");
    expect(container.querySelector(".col-count")?.textContent).toBe("4");
    expect([...container.querySelectorAll(".chips .chip.on")].map((n) => n.textContent)).toEqual([
      "type: thread",
      "status: open",
    ]);
    expect(container.querySelector(".sort")?.textContent).toBe("last activity ↓");
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

  it("names the kind a folder column really is", () => {
    const folder = toBoardColumn(viewRow({ title: "Finance", query: { folder: "finance" } }));
    const { container } = renderHead({ column: folder });
    expect(container.querySelector(".col-kind")?.textContent).toBe("folder");
    expect(container.querySelector(".chip.on")?.textContent).toBe("folder: finance/");
  });
});
