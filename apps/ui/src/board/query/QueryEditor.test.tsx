/** @vitest-environment jsdom */
import { createCorpusTestHarness, docRowFixture } from "@corpus/kit/testing";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardTransport } from "../../testing/boardFixture";
import { QUERY_FIELDS } from "./grammar";
import { QueryEditor } from "./QueryEditor";

afterEach(cleanup);

const ROWS = [
  docRowFixture({ id: "doc_a", type: "note", title: "Mortgage options", tags: ["finance"] }),
  docRowFixture({ id: "doc_b", type: "todo", title: "Call the broker", tags: ["urgent"] }),
];

const TREE = {
  folders: [{ path: "finance", name: "finance", count: 2, totalCount: 3, children: [] }],
};

interface HarnessOptions {
  readonly initial?: string;
  readonly onCommit?: () => void;
  readonly onCancel?: () => void;
  readonly rows?: readonly unknown[];
}

/**
 * The editor with the host's half of the contract: `value`/`onChange` live
 * outside it, exactly as `ColumnHead` holds the draft.
 */
function renderEditor(options: HarnessOptions = {}): { value: () => string } {
  const wire = boardTransport({ defaultRows: (options.rows ?? ROWS) as never, tree: TREE });
  const harness = createCorpusTestHarness({ fetch: wire.fetch });
  let latest = options.initial ?? "";

  function Host(): ReactElement {
    const [value, setValue] = useState(options.initial ?? "");
    latest = value;
    return (
      <QueryEditor
        columnTitle="Conversations"
        value={value}
        onChange={setValue}
        onCommit={options.onCommit ?? (() => undefined)}
        onCancel={options.onCancel ?? (() => undefined)}
      />
    );
  }

  render(
    <harness.Wrapper>
      <Host />
    </harness.Wrapper>,
  );
  return { value: () => latest };
}

function field(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>("Edit query for Conversations");
}

/** Typing, with the caret where a real one would be: at the end of the text. */
function type(text: string): void {
  const input = field();
  fireEvent.change(input, { target: { value: text, selectionStart: text.length } });
}

function options(): string[] {
  return screen.queryAllByRole("option").map((item) => item.textContent ?? "");
}

