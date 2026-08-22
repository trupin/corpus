/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  isPluginRendered,
  keepsNativeMenu,
  selectionMenuTarget,
  type SelectionSource,
} from "./nativeMenu";

/**
 * SPEC.md §10's two shared halves: the native menu survives where it is the
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

/** A selection running from the start of `from` to the end of `to`. */
function selectionSpanning(from: Node, to: Node, text: string): SelectionSource {
  const range = document.createRange();
  range.setStartBefore(from);
  range.setEndAfter(to);
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => range,
  };
}

function requireElement(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`fixture has no ${selector}`);
  return element;
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

/**
 * UI-036. The one question every suppression site asks, and the one it used to
 * ask instead: "did a plugin render this **surface**", never "does this
 * document's type have a plugin renderer".
 */
describe("isPluginRendered", () => {
  it("answers for anything inside a plugin surface, however deep", () => {
    const host = mount(
      '<div class="col-list" data-plugin-surface=""><div class="row" data-row-doc="doc_a">' +
        '<span id="inner">item</span></div></div>',
    );
    expect(isPluginRendered(host)).toBe(true);
    expect(isPluginRendered(host.querySelector("#inner"))).toBe(true);
  });

  it("answers no for a core row a plugin ListItem painted", () => {
    // The core column list is core's surface; only the row's renderer came from
    // a plugin, and the subject is still the document core holds.
    const list = mount(
      '<div class="col-list"><div class="row todo-row" data-row-doc="doc_a" ' +
        'data-row-type="todo"><span class="row-title">Inbox chores</span></div></div>',
    );
    expect(isPluginRendered(list.querySelector(".row"))).toBe(false);
  });

  it("answers no for anything that is not an element", () => {
    expect(isPluginRendered(null)).toBe(false);
    expect(isPluginRendered(document)).toBe(false);
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

  /**
   * PR #13 review, MINOR. The ancestor test this replaced answered "yes" for
   * every block in the body once a selection spanned two of them, because their
   * common ancestor *is* the body — so a right-click five paragraphs down
   * opened a selection menu for words nowhere near the pointer.
   */
  it("declines a block the multi-block selection does not touch", () => {
    mount(
      `<div class="doc-body">
         <p id="p1">first</p><p id="p2">second</p><p id="p3">third</p>
         <p id="p4">fourth</p><p id="p5">fifth</p>
       </div>`,
    );
    const spanning = selectionSpanning(
      requireElement("#p1"),
      requireElement("#p2"),
      "first second",
    );

    expect(selectionMenuTarget(requireElement("#p5"), spanning)).toBeNull();
    expect(selectionMenuTarget(requireElement("#p3"), spanning)).toBeNull();
  });

  it("answers for the blocks a multi-block selection does touch", () => {
    mount(
      `<div class="doc-body">
         <p id="p1">first</p><p id="p2">second</p><p id="p3">third</p>
       </div>`,
    );
    const spanning = selectionSpanning(
      requireElement("#p1"),
      requireElement("#p2"),
      "first second",
    );

    expect(selectionMenuTarget(requireElement("#p1"), spanning)?.text).toBe("first second");
    expect(selectionMenuTarget(requireElement("#p2"), spanning)?.text).toBe("first second");
    // The body encloses the selection: a click on it is a click on the words.
    expect(selectionMenuTarget(requireElement(".doc-body"), spanning)?.text).toBe("first second");
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
