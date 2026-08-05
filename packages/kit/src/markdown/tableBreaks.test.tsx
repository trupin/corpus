/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCorpusTestHarness } from "../testing/harness.js";
import { MarkdownView } from "./MarkdownView.js";
import { isLineBreakTag, remarkTableCellBreaks } from "./tableBreaks.js";

afterEach(cleanup);

/**
 * UI-064. Two properties, and the second is the one being qualified: `<br>`
 * inside a table cell becomes a break, and **nothing else** becomes anything.
 */

function draw(markdown: string): HTMLElement {
  const harness = createCorpusTestHarness({ fetch: () => Promise.reject(new Error("no network")) });
  return render(<MarkdownView markdown={markdown} />, { wrapper: harness.Wrapper }).container;
}

const CELL_TABLE = (cell: string): string => `| a | b |\n| - | - |\n| ${cell} | x |\n`;

describe("the `<br>` token", () => {
  it.each([["<br>"], ["<br/>"], ["<br />"], ["<BR>"], ["<Br />"]])(
    "%s in a cell renders as a line break, not as text",
    (tag) => {
      const container = draw(CELL_TABLE(`one${tag}two`));
      const cell = container.querySelector("tbody td");
      expect(cell?.querySelectorAll("br")).toHaveLength(1);
      // `mdast-util-to-hast` writes a `\n` beside the element, which is why the
      // text is compared without it: what matters is that no tag survived.
      expect(cell?.textContent?.replace(/\n/g, "")).toBe("onetwo");
      expect(cell?.textContent).not.toContain("<");
    },
  );

  it("keeps the surrounding text and marks intact", () => {
    const container = draw(CELL_TABLE("**bold<br>face**"));
    const cell = container.querySelector("tbody td");
    expect(cell?.querySelector("strong br")).not.toBeNull();
    expect(cell?.textContent?.replace(/\n/g, "")).toBe("boldface");
  });

  it("renders several breaks in one cell", () => {
    const container = draw(CELL_TABLE("a<br>b<br>c"));
    expect(container.querySelectorAll("tbody td br")).toHaveLength(2);
  });
});

describe("what stays inert", () => {
  /*
   * The property `MarkdownView`'s "no raw HTML path" claim rests on. Each of
   * these is markup a body could legitimately contain, and each must arrive as
   * characters — inside a cell, where the one exception lives, and outside it.
   */
  const HOSTILE: readonly (readonly [string, string])[] = [
    ["a script", "<script>alert(1)</script>"],
    ["an error-handler image", `<img src=x onerror="alert(1)">`],
    ["an iframe", `<iframe src="https://evil.example"></iframe>`],
    ["an anchor", `<a href="https://evil.example">click</a>`],
    ["a break with attributes", `<br class="x" onclick="alert(1)">`],
    ["a bold tag", "<b>bold</b>"],
  ];

  it.each(HOSTILE)("%s inside a table cell renders as text", (_name, markup) => {
    const container = draw(CELL_TABLE(markup));
    const cell = container.querySelector("tbody td");
    expect(cell?.textContent).toContain(markup);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("tbody td img")).toBeNull();
    expect(container.querySelector("tbody td a")).toBeNull();
    expect(container.querySelectorAll("tbody td br")).toHaveLength(0);
  });

  it.each(HOSTILE)("%s in prose renders as text", (_name, markup) => {
    const container = draw(`Look: ${markup}\n`);
    expect(container.textContent).toContain(markup);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("leaves a `<br>` in prose as the tag the author typed", () => {
    // The exception is scoped to the one position where markdown has no other
    // spelling for a break. In prose it has two, so this stays raw text.
    const container = draw("one<br>two\n");
    expect(container.querySelectorAll("br")).toHaveLength(0);
    expect(container.textContent).toContain("<br>");
  });

  it("leaves a `<br>` in a fenced block alone", () => {
    const container = draw("```\n| a |\n| - |\n| x<br>y |\n```\n");
    expect(container.querySelectorAll("pre br")).toHaveLength(0);
    expect(container.querySelector("pre")?.textContent).toContain("<br>");
  });
});

describe("the transform, over a tree built by hand", () => {
  it("carries a node's position onto the break it becomes", () => {
    const position = { start: { offset: 10 }, end: { offset: 14 } };
    const tree = {
      type: "root",
      children: [
        {
          type: "tableCell",
          children: [{ type: "html", value: "<br>", position }],
        },
      ],
    };
    remarkTableCellBreaks()(tree);
    expect(tree.children[0]?.children[0]).toEqual({ type: "break", position });
  });

  it("synthesises no position where the source node carried none", () => {
    const tree = {
      type: "root",
      children: [{ type: "tableCell", children: [{ type: "html", value: "<br>" }] }],
    };
    remarkTableCellBreaks()(tree);
    expect(tree.children[0]?.children[0]).toEqual({ type: "break" });
  });

  it("ignores anything that is not an mdast node", () => {
    // The plugin runs in a pipeline it does not own; a tree it cannot read is
    // left alone rather than thrown over.
    expect(() => {
      remarkTableCellBreaks()(null);
      remarkTableCellBreaks()("not a tree");
      remarkTableCellBreaks()({ notAType: true });
    }).not.toThrow();
  });
});

describe("isLineBreakTag", () => {
  it.each([
    ["<br>", true],
    ["<br/>", true],
    ["<br />", true],
    ["<BR>", true],
    ["<br\t/>", true],
    ["<br class='x'>", false],
    ["<brr>", false],
    ["</br>", false],
    ["<b>", false],
    ["br", false],
    ["", false],
  ])("%s → %s", (value, expected) => {
    expect(isLineBreakTag(value)).toBe(expected);
  });
});
