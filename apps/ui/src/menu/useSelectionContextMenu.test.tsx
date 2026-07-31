/** @vitest-environment jsdom */
import { Editor } from "@tiptap/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { corpusExtensions } from "../editor/markdown/schema";
import { resetEscapeLayers } from "../reader/useEscapeStack";
import { ContextMenuProvider } from "./ContextMenuHost";
import type { SelectionSource } from "./nativeMenu";
import {
  captureReplace,
  SELECTION_MENU_LABEL,
  useSelectionContextMenu,
} from "./useSelectionContextMenu";

/**
 * The routing half of SPEC.md §11's right-click rule, at the document view.
 *
 * Two things have to hold at once and neither used to: a selection in the body
 * opens Corpus's own menu, and it does so **instead of** the reader's document
 * menu that sits on an ancestor — while every event this hook does not own
 * still reaches that ancestor untouched.
 */

afterEach(() => {
  cleanup();
  resetEscapeLayers();
  vi.restoreAllMocks();
});

/** Points `getSelection` at the contents of `#quote`, as a real range would. */
function selectQuote(): void {
  const node = document.querySelector("#quote");
  if (node === null) throw new Error("fixture did not render");
  const range = document.createRange();
  range.selectNodeContents(node);
  const source: SelectionSource = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => node.textContent ?? "",
    getRangeAt: () => range,
  };
  vi.spyOn(globalThis, "getSelection").mockReturnValue(source as unknown as Selection);
}

interface HostProps {
  readonly editor?: Editor | null;
  readonly comment?: (() => void) | null;
  readonly onReaderMenu: () => void;
}

function Host({ editor = null, comment = null, onReaderMenu }: HostProps): ReactElement {
  const onContextMenu = useSelectionContextMenu({
    editor,
    captureComment: () => comment,
    onNotify: () => undefined,
  });
  return (
    <div onContextMenu={onReaderMenu} data-testid="reader">
      <div className="doc-main" onContextMenu={onContextMenu}>
        <div className="doc-body">
          <p id="quote">rates moved this week</p>
        </div>
        <div className="fm-chips" id="chips">
          note
        </div>
      </div>
    </div>
  );
}

function mount(props: Partial<HostProps> = {}): { readonly readerMenu: () => number } {
  const seen = { count: 0 };
  render(
    <ContextMenuProvider>
      <Host
        {...props}
        onReaderMenu={() => {
          seen.count += 1;
        }}
      />
    </ContextMenuProvider>,
  );
  return { readerMenu: () => seen.count };
}

function rightClick(selector: string): void {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`no ${selector}`);
  fireEvent.contextMenu(element);
}

describe("the document body's selection menu", () => {
  it("opens on a selection, and keeps the reader's own menu from opening over it", () => {
    const host = mount({ comment: () => undefined });
    selectQuote();

    rightClick("#quote");

    expect(screen.getByRole("menu", { name: SELECTION_MENU_LABEL })).toBeTruthy();
    expect(host.readerMenu()).toBe(0);
  });

  it("lets the reader's menu through when the pointer is off the selection", () => {
    const host = mount({ comment: () => undefined });
    selectQuote();

    rightClick("#chips");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(host.readerMenu()).toBe(1);
  });

  /**
   * PR #13 review, MAJOR. Declining here dropped the event on the reader's
   * handler, so a selection in a thread's conversation opened the **document's**
   * menu — neither Copy nor the browser's own. §11 says Copy always.
   */
  it("opens a Copy-only menu where nothing else is on offer", () => {
    // A thread's conversation, a `view`, or a document under someone else's lock.
    const host = mount({ comment: null });
    selectQuote();

    rightClick("#quote");

    expect(screen.getByRole("menu", { name: SELECTION_MENU_LABEL })).toBeTruthy();
    expect(screen.getAllByRole("menuitem").map((item) => item.dataset["act"])).toEqual(["copy"]);
    expect(host.readerMenu()).toBe(0);
  });

  it("does nothing without a selection", () => {
    const host = mount({ comment: () => undefined });

    rightClick("#quote");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(host.readerMenu()).toBe(1);
  });
});

