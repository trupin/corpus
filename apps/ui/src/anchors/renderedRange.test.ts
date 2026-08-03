/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  domRangeOfRendered,
  renderedOffsetsOfRange,
  renderedTextOf,
  trimToText,
} from "./renderedRange";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

/** A range over the `nth` occurrence of `phrase`, built without the module under test. */
function selectNth(root: Element, phrase: string, nth = 0): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let from = 0; ;) {
      const at = text.indexOf(phrase, from);
      if (at === -1) break;
      if (seen === nth) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + phrase.length);
        return range;
      }
      seen += 1;
      from = at + phrase.length;
    }
  }
  throw new Error(`no occurrence ${String(nth)} of "${phrase}"`);
}

describe("the rendered text", () => {
  it("concatenates the surface's text in document order", () => {
    const host = mount("<p>Hello <strong>world</strong></p><p>again</p>");
    expect(renderedTextOf(host).text).toBe("Hello worldagain");
  });

  it("leaves out a fence's copy button and its info-string label", () => {
    const host = mount(
      `<div class="fence"><span class="fence-label" data-fence-label="ts">ts</span>` +
        `<div class="fence-canvas"><pre><code>const a = 1;\n</code></pre>` +
        `<button data-fence-copy>Copy</button></div></div>`,
    );
    expect(renderedTextOf(host).text).toBe("const a = 1;\n");
  });

  it("leaves out a resolved ref's title, which is not text in the file", () => {
    const host = mount(`<p>See <a class="ref" data-corpus-ref="doc_a1b2c3">Rates</a> later.</p>`);
    expect(renderedTextOf(host).text).toBe("See  later.");
  });

  it("leaves out an unresolved ref's placeholder too", () => {
    const host = mount(`<p>See <span data-corpus-ref-broken="doc_a1b2c3">doc_a1b2c3</span>.</p>`);
    expect(renderedTextOf(host).text).toBe("See .");
  });

  it("does not empty a body just because an ancestor above the root is chrome", () => {
    const outer = mount(`<button><span id="body">quoted words</span></button>`);
    const root = outer.querySelector("#body");
    expect(root).not.toBeNull();
    expect(renderedTextOf(root as Element).text).toBe("quoted words");
  });
});

describe("a DOM range as offsets", () => {
  it("reads a selection inside one text node", () => {
    const host = mount("<p>We assume 6.1% today.</p>");
    const rendered = renderedTextOf(host);
    expect(renderedOffsetsOfRange(rendered, selectNth(host, "6.1%"))).toEqual({
      start: 10,
      end: 14,
    });
  });

  it("reads a selection spanning an inline element", () => {
    const host = mount("<p>We assume <strong>6.1%</strong> today.</p>");
    const rendered = renderedTextOf(host);
    const range = document.createRange();
    range.setStart(host.firstChild?.firstChild as Node, 3);
    range.setEnd(host.querySelector("strong")?.firstChild as Node, 4);
    expect(renderedOffsetsOfRange(rendered, range)).toEqual({ start: 3, end: 14 });
  });

  it("answers null for a caret", () => {
    const host = mount("<p>text</p>");
    const range = document.createRange();
    range.setStart(host.firstChild?.firstChild as Node, 2);
    range.setEnd(host.firstChild?.firstChild as Node, 2);
    expect(renderedOffsetsOfRange(renderedTextOf(host), range)).toBeNull();
  });

  it("answers null for a selection that touches none of the surface", () => {
    const host = mount("<p>inside</p>");
    const other = mount("<p>elsewhere</p>");
    expect(renderedOffsetsOfRange(renderedTextOf(host), selectNth(other, "elsewhere"))).toBeNull();
  });
});

describe("offsets back to a DOM range", () => {
  it("addresses the words it was given", () => {
    const host = mount("<p>We assume 6.1% today.</p>");
    const range = domRangeOfRendered(renderedTextOf(host), 10, 14);
    expect(range?.toString()).toBe("6.1%");
  });

  it("spans two blocks when the offsets do", () => {
    const host = mount("<p>Hello</p><p>world</p>");
    // The blocks contribute no separator, so the surface reads "Helloworld".
    const range = domRangeOfRendered(renderedTextOf(host), 3, 8);
    expect(range?.toString()).toBe("lowor");
  });

  it("answers null for an empty or out-of-range span", () => {
    const host = mount("<p>short</p>");
    const rendered = renderedTextOf(host);
    expect(domRangeOfRendered(rendered, 3, 3)).toBeNull();
    expect(domRangeOfRendered(rendered, 2, 99)).toBeNull();
  });
});

describe("trimming a selection", () => {
  it("drops the trailing space a double-click drags in", () => {
    expect(trimToText("the rate ", { start: 0, end: 9 })).toEqual({ start: 0, end: 8 });
  });

  it("drops a leading newline picked up across a block break", () => {
    expect(trimToText("\n\nrate", { start: 0, end: 6 })).toEqual({ start: 2, end: 6 });
  });

  it("answers null for whitespace alone — `exact` is min(1) on the wire", () => {
    expect(trimToText("   ", { start: 0, end: 3 })).toBeNull();
  });
});
