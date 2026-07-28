import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, parseMarkdown } from "./parse.js";
import { NODE, type PmNode } from "./schema.js";

/**
 * The markdown → ProseMirror walk, construct by construct.
 *
 * These are the assertions the *input shortcuts* rest on: `## x` has to become
 * a heading node and not a paragraph beginning with hashes, or a heading typed
 * live would be a heading on screen and prose on disk.
 */

function blocks(markdown: string): readonly PmNode[] {
  return parseMarkdown(markdown).content ?? [];
}

function first(markdown: string): PmNode {
  const node = blocks(markdown)[0];
  if (node === undefined) throw new Error(`no block parsed from ${JSON.stringify(markdown)}`);
  return node;
}

describe("blocks", () => {
  it("reads ATX headings at every level", () => {
    for (let level = 1; level <= 6; level += 1) {
      const node = first(`${"#".repeat(level)} title\n`);
      expect(node.type).toBe(NODE.heading);
      expect(node.attrs?.["level"]).toBe(level);
    }
  });

  it("reads setext headings as headings too", () => {
    expect(first("title\n=====\n").attrs?.["level"]).toBe(1);
    expect(first("title\n-----\n").attrs?.["level"]).toBe(2);
  });

  it("reads bullet lists", () => {
    const list = first("- a\n- b\n");
    expect(list.type).toBe(NODE.bulletList);
    expect(list.content).toHaveLength(2);
    expect(list.content?.[0]?.type).toBe(NODE.listItem);
  });

  it("reads ordered lists and keeps the first marker", () => {
    expect(first("1. a\n").attrs?.["start"]).toBe(1);
    expect(first("3. a\n4. b\n").attrs?.["start"]).toBe(3);
    expect(first("3. a\n").type).toBe(NODE.orderedList);
  });

  it("reads nested lists as nested list nodes", () => {
    const list = first("- a\n  - b\n");
    const item = list.content?.[0];
    expect(item?.content?.[1]?.type).toBe(NODE.bulletList);
  });

  it("reads a task list as its own node with per-item state", () => {
    const list = first("- [ ] open\n- [x] done\n");
    expect(list.type).toBe(NODE.taskList);
    expect(list.content?.[0]?.attrs?.["checked"]).toBe(false);
    expect(list.content?.[1]?.attrs?.["checked"]).toBe(true);
  });

  it("reads fenced code with and without a language", () => {
    const withLang = first("```ts\nconst a = 1;\n```\n");
    expect(withLang.type).toBe(NODE.codeBlock);
    expect(withLang.attrs?.["language"]).toBe("ts");
    expect(withLang.content?.[0]?.text).toBe("const a = 1;");
    expect(first("```\nx\n```\n").attrs?.["language"]).toBeNull();
  });

  it("reads a blockquote containing a list", () => {
    const quote = first("> text\n>\n> - a\n");
    expect(quote.type).toBe(NODE.blockquote);
    expect(quote.content?.[1]?.type).toBe(NODE.bulletList);
  });

  it("reads thematic breaks", () => {
    expect(first("---\n").type).toBe(NODE.horizontalRule);
  });

  it("reads a table, keeping the header row and the alignment", () => {
    const table = first("| a | b |\n| :- | -: |\n| 1 | 2 |\n");
    expect(table.type).toBe(NODE.table);
    expect(table.attrs?.["align"]).toEqual(["left", "right"]);
    expect(table.content?.[0]?.content?.[0]?.type).toBe(NODE.tableHeader);
    expect(table.content?.[1]?.content?.[0]?.type).toBe(NODE.tableCell);
  });

  it("keeps a construct it does not model as its own source", () => {
    const raw = first("<div>hello</div>\n");
    expect(raw.type).toBe(NODE.rawBlock);
    expect(raw.attrs?.["source"]).toBe("<div>hello</div>");
  });
});

