/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { keepsNativeMenu, selectionText } from "./nativeMenu";

/**
 * SPEC.md §11: *"the native browser menu remains reachable wherever it is the
 * useful one"*. Copy on a selection and spellcheck inside the editor are the
 * concrete cases, and this is the predicate that protects both.
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

describe("keepsNativeMenu", () => {
  it("keeps it on a text selection, wherever the pointer is", () => {
    const row = mount('<div class="row" data-row-doc="doc_a"><span>title</span></div>');
    expect(keepsNativeMenu({ target: row, selection: "some selected words" })).toBe(true);
    expect(keepsNativeMenu({ target: row, selection: "  \n " })).toBe(false);
  });

  it.each([
    ['<input aria-label="Document title" />', "an input"],
    ["<textarea></textarea>", "a textarea"],
    ["<select></select>", "a select"],
    ['<div contenteditable="true">body</div>', "the editor"],
    ["<div contenteditable>body</div>", "a bare contenteditable"],
  ])("keeps it inside %s (%s)", (html) => {
    expect(keepsNativeMenu({ target: mount(html), selection: "" })).toBe(true);
  });

  it("keeps it inside a plugin-rendered surface", () => {
    const host = mount('<div data-plugin-surface=""><p id="inner">todo</p></div>');
    const inner = host.querySelector("#inner");
    expect(keepsNativeMenu({ target: inner, selection: "" })).toBe(true);
  });

  it("keeps it for a target that is not an element at all", () => {
    expect(keepsNativeMenu({ target: null, selection: "" })).toBe(true);
    expect(keepsNativeMenu({ target: document, selection: "" })).toBe(true);
  });

  it("yields to the Corpus menu on an ordinary item", () => {
    const row = mount('<div class="row" data-row-doc="doc_a"><span>title</span></div>');
    expect(keepsNativeMenu({ target: row, selection: "" })).toBe(false);
  });

  it("reads an absent selection as no selection", () => {
    expect(selectionText()).toBe("");
  });
});
