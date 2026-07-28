import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parse.js";
import { refSource } from "./refNode.js";
import {
  canonicalizeMarkdown,
  LEAF_NODES,
  normalizeBody,
  serializeDoc,
  TEXT_BLOCKS,
  toMdast,
} from "./serialize.js";
import { corpusSchema, NODE, type PmNode } from "./schema.js";

/**
 * The ProseMirror → markdown walk, node by node and mark by mark.
 *
 * Where `roundtrip.test.ts` proves the two directions agree, this proves the
 * output is the *stated* shape — the normalisation rules of sprint-011 TEST-8,
 * asserted individually so a regression names the rule it broke.
 */

function doc(...content: readonly PmNode[]): PmNode {
  return { type: NODE.doc, content };
}

function paragraph(...content: readonly PmNode[]): PmNode {
  return { type: NODE.paragraph, content };
}

function text(value: string, ...marks: readonly string[]): PmNode {
  return {
    type: NODE.text,
    text: value,
    ...(marks.length === 0 ? {} : { marks: marks.map((type) => ({ type })) }),
  };
}

describe("normalisation rules", () => {
  it("emits ATX headings, never setext", () => {
    expect(canonicalizeMarkdown("Title\n=====\n")).toBe("# Title\n");
    expect(canonicalizeMarkdown("Title\n-----\n")).toBe("## Title\n");
  });

  it("emits `- ` bullets whatever the source used", () => {
    expect(canonicalizeMarkdown("* a\n* b\n")).toBe("- a\n- b\n");
    expect(canonicalizeMarkdown("+ a\n+ b\n")).toBe("- a\n- b\n");
    expect(canonicalizeMarkdown("* a\n  * b\n")).toBe("- a\n  - b\n");
  });

  it("emits `**` for bold and `*` for italic", () => {
    expect(canonicalizeMarkdown("__b__ and _i_\n")).toBe("**b** and *i*\n");
  });

  it("keeps an ordered list's first marker and increments from it", () => {
    expect(canonicalizeMarkdown("3. a\n4. b\n")).toBe("3. a\n4. b\n");
    expect(canonicalizeMarkdown("1) a\n2) b\n")).toBe("1. a\n2. b\n");
  });

  it("emits backtick fences and preserves the language string", () => {
    expect(canonicalizeMarkdown("~~~js\nx\n~~~\n")).toBe("```js\nx\n```\n");
    expect(canonicalizeMarkdown("    indented\n")).toBe("```\nindented\n```\n");
  });

  it("puts exactly one blank line between block nodes", () => {
    expect(canonicalizeMarkdown("one\n\n\n\n\ntwo\n")).toBe("one\n\ntwo\n");
  });

  it("leaves no trailing whitespace on any line", () => {
    const output = canonicalizeMarkdown("a line   \nnext   \n\n- item   \n");
    for (const line of output.split("\n")) expect(line).toBe(line.replace(/[ \t]+$/, ""));
  });

  it("ends the file with exactly one newline", () => {
    expect(canonicalizeMarkdown("body")).toBe("body\n");
    expect(canonicalizeMarkdown("body\n\n\n")).toBe("body\n");
  });

  it("normalises a body to at most one trailing newline", () => {
    expect(normalizeBody("a\n\n\n")).toBe("a\n");
    expect(normalizeBody("a")).toBe("a\n");
    expect(normalizeBody("")).toBe("");
    expect(normalizeBody("\n\n")).toBe("");
  });
});

describe("nodes", () => {
  it("serialises nested bullet lists at the marker width", () => {
    expect(canonicalizeMarkdown("- a\n  - b\n    - c\n")).toBe("- a\n  - b\n    - c\n");
  });

  it("serialises nested ordered lists at the marker width", () => {
    expect(canonicalizeMarkdown("1. a\n   1. b\n")).toBe("1. a\n   1. b\n");
  });

  it("serialises a blockquote containing a list", () => {
    expect(canonicalizeMarkdown("> text\n>\n> - a\n> - b\n")).toBe("> text\n>\n> - a\n> - b\n");
  });

  it("serialises a code fence with its language", () => {
    const source = doc({
      type: NODE.codeBlock,
      attrs: { language: "python" },
      content: [text("x = 1")],
    });
    expect(serializeDoc(source)).toBe("```python\nx = 1\n```\n");
  });

  it("serialises a code fence with no language as a bare fence", () => {
    const source = doc({ type: NODE.codeBlock, attrs: { language: null }, content: [text("x")] });
    expect(serializeDoc(source)).toBe("```\nx\n```\n");
  });

  it("serialises a horizontal rule as three dashes", () => {
    expect(serializeDoc(doc({ type: NODE.horizontalRule }))).toBe("---\n");
  });

  it("serialises a hard break as a trailing backslash", () => {
    const source = doc(paragraph(text("a"), { type: NODE.hardBreak }, text("b")));
    expect(serializeDoc(source)).toBe("a\\\nb\n");
  });

  it("serialises a task list with its checked state", () => {
    expect(canonicalizeMarkdown("- [x] done\n- [ ] open\n")).toBe("- [x] done\n- [ ] open\n");
  });

  it("keeps an unmodelled construct verbatim", () => {
    const source = doc({ type: NODE.rawBlock, attrs: { source: "<hr data-x>" } });
    expect(serializeDoc(source)).toBe("<hr data-x>\n");
  });
});