describe("inline", () => {
  function inlineOf(markdown: string): readonly PmNode[] {
    return first(markdown).content ?? [];
  }

  it("applies bold, italic, code and strike as marks", () => {
    expect(inlineOf("**b**\n")[0]?.marks?.[0]?.type).toBe("bold");
    expect(inlineOf("*i*\n")[0]?.marks?.[0]?.type).toBe("italic");
    expect(inlineOf("`c`\n")[0]?.marks?.[0]?.type).toBe("code");
    expect(inlineOf("~~s~~\n")[0]?.marks?.[0]?.type).toBe("strike");
  });

  it("applies a link as a mark carrying its destination", () => {
    const mark = inlineOf("[text](https://x.test)\n")[0]?.marks?.[0];
    expect(mark?.type).toBe("link");
    expect(mark?.attrs?.["href"]).toBe("https://x.test");
  });

  it("reads a bare URL as a link too", () => {
    const mark = inlineOf("see https://x.test now\n")[1]?.marks?.[0];
    expect(mark?.attrs?.["href"]).toBe("https://x.test");
  });

  it("reads a hard break", () => {
    expect(inlineOf("a\\\nb\n")[1]?.type).toBe(NODE.hardBreak);
  });

  it("reads an image as an inline node", () => {
    const image = inlineOf("![alt](x.png)\n")[0];
    expect(image?.type).toBe(NODE.image);
    expect(image?.attrs?.["src"]).toBe("x.png");
    expect(image?.attrs?.["alt"]).toBe("alt");
  });

  describe("references (SPEC.md §5)", () => {
    it("reads the bare form as a ref node with no alias", () => {
      const ref = inlineOf("see [[doc_a1b2c3]] now\n")[1];
      expect(ref?.type).toBe(NODE.docRef);
      expect(ref?.attrs).toEqual({ id: "doc_a1b2c3", alias: null });
    });

    it("reads the alias form", () => {
      const ref = inlineOf("see [[doc_a1b2c3|as text]] now\n")[1];
      expect(ref?.attrs).toEqual({ id: "doc_a1b2c3", alias: "as text" });
    });

    it("leaves a non-id bracket pair as literal text", () => {
      // The kit's grammar decides what a ref is; `[[not an id]]` is prose.
      const nodes = inlineOf("see [[not an id]] now\n");
      expect(nodes.every((node) => node.type !== NODE.docRef)).toBe(true);
    });

    it("does not read a ref inside a code span", () => {
      const nodes = inlineOf("`[[doc_a1b2c3]]`\n");
      expect(nodes[0]?.type).toBe(NODE.text);
      expect(nodes[0]?.text).toBe("[[doc_a1b2c3]]");
    });

    it("reads a ref inside a link's text", () => {
      const nodes = inlineOf("[see [[doc_a1b2c3]]](https://x.test)\n");
      const ref = nodes.find((node) => node.type === NODE.docRef);
      expect(ref).toBeDefined();
      expect(ref?.marks?.[0]?.type).toBe("link");
    });

    it("reads a ref inside a list item and a heading", () => {
      const list = parseMarkdown("- [[doc_a1b2c3]]\n").content?.[0];
      expect(list?.content?.[0]?.content?.[0]?.content?.[0]?.type).toBe(NODE.docRef);
      const heading = parseMarkdown("# [[doc_a1b2c3]]\n").content?.[0];
      expect(heading?.content?.[0]?.type).toBe(NODE.docRef);
    });
  });
});

describe("recognising a markdown paste", () => {
  it("recognises block constructs at the start of a line", () => {
    for (const text of [
      "## heading",
      "text\n### heading",
      "- bullet",
      "* bullet",
      "+ bullet",
      "1. step",
      "2) step",
      "> quotation",
      "```ts\nx\n```",
      "~~~\nx\n~~~",
      "| a | b |",
      "[^1]: a footnote",
    ]) {
      expect(looksLikeMarkdown(text)).toBe(true);
    }
  });

  it("recognises inline constructs anywhere", () => {
    for (const text of [
      "some **bold** text",
      "some __bold__ text",
      "some ~~struck~~ text",
      "some `code` text",
      "a [link](https://x.test)",
      "an ![image](x.png)",
      "a [[doc_a1b2c3]] reference",
    ]) {
      expect(looksLikeMarkdown(text)).toBe(true);
    }
  });

  it("leaves ordinary prose alone", () => {
    // Pasted prose has no structure to find, and running it through the parser
    // could only invent some.
    for (const text of [
      "Just a sentence.",
      "Two sentences. And a second one.",
      "https://example.com",
      "snake_case_identifier",
      "2 * 3 = 6",
      "a - b is a subtraction",
      "",
    ]) {
      expect(looksLikeMarkdown(text)).toBe(false);
    }
  });
});
