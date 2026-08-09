import { describe, expect, it } from "vitest";
import { CHARACTER_REFERENCE } from "./escape.js";
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

  /**
   * UI-057, spun out of AGENT-012. The property that keeps autosave from
   * **corrupting** a document: a fence closes at the first line whose backtick
   * run is at least as long as the opener, so a payload carrying its own fence
   * needs a wider one. The widening is `remark-stringify`'s and `serialize.ts`
   * deliberately delegates to it — which is exactly why it needs a test here.
   * Nothing would fail if a later change hand-rolled the printer or turned the
   * option off; documents would simply start splitting into several blocks on
   * save, and the copy button would hand over fragments.
   */
  describe("a fence whose payload contains a fence", () => {
    const blockCount = (markdown: string): number =>
      (parseMarkdown(markdown).content ?? []).filter((node) => node.type === NODE.codeBlock).length;

    it("widens past a three-backtick payload and stays one block", () => {
      const payload = "## Output format\n\n```\nowner | action | topic\n```";
      const source = doc({
        type: NODE.codeBlock,
        attrs: { language: "prompt" },
        content: [text(payload)],
      });

      const printed = serializeDoc(source);

      expect(printed).toBe(`\`\`\`\`prompt\n${payload}\n\`\`\`\`\n`);
      expect(blockCount(printed)).toBe(1);
    });

    it("counts the longest run rather than assuming four", () => {
      const payload = "````\nnested four\n````";
      const source = doc({
        type: NODE.codeBlock,
        attrs: { language: null },
        content: [text(payload)],
      });

      const printed = serializeDoc(source);

      expect(printed).toBe(`\`\`\`\`\`\n${payload}\n\`\`\`\`\`\n`);
      expect(blockCount(printed)).toBe(1);
    });

    it("keeps the widened fence across a full round trip", () => {
      const markdown = "````prompt\n## Heading\n\n```\ninner\n```\n````\n";

      expect(blockCount(markdown)).toBe(1);
      expect(canonicalizeMarkdown(markdown)).toBe(markdown);
      expect(blockCount(canonicalizeMarkdown(markdown))).toBe(1);
    });
  });

  it("serialises a horizontal rule as three dashes", () => {
    expect(serializeDoc(doc({ type: NODE.horizontalRule }))).toBe("---\n");
  });

  it("serialises a hard break as a trailing backslash", () => {
    const source = doc(paragraph(text("a"), { type: NODE.hardBreak }, text("b")));
    expect(serializeDoc(source)).toBe("a\\\nb\n");
  });

  /**
   * UI-064. Not a stylistic choice: the printer's default answer inside a cell
   * is a *space*, because every markdown spelling of a break is a newline and a
   * newline ends the row — so before this rule the user's line break was
   * silently deleted on the next save.
   */
  describe("a hard break inside a table cell", () => {
    function cellTable(...cell: readonly PmNode[]): PmNode {
      const td = (content: readonly PmNode[]): PmNode => ({
        type: NODE.tableCell,
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: [{ type: NODE.paragraph, content }],
      });
      return doc({
        type: NODE.table,
        attrs: { align: [null] },
        content: [
          { type: NODE.tableRow, content: [td([text("h")])] },
          { type: NODE.tableRow, content: [td(cell)] },
        ],
      });
    }

    it("is written as `<br>`", () => {
      const source = cellTable(text("a"), { type: NODE.hardBreak }, text("b"));
      expect(serializeDoc(source)).toContain("| a<br>b |");
    });

    it("is written as `<br>` when it is nested inside a mark", () => {
      // The break carries the mark, so it stays *inside* the emphasis run —
      // which is the case a non-recursive rewrite would miss.
      const source = cellTable(
        text("a", "bold"),
        { type: NODE.hardBreak, marks: [{ type: "bold" }] },
        text("b", "bold"),
      );
      expect(serializeDoc(source)).toContain("**a<br>b**");
    });

    it("round-trips through the parser unchanged", () => {
      const markdown = "| h      |\n| ------ |\n| a<br>b |\n";
      expect(serializeDoc(parseMarkdown(markdown))).toBe(markdown);
    });

    it("leaves a break outside a table as a trailing backslash", () => {
      const source = doc(paragraph(text("a"), { type: NODE.hardBreak }, text("b")));
      expect(serializeDoc(source)).not.toContain("<br>");
    });
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

/**
 * The whitespace markdown has no spelling for.
 *
 * Every case here was an HTML character reference on disk before the tree was
 * normalised (`**alpha beta&#x20;**&#x67;amma`) — a permanent, compounding
 * corruption of the body for a first-minute action. The rule the assertions
 * state: a space at a mark boundary moves *outside* the markers, a blank at a
 * line edge is dropped, and nothing is ever encoded as an entity.
 */
describe("whitespace at a boundary markdown cannot spell", () => {
  const ref = (id: string): PmNode => ({ type: NODE.docRef, attrs: { id, alias: null } });

  it("moves a trailing space at a mark boundary outside the markers", () => {
    // Select "alpha beta " — the trailing space included, as an ordinary drag
    // produces — and press B.
    const source = doc(paragraph(text("alpha beta ", "bold"), text("gamma delta")));
    expect(serializeDoc(source)).toBe("**alpha beta** gamma delta\n");
  });

  it("moves a leading space at a mark boundary outside the markers", () => {
    const source = doc(paragraph(text("alpha"), text(" beta gamma", "bold"), text(" delta")));
    expect(serializeDoc(source)).toBe("alpha **beta gamma** delta\n");
  });

  it("drops a mark that covers nothing but whitespace", () => {
    expect(serializeDoc(doc(paragraph(text("a"), text(" ", "bold"), text("b"))))).toBe("a b\n");
  });

  it("drops a trailing space at the end of a block, marked or not", () => {
    expect(serializeDoc(doc(paragraph(text("alpha beta ", "bold"))))).toBe("**alpha beta**\n");
    expect(serializeDoc(doc(paragraph(text("alpha beta "))))).toBe("alpha beta\n");
  });

  it("drops a leading blank at the start of a block, marked or not", () => {
    expect(serializeDoc(doc(paragraph(text(" alpha", "bold"), text(" beta"))))).toBe(
      "**alpha** beta\n",
    );
    expect(serializeDoc(doc(paragraph(text("    four spaces"))))).toBe("four spaces\n");
  });

  it("hoists through nested marks, innermost first", () => {
    const source = doc(paragraph(text("alpha ", "bold", "italic"), text("beta")));
    expect(serializeDoc(source)).toBe("***alpha*** beta\n");
  });

  it("hoists out of strikethrough, which flanks by the same rules", () => {
    const source = doc(paragraph(text("gone ", "strike"), text("next")));
    expect(serializeDoc(source)).toBe("~~gone~~ next\n");
  });

  it("hoists in a heading and in a list item, not only in a paragraph", () => {
    const heading = doc({
      type: NODE.heading,
      attrs: { level: 2 },
      content: [text("Head ", "bold"), text("er")],
    });
    expect(serializeDoc(heading)).toBe("## **Head** er\n");
    const list = doc({
      type: NODE.bulletList,
      content: [{ type: NODE.listItem, content: [paragraph(text("item ", "bold"), text("tail"))] }],
    });
    expect(serializeDoc(list)).toBe("- **item** tail\n");
  });

  it("survives a ref inserted straight after a bold run", () => {
    // The second path the evaluator found: type before a bold run, then insert
    // a `[[ref]]` from the `[[` menu.
    const source = doc(
      paragraph(text("link: ", "bold"), ref("doc_mbc52nvo"), text("6.4%", "bold"), text(" week.")),
    );
    expect(serializeDoc(source)).toBe("**link:** [[doc_mbc52nvo]]**6.4%** week.\n");
  });

  it("leaves a space that is not at a boundary exactly where it is", () => {
    expect(serializeDoc(doc(paragraph(text("a  b"))))).toBe("a  b\n");
    expect(serializeDoc(doc(paragraph(text("one ", "bold"), text("two", "bold"))))).toBe(
      "**one two**\n",
    );
    // Inside a code span whitespace is content, and the span is a leaf.
    expect(serializeDoc(doc(paragraph(text("code ", "code"), text("next"))))).toBe("`code `next\n");
  });

  it("moves a no-break space too, and never deletes one", () => {
    // CommonMark's flanking rules count Unicode whitespace, so a no-break
    // space against a `**` closes nothing either. It is visible content, so it
    // moves out of the markers and stays: an ASCII blank at a line edge is
    // dropped because markdown itself drops it, and this one is not.
    const nbsp = String.fromCharCode(0xa0);
    const source = doc(paragraph(text(`alpha${nbsp}`, "bold"), text("beta")));
    expect(serializeDoc(source)).toBe(`**alpha**${nbsp}beta\n`);
    expect(serializeDoc(doc(paragraph(text(`alpha${nbsp}`, "bold"))))).toBe(`**alpha**${nbsp}\n`);
  });

  it("drops the blanks around a soft break rather than encoding them", () => {
    expect(serializeDoc(doc(paragraph(text("a  \nb"))))).toBe("a\nb\n");
    expect(serializeDoc(doc(paragraph(text("a\n  b"))))).toBe("a\nb\n");
    const hard = doc(paragraph(text("a"), { type: NODE.hardBreak }, text(" b")));
    expect(serializeDoc(hard)).toBe("a\\\nb\n");
  });

  it("writes no character reference next to any escapeworthy character", () => {
    const neighbours = ["\\x", "`x", "*x", "_x", "~x", "<x", "&amp", "[x](y)", "#x", "- x", "1. x"];
    for (const neighbour of neighbours) {
      for (const mark of ["bold", "italic", "strike"] as const) {
        const trailing = serializeDoc(doc(paragraph(text("a ", mark), text(neighbour))));
        const leading = serializeDoc(doc(paragraph(text(neighbour), text(" a", mark))));
        for (const output of [trailing, leading]) {
          expect(output, `${mark} beside ${JSON.stringify(neighbour)}`).not.toMatch(
            CHARACTER_REFERENCE,
          );
          // And what it does write still means what the document said.
          expect(canonicalizeMarkdown(output)).toBe(output);
        }
      }
    }
  });

  it("heals a body that already carries the entities", () => {
    expect(canonicalizeMarkdown("**alpha beta&#x20;**&#x67;amma delta\n")).toBe(
      "**alpha beta** gamma delta\n",
    );
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

/**
 * A list item's own blocks, and the blank lines that keep them its own (UI-103).
 *
 * The items themselves are printed tight, and the printer's default is to print
 * an item's *children* tight too — a bare newline between them. That is right
 * for a nested list under its lead paragraph and wrong nearly everywhere else,
 * because the block on the left keeps reading the line below it: a paragraph
 * after a nested list is a lazy continuation of the last nested item, a
 * paragraph after a blockquote is swallowed by the quotation, a paragraph after
 * a table becomes another row of it. §11 gives the editor autosave and no save
 * button, so each of those reaches the user's own file the first time anything
 * is typed in the document.
 *
 * **Idempotence is the property, because it is checkable without knowing the
 * right answer**: whatever spelling the printer chooses, printing its own output
 * must not choose differently. It is asserted here over every ordered pair of
 * block types rather than for a fixture, since a round trip that is not a fixed
 * point for one construct is unlikely to be one for exactly one construct — the
 * sweep that found this found the same failure in five other shapes.
 */
describe("blocks inside a list item", () => {
  function listItem(...content: readonly PmNode[]): PmNode {
    return { type: NODE.listItem, content };
  }

  function bulletList(...items: readonly PmNode[]): PmNode {
    return { type: NODE.bulletList, content: items };
  }

  function cell(type: string, value: string): PmNode {
    return {
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [paragraph(text(value))],
    };
  }

  /** One node of every block type the schema models, as an item's child. */
  const BLOCKS: Readonly<Record<string, PmNode>> = {
    paragraph: paragraph(text("Bee prose.")),
    bulletList: bulletList(listItem(paragraph(text("Bee bullet.")))),
    orderedList: {
      type: NODE.orderedList,
      attrs: { start: 1 },
      content: [listItem(paragraph(text("Bee number.")))],
    },
    taskList: {
      type: NODE.taskList,
      content: [
        { type: NODE.taskItem, attrs: { checked: false }, content: [paragraph(text("Bee task."))] },
      ],
    },
    blockquote: { type: NODE.blockquote, content: [paragraph(text("Bee quoted."))] },
    codeBlock: {
      type: NODE.codeBlock,
      attrs: { language: "js" },
      content: [text("const bee = 1;")],
    },
    heading: { type: NODE.heading, attrs: { level: 2 }, content: [text("Bee heading")] },
    horizontalRule: { type: NODE.horizontalRule },
    table: {
      type: NODE.table,
      attrs: { align: [null, null] },
      content: [
        {
          type: NODE.tableRow,
          content: [cell(NODE.tableHeader, "h1"), cell(NODE.tableHeader, "h2")],
        },
        { type: NODE.tableRow, content: [cell(NODE.tableCell, "c1"), cell(NODE.tableCell, "c2")] },
      ],
    },
    rawBlock: { type: NODE.rawBlock, attrs: { source: "<div>Bee raw.</div>" } },
  };

  const PAIRS = Object.keys(BLOCKS).flatMap((left) =>
    Object.keys(BLOCKS).map((right) => [left, right] as const),
  );

  /** An item holding `left` then `right` after its lead paragraph, with a sibling after it. */
  function itemHolding(left: string, right: string): PmNode {
    const clone = (node: PmNode): PmNode => JSON.parse(JSON.stringify(node)) as PmNode;
    return doc(
      bulletList(
        listItem(
          paragraph(text("Aye lead.")),
          clone(BLOCKS[left] as PmNode),
          clone(BLOCKS[right] as PmNode),
        ),
        listItem(paragraph(text("Zed second."))),
      ),
    );
  }

  it("covers every block type the schema lets an item hold", () => {
    // Read out of the real schema rather than listed here, so a block type the
    // editor grows later arrives as a failure in this file instead of as an
    // adjacency nobody thought to write a case for — which is how the reported
    // one shipped.
    const schema = corpusSchema();
    const item = schema.nodes["listItem"];
    const lead = item?.contentMatch.matchType(schema.nodes["paragraph"] as never);
    const admitted = Object.values(schema.nodes)
      .filter((type) => lead?.matchType(type) !== undefined && lead?.matchType(type) !== null)
      .map((type) => type.name)
      .sort();
    expect(Object.keys(BLOCKS).sort()).toEqual(admitted);
  });

  it.each(PAIRS)("reads back unchanged with %s then %s in one item", (left, right) => {
    const source = itemHolding(left, right);
    expect(parseMarkdown(serializeDoc(source))).toEqual(source);
  });

  it.each(PAIRS)("prints the same twice with %s then %s in one item", (left, right) => {
    const once = serializeDoc(itemHolding(left, right));
    expect(canonicalizeMarkdown(once)).toBe(once);
  });

  it("keeps a nested list flush under the paragraph that leads it", () => {
    // The one join that stays tight: this is what hand-written markdown looks
    // like, and widening it would rewrite every nested list in the corpus.
    expect(canonicalizeMarkdown("- outer\n  - nested\n")).toBe("- outer\n  - nested\n");
  });

  it("leaves two same-marker lists to the printer, which knows they cannot be blank-separated", () => {
    // A blank line between them merges them into one list; `<!---->` is the
    // only spelling that keeps them two, and the printer owns that rule.
    const source = doc(
      bulletList(
        listItem(
          paragraph(text("lead")),
          bulletList(listItem(paragraph(text("a")))),
          bulletList(listItem(paragraph(text("b")))),
        ),
      ),
    );
    expect(parseMarkdown(serializeDoc(source))).toEqual(source);
  });
});

/**
 * The construct from the report, in the spellings it actually occurs in.
 *
 * A further paragraph of an outer list item after a nested sublist. Each of
 * these is markdown as a person writes it, and each one was rewritten by the
 * first save before UI-103: the blank line went, and the *next* save read the
 * paragraph back as a continuation of the nested item and indented it to match.
 */
describe("a list item's trailing paragraph after a nested sublist", () => {
  const SHAPES: readonly (readonly [string, string])[] = [
    [
      "unordered, one level",
      "- Outer bullet leads in.\n" +
        "  - Nested bullet one.\n" +
        "  - Nested bullet two.\n" +
        "\n" +
        "  A trailing paragraph of the outer item.\n" +
        "- Second outer bullet.\n",
    ],
    [
      "ordered, one level",
      "1. Outer item leads in.\n" +
        "   1. Nested step one.\n" +
        "   2. Nested step two.\n" +
        "\n" +
        "   A trailing paragraph of the outer item.\n" +
        "2. Second outer item.\n",
    ],
    [
      "ordered outer, unordered nested",
      "1. Outer item leads in.\n" +
        "   - Nested bullet.\n" +
        "\n" +
        "   A trailing paragraph of the outer item.\n",
    ],
    [
      "three levels, trailing paragraph on the outermost",
      "- Outer.\n" +
        "  - Middle.\n" +
        "    - Inner.\n" +
        "\n" +
        "  A trailing paragraph of the outer item.\n",
    ],
    [
      "three levels, trailing paragraph on the middle item",
      "- Outer.\n" +
        "  - Middle.\n" +
        "    - Inner.\n" +
        "\n" +
        "    A trailing paragraph of the middle item.\n",
    ],
    [
      "task list",
      "- [ ] Task leads in.\n" +
        "  - [x] Nested task.\n" +
        "\n" +
        "  A trailing paragraph of the outer task.\n",
    ],
    [
      "no trailing paragraph — the neighbour that must not change",
      "- Outer bullet leads in.\n  - Nested bullet one.\n  - Nested bullet two.\n- Second outer bullet.\n",
    ],
  ];

  it.each(SHAPES)("%s survives the round trip byte for byte", (_name, markdown) => {
    expect(canonicalizeMarkdown(markdown)).toBe(markdown);
  });

  it.each(SHAPES)("%s is a fixed point of a second printing", (_name, markdown) => {
    const once = canonicalizeMarkdown(markdown);
    expect(canonicalizeMarkdown(once)).toBe(once);
  });

  it("keeps the paragraph at the outer item's level, not the nested one's", () => {
    // The loss stated as structure rather than as bytes: before the fix, the
    // second printing moved this paragraph inside the nested list.
    const [, markdown] = SHAPES[0] as readonly [string, string];
    const item = parseMarkdown(canonicalizeMarkdown(markdown)).content?.[0]?.content?.[0];
    expect(item?.content?.map((child) => child.type)).toEqual([
      NODE.paragraph,
      NODE.bulletList,
      NODE.paragraph,
    ]);
    expect(item?.content?.[2]?.content?.[0]?.text).toBe("A trailing paragraph of the outer item.");
  });
});
