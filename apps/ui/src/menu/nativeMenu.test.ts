/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { keepsNativeMenu, selectionMenuTarget, type SelectionSource } from "./nativeMenu";

/**
 * SPEC.md §11's two shared halves: the native menu survives where it is the
 * useful one (spellcheck, and anywhere no Corpus item is under the cursor), and
 * a selection in the document body gets Corpus's own menu.
 *
 * The regression these tests pin (user report, 2026-07-30): the rule used to
 * keep the native menu for *any* non-empty selection anywhere on the page, so a
 * row's menu disappeared whenever text was selected somewhere else — including
 * the word the browser auto-selects under the right-click itself.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error("fixture did not render");
  return element;
}

/**
 * A selection over `node`'s contents, as the rule reads one.
 *
 * Built over a real `Range` — the part of the Selection API jsdom carries
 * faithfully — so the containment questions are answered by the real DOM.
 */
function selectionOver(node: Node, text = node.textContent ?? ""): SelectionSource {
  const range = document.createRange();
  range.selectNodeContents(node);
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => range,
  };
}

const NONE: SelectionSource = {
  isCollapsed: true,
  rangeCount: 0,
  toString: () => "",
  getRangeAt: () => {
    throw new Error("no range");
  },
};

describe("keepsNativeMenu", () => {
  it.each([
    ['<input aria-label="Document title" />', "an input"],
    ["<textarea></textarea>", "a textarea"],
    ["<select></select>", "a select"],
    ['<div contenteditable="true">body</div>', "the editor"],
    ["<div contenteditable>body</div>", "a bare contenteditable"],
  ])("keeps it inside %s (%s)", (html) => {
    expect(keepsNativeMenu({ target: mount(html) })).toBe(true);
  });

  it("keeps it inside a plugin-rendered surface", () => {
    const host = mount('<div data-plugin-surface=""><p id="inner">todo</p></div>');
    expect(keepsNativeMenu({ target: host.querySelector("#inner") })).toBe(true);
  });

  it("keeps it for a target that is not an element at all", () => {
    expect(keepsNativeMenu({ target: null })).toBe(true);
    expect(keepsNativeMenu({ target: document })).toBe(true);
  });

  it("yields to the Corpus menu on an ordinary item", () => {
    const row = mount('<div class="row" data-row-doc="doc_a"><span>title</span></div>');
    expect(keepsNativeMenu({ target: row })).toBe(false);
  });
});

describe("selectionMenuTarget", () => {
  it("answers for a selection the pointer is on, inside the document body", () => {
    const body = mount('<div class="doc-body"><p id="p1">rates moved</p></div>');
    const paragraph = body.querySelector("#p1");
    if (paragraph === null) throw new Error("fixture did not render");

    expect(selectionMenuTarget(paragraph, selectionOver(paragraph))).toEqual({
      text: "rates moved",
      editable: false,
    });
  });

  it("reports editable content, which is what offers Cut and Paste", () => {
    const body = mount('<div class="doc-body" contenteditable="true"><p id="p1">rates</p></div>');
    const paragraph = body.querySelector("#p1");
    if (paragraph === null) throw new Error("fixture did not render");

    expect(selectionMenuTarget(paragraph, selectionOver(paragraph))?.editable).toBe(true);
  });

  it("declines when the pointer is elsewhere in the body — the item under it wins", () => {
    const body = mount('<div class="doc-body"><p id="p1">rates</p><p id="p2">other</p></div>');
    const selected = body.querySelector("#p1");
    const clicked = body.querySelector("#p2");
    if (selected === null || clicked === null) throw new Error("fixture did not render");

    expect(selectionMenuTarget(clicked, selectionOver(selected))).toBeNull();
  });

  it("answers when the selection spans the blocks the pointer is inside", () => {
    const body = mount('<div class="doc-body"><p id="p1">rates</p><p id="p2">other</p></div>');
    const clicked = body.querySelector("#p2");
    if (clicked === null) throw new Error("fixture did not render");

    expect(selectionMenuTarget(clicked, selectionOver(body, "rates other"))?.text).toBe(
      "rates other",
    );
  });

  it("declines outside the document body — a row's selection belongs to the row", () => {
    const row = mount('<div class="row" data-row-doc="doc_a"><span id="t">Mortgage</span></div>');
    const title = row.querySelector("#t");
    if (title === null) throw new Error("fixture did not render");

    expect(selectionMenuTarget(title, selectionOver(title))).toBeNull();
  });

  it("declines inside a plugin-rendered surface", () => {
    const host = mount(
      '<div data-plugin-surface=""><div class="doc-body"><p id="p1">todo</p></div></div>',
    );
    const paragraph = host.querySelector("#p1");
    if (paragraph === null) throw new Error("fixture did not render");

    expect(selectionMenuTarget(paragraph, selectionOver(paragraph))).toBeNull();
  });

  it("declines when there is no selection at all", () => {
    const body = mount('<div class="doc-body"><p id="p1">rates</p></div>');
    expect(selectionMenuTarget(body.querySelector("#p1"), NONE)).toBeNull();
    expect(selectionMenuTarget(body.querySelector("#p1"), null)).toBeNull();
  });

  it("declines a selection of nothing but whitespace", () => {
    const body = mount('<div class="doc-body"><p id="p1"> </p></div>');
    const paragraph = body.querySelector("#p1");
    if (paragraph === null) throw new Error("fixture did not render");

    expect(selectionMenuTarget(paragraph, selectionOver(paragraph, "  \n "))).toBeNull();
  });

  it("declines for a target that is not an element", () => {
    expect(selectionMenuTarget(null)).toBeNull();
  });

  it("reads the live selection when none is passed", () => {
    const body = mount('<div class="doc-body"><p id="p1">rates</p></div>');
    expect(selectionMenuTarget(body.querySelector("#p1"))).toBeNull();
  });
});