describe("marks", () => {
  it("merges a mark spanning several text nodes into one emphasis", () => {
    const source = doc(paragraph(text("a", "bold"), text("b", "bold")));
    expect(serializeDoc(source)).toBe("**ab**\n");
  });

  it("nests a link outside emphasis", () => {
    const source = doc(
      paragraph({
        type: NODE.text,
        text: "x",
        marks: [{ type: "italic" }, { type: "link", attrs: { href: "https://x.test" } }],
      }),
    );
    expect(serializeDoc(source)).toBe("[*x*](https://x.test)\n");
  });

  it("serialises a code mark as a code span, not as nested emphasis", () => {
    const source = doc(paragraph(text("a * b", "code")));
    expect(serializeDoc(source)).toBe("`a * b`\n");
  });

  it("keeps a bare URL bare rather than rewriting it as an autolink", () => {
    expect(canonicalizeMarkdown("see https://example.com now\n")).toBe(
      "see https://example.com now\n",
    );
  });

  it("writes a link form when a bare URL would not be read back as one", () => {
    // No word boundary in front: GFM would read `x https://…` but not
    // `x(https://…` glued to a word character, so the link form is the honest
    // output there.
    const source = doc(
      paragraph(text("word"), {
        type: NODE.text,
        text: "https://x.test",
        marks: [{ type: "link", attrs: { href: "https://x.test" } }],
      }),
    );
    expect(serializeDoc(source)).toBe("word[https://x.test](https://x.test)\n");
  });
});

describe("references (SPEC.md §5)", () => {
  it("spells the bracket form from the attributes", () => {
    expect(refSource({ id: "doc_a", alias: null })).toBe("[[doc_a]]");
    expect(refSource({ id: "doc_a", alias: "as text" })).toBe("[[doc_a|as text]]");
    expect(refSource({ id: "doc_a", alias: "" })).toBe("[[doc_a]]");
  });

  it("serialises a ref from its attributes and never from its rendered text", () => {
    // The node carries no title at all — which is the guarantee: renaming the
    // target cannot change a byte of the parent's file.
    const source = doc(paragraph({ type: NODE.docRef, attrs: { id: "doc_a1b2c3", alias: null } }));
    expect(serializeDoc(source)).toBe("[[doc_a1b2c3]]\n");
  });

  it("serialises the alias form from the attributes", () => {
    const source = doc(
      paragraph({ type: NODE.docRef, attrs: { id: "doc_a1b2c3", alias: "the rate" } }),
    );
    expect(serializeDoc(source)).toBe("[[doc_a1b2c3|the rate]]\n");
  });

  it("does not escape the brackets a ref emits", () => {
    expect(canonicalizeMarkdown("see [[doc_a1b2c3]] now\n")).toBe("see [[doc_a1b2c3]] now\n");
  });

  it("keeps a ref to a nonexistent id byte-identical", () => {
    expect(canonicalizeMarkdown("[[doc_deadbeef]]\n")).toBe("[[doc_deadbeef]]\n");
  });
});

describe("the mdast bridge", () => {
  it("produces a root whose children mirror the document's blocks", () => {
    const tree = toMdast(doc(paragraph(text("a")), { type: NODE.horizontalRule }));
    expect(tree.type).toBe("root");
    expect(tree.children.map((child) => child.type)).toEqual(["paragraph", "thematicBreak"]);
  });

  it("is the same tree the parser would have produced", () => {
    const markdown = "# T\n\n- a\n- b\n";
    expect(JSON.stringify(toMdast(parseMarkdown(markdown)))).toBe(
      JSON.stringify(toMdast(parseMarkdown(canonicalizeMarkdown(markdown)))),
    );
  });
});

describe("the position trace", () => {
  it("is an option on this serializer, and changes nothing about its output", () => {
    const markdown = "# T\n\nSome **bold** text and [[doc_a1b2c3]].\n\n- a\n- b\n";
    const source = parseMarkdown(markdown);
    expect(serializeDoc(source, { trace: true }).markdown).toBe(serializeDoc(source));
  });

  it("agrees with the real schema about which nodes are leaves", () => {
    const schema = corpusSchema();
    const leaves = Object.values(schema.nodes)
      .filter((type) => type.isLeaf && !type.isText)
      .map((type) => type.name)
      .sort();
    expect([...LEAF_NODES].sort()).toEqual(leaves);
  });

  it("agrees with the real schema about which nodes are textblocks", () => {
    const schema = corpusSchema();
    const textblocks = Object.values(schema.nodes)
      .filter((type) => type.isTextblock)
      .map((type) => type.name)
      .sort();
    expect([...TEXT_BLOCKS].sort()).toEqual(textblocks);
  });

  it("answers an empty trace for an empty document", () => {
    expect(serializeDoc(parseMarkdown(""), { trace: true })).toEqual({ markdown: "", trace: [] });
  });

  it("addresses a run by both of its coordinate systems", () => {
    const traced = serializeDoc(parseMarkdown("hello\n"), { trace: true });
    expect(traced.trace).toEqual([
      { pmFrom: 1, pmTo: 6, mdStart: 0, mdEnd: 5, block: 1, atomic: false },
    ]);
  });

  it("splits an escaped run so both sides of the split stay one-for-one", () => {
    // `escape.ts` writes `\*`; the run either side of the inserted backslash is
    // still exact, which is what keeps the arithmetic inside a run honest.
    const traced = serializeDoc(parseMarkdown("a \\*b\\* c\n"), { trace: true });
    for (const run of traced.trace) {
      expect(run.mdEnd - run.mdStart).toBe(run.pmTo - run.pmFrom);
      expect(traced.markdown.slice(run.mdStart, run.mdEnd)).not.toContain("\\");
    }
    // `a \*b\* c` is three runs — "a ", "b", " c" — with the two inserted
    // backslashes belonging to neither.
    expect(traced.trace).toHaveLength(3);
  });
});