describe("QueryEditor", () => {
  it("focuses and selects the stored query, and stays quiet until it is used", () => {
    renderEditor({ initial: "type=thread&status=open" });
    expect(document.activeElement).toBe(field());
    // Opening the editor to *read* the query must not bury it under a menu.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  describe("field completion", () => {
    it("suggests field names as they are typed", async () => {
      renderEditor();
      type("st");
      await waitFor(() => {
        expect(options().some((text) => text.startsWith("status"))).toBe(true);
      });
      expect(options().some((text) => text.startsWith("stale"))).toBe(true);
      expect(options().some((text) => text.startsWith("type"))).toBe(false);
    });

    it("describes each field, so the menu teaches as it completes", async () => {
      renderEditor();
      type("needs");
      await waitFor(() => {
        expect(screen.getAllByRole("option")[0]?.textContent).toContain("Attention");
      });
    });

    it("completes to the field plus its `=`, since nothing else can follow", async () => {
      const editor = renderEditor();
      type("stat");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(0);
      });
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(editor.value()).toBe("status=");
    });

    it("offers every published field when the caret opens a fresh one", async () => {
      renderEditor();
      type("type=thread&");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(0);
      });
      // The menu is capped, so it lists a prefix of the grammar, not all of it.
      expect(options()[0]).toContain(QUERY_FIELDS[0]?.name ?? "");
    });
  });

  describe("value completion", () => {
    /** The closed sets come from the contract's enums — no guessing involved. */
    it("suggests the contract's values for an enumerated field", async () => {
      renderEditor();
      type("status=");
      await waitFor(() => {
        expect(options().map((text) => text.split(" ")[0])).toEqual([
          "open",
          "resolved",
          "archived",
        ]);
      });
    });

    /** The open sets come from the projection — the real corpus, not a list. */
    it("suggests the document types the workspace actually uses", async () => {
      renderEditor();
      type("type=");
      await waitFor(() => {
        expect(options().some((text) => text.startsWith("todo"))).toBe(true);
      });
      expect(options().some((text) => text.startsWith("note"))).toBe(true);
    });

    it("suggests the tags the workspace actually carries", async () => {
      renderEditor();
      type("tag=");
      await waitFor(() => {
        expect(options().some((text) => text.startsWith("finance"))).toBe(true);
      });
      expect(options().some((text) => text.startsWith("urgent"))).toBe(true);
    });

    it("suggests folders from the workspace tree", async () => {
      renderEditor();
      type("folder=");
      await waitFor(() => {
        expect(options().some((text) => text.startsWith("finance"))).toBe(true);
      });
    });

    it("suggests documents by title where the value is an id", async () => {
      renderEditor();
      type("references=mortgage");
      await waitFor(() => {
        expect(options()[0]).toContain("Mortgage options");
      });
      expect(options()[0]).toContain("doc_a");
    });

    /** A search phrase has no vocabulary; offering one would be a fiction. */
    it("offers nothing for a free-text field", async () => {
      renderEditor();
      type("q=mortgage");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("completes a value after a comma without disturbing the first", async () => {
      const editor = renderEditor();
      type("type=note,tod");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(0);
      });
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(editor.value()).toBe("type=note,todo");
    });
  });

  describe("keyboard", () => {
    it("moves the highlight with the arrows and accepts with ↵", async () => {
      const editor = renderEditor();
      type("type=");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(1);
      });
      fireEvent.keyDown(field(), { key: "ArrowDown" });
      expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(editor.value()).not.toBe("type=");
    });

    it("accepts with ⇥ even when nothing has been typed into the token", async () => {
      const editor = renderEditor();
      type("status=");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(0);
      });
      fireEvent.keyDown(field(), { key: "Tab" });
      expect(editor.value()).toBe("status=open");
    });

    /**
     * Unlike the `@`/`[[` menus this one can be open before a single character
     * is typed, so `↵` must still mean "commit" until the menu has something to
     * add — otherwise clearing a query would submit `q=`.
     */
    it("lets ↵ commit when the menu has nothing the user has narrowed", async () => {
      const onCommit = vi.fn();
      const editor = renderEditor({ initial: "type=thread", onCommit });
      type("");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(0);
      });
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onCommit).toHaveBeenCalled();
      expect(editor.value()).toBe("");
    });

    it("lets ↵ commit a value the user has already typed in full", async () => {
      const onCommit = vi.fn();
      renderEditor({ onCommit });
      type("status=open");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(0);
      });
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onCommit).toHaveBeenCalled();
    });

    it("gives the first esc to the menu and the second to the edit", async () => {
      const onCancel = vi.fn();
      renderEditor({ onCancel });
      type("stat");
      await waitFor(() => {
        expect(options().length).toBeGreaterThan(0);
      });

      fireEvent.keyDown(field(), { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(onCancel).not.toHaveBeenCalled();

      fireEvent.keyDown(field(), { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("opens the menu on ↓ from an untouched field", async () => {
      renderEditor({ initial: "type=thread" });
      fireEvent.keyDown(field(), { key: "ArrowDown" });
      await waitFor(() => {
        expect(screen.queryByRole("listbox")).not.toBeNull();
      });
    });
  });

  describe("the syntax reference", () => {
    function help(): HTMLElement {
      return screen.getByRole("button", { name: /Query syntax/ });
    }

    it("opens from a visible button and lists fields, combinators and examples", () => {
      renderEditor();
      fireEvent.click(help());

      const panel = screen.getByRole("dialog", { name: "Query syntax" });
      expect(panel.textContent).toContain("needs=me&folder=finance");
      expect(panel.textContent).toContain("AND, between fields");
      expect(panel.textContent).toContain("OR, within one field");
      expect(panel.querySelectorAll("[data-query-field]")).toHaveLength(QUERY_FIELDS.length);
    });

    /** The panel is generated, so it cannot list a field the grammar dropped. */
    it("lists exactly the grammar's fields, in its order", () => {
      renderEditor();
      fireEvent.click(help());
      const listed = [
        ...screen
          .getByRole("dialog", { name: "Query syntax" })
          .querySelectorAll("[data-query-field]"),
      ].map((node) => node.getAttribute("data-query-field"));
      expect(listed).toEqual(QUERY_FIELDS.map((entry) => entry.name));
    });

    it("is reachable and dismissable from the keyboard", () => {
      const onCancel = vi.fn();
      renderEditor({ onCancel });
      const button = help();
      button.focus();
      fireEvent.click(button);

      const panel = screen.getByRole("dialog", { name: "Query syntax" });
      expect(document.activeElement).toBe(panel);

      fireEvent.keyDown(panel, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      // Esc closed the reference, not the edit, and focus came back to its opener.
      expect(onCancel).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button);
    });

    it("closes on a press outside it", () => {
      renderEditor();
      fireEvent.click(help());
      expect(screen.queryByRole("dialog")).not.toBeNull();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    /** Reaching for the help must not save a half-typed query and close the field. */
    it("does not commit when focus moves from the field to the help", () => {
      const onCommit = vi.fn();
      renderEditor({ onCommit });
      const button = help();
      fireEvent.blur(field(), { relatedTarget: button });
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("still commits when focus leaves the editor altogether", () => {
      const onCommit = vi.fn();
      renderEditor({ onCommit });
      fireEvent.blur(field(), { relatedTarget: document.body });
      expect(onCommit).toHaveBeenCalledTimes(1);
    });
  });

  describe("an unrecognised field", () => {
    /**
     * The server strips an unknown parameter instead of refusing it, so a typo
     * renders a healthy column that ignores the filter. Nothing is blocked here
     * — the query still commits and still runs — but the silence is broken.
     */
    it("is named without blocking the edit", async () => {
      const onCommit = vi.fn();
      renderEditor({ onCommit });
      type("typ=todo");
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toContain("typ");
      });
      expect(screen.getByRole("status").textContent).toContain("Unknown field");

      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onCommit).toHaveBeenCalled();
    });

    it("says nothing about a query the schema accepts", () => {
      renderEditor({ initial: "type=thread&status=open" });
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