describe("captureReplace", () => {
  function editorWith(text: string, options: { editable?: boolean } = {}): Editor {
    return new Editor({
      extensions: corpusExtensions(),
      content: `<p>${text}</p>`,
      editable: options.editable ?? true,
    });
  }

  const never = (): void => {
    throw new Error("the range was reported stale");
  };

  it("replaces exactly the range that was selected when the menu opened", () => {
    const editor = editorWith("rates moved");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const replace = captureReplace(editor, never);

    // The menu takes focus and the caret collapses: the captured range is what
    // the act must still use.
    editor.commands.setTextSelection({ from: 12, to: 12 });
    replace?.("prices");

    expect(editor.state.doc.textContent).toBe("prices moved");
    editor.destroy();
  });

  it("deletes the range for a cut, without parsing anything", () => {
    const editor = editorWith("rates moved");
    editor.commands.setTextSelection({ from: 1, to: 7 });
    captureReplace(editor, never)?.("");

    expect(editor.state.doc.textContent).toBe("moved");
    editor.destroy();
  });

  it("pastes markup as the literal text it is", () => {
    const editor = editorWith("rates");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    captureReplace(editor, never)?.("a <b> c");

    expect(editor.state.doc.textContent).toBe("a <b> c");
    editor.destroy();
  });

  it.each([
    ["there is no editor", (): Editor | null => null],
    ["the document is not editable", () => editorWith("rates", { editable: false })],
  ])("declines when %s", (_case, make) => {
    const editor = make();
    editor?.commands.setTextSelection({ from: 1, to: 6 });
    expect(captureReplace(editor, never)).toBeNull();
    editor?.destroy();
  });

  it("declines when nothing is selected", () => {
    const editor = editorWith("rates");
    editor.commands.setTextSelection({ from: 3, to: 3 });
    expect(captureReplace(editor, never)).toBeNull();
    editor.destroy();
  });
});

/**
 * PR #13 review, MINOR: a menu can sit open across an SSE-driven adoption of a
 * new body, and the positions it captured then index into other words — or past
 * the end of a document that shrank, which is a `RangeError` out of
 * `textBetween` rather than a refusal.
 */
describe("captureReplace on a document that moved underneath it", () => {
  function adopt(editor: Editor, html: string): void {
    // What `DocEditor` dispatches when the server's copy arrives.
    editor.commands.setContent(html, false);
  }

  it("refuses rather than replacing other words at the same positions", () => {
    const editor = new Editor({ extensions: corpusExtensions(), content: "<p>rates moved</p>" });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const stale = vi.fn();
    const replace = captureReplace(editor, stale);

    adopt(editor, "<p>PRICE moved</p>");
    replace?.("prices");

    expect(stale).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe("PRICE moved");
    editor.destroy();
  });

  it("refuses on a document that shrank past the captured range", () => {
    const editor = new Editor({ extensions: corpusExtensions(), content: "<p>rates moved</p>" });
    editor.commands.setTextSelection({ from: 7, to: 12 });
    const stale = vi.fn();
    const replace = captureReplace(editor, stale);

    adopt(editor, "<p>hi</p>");
    // No throw, no transaction: the positions are past the end of the document.
    replace?.("prices");

    expect(stale).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe("hi");
    editor.destroy();
  });

  it("still acts when the document changed elsewhere and the range reads the same", () => {
    const editor = new Editor({
      extensions: corpusExtensions(),
      content: "<p>rates moved</p><p>later</p>",
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const stale = vi.fn();
    const replace = captureReplace(editor, stale);

    adopt(editor, "<p>rates moved</p><p>a different second paragraph</p>");
    replace?.("prices");

    expect(stale).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toBe("prices moveda different second paragraph");
    editor.destroy();
  });
});
