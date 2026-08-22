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

  /**
   * The character that decides where a row ends (UI-104).
   *
   * A `|` inside a cell is content only when it is escaped; bare, the next read
   * takes it as a delimiter and the row gains a cell. The printer then lays the
   * table out as a matrix as wide as its widest row, so **the header gains a
   * column and every row in the table shifts** — on the first save, from one
   * pipe on one line. Fourteen documents in this repo were being rewritten that
   * way when this was measured.
   *
   * `remark-stringify` escapes the pipe for everything it knows about, and
   * `mdast-util-gfm-table` patches even `inlineCode` for it. Neither can do it
   * for the four constructs this module invented, all of which print verbatim —
   * and one of them, `[[doc_x|alias]]`, has a pipe in its ordinary spelling.
   */
  describe("a pipe inside a table cell", () => {
    const td = (type: string, content: readonly PmNode[]): PmNode => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: NODE.paragraph, content }],
    });

    /** A two-column table whose one body row holds `cells`. */
    function table(...cells: readonly (readonly PmNode[])[]): PmNode {
      return doc({
        type: NODE.table,
        attrs: { align: [null, null] },
        content: [
          {
            type: NODE.tableRow,
            content: [td(NODE.tableHeader, [text("a")]), td(NODE.tableHeader, [text("b")])],
          },
          { type: NODE.tableRow, content: cells.map((cell) => td(NODE.tableCell, cell)) },
        ],
      });
    }

    /** The cell count of every row of every table in a body, in order. */
    function rowWidths(markdown: string): number[][] {
      return (parseMarkdown(markdown).content ?? [])
        .filter((node) => node.type === NODE.table)
        .map((node) => (node.content ?? []).map((row) => (row.content ?? []).length));
    }

    it("keeps a reference's alias inside its own cell", () => {
      const source = table(
        [{ type: NODE.docRef, attrs: { id: "doc_ab12cd34", alias: "the alias" } }],
        [text("z")],
      );

      const printed = serializeDoc(source);

      expect(printed).toContain("[[doc_ab12cd34\\|the alias]]");
      expect(rowWidths(printed)).toEqual([[2, 2]]);
      // The escape is GFM's, not ours to re-read: the row scanner unescapes
      // `\|` before any inline parsing, so the ref grammar still sees a clean
      // pipe and the node comes back whole.
      expect(parseMarkdown(printed)).toEqual(source);
    });

    /**
     * The one pipe test that deliberately does **not** assert
     * `parseMarkdown(printed)` equals its source, where the reference case
     * above does (PR #41, MINOR 3).
     *
     * The escape lands *inside* the construct, and a raw inline is opaque to
     * the parser: `<kbd>\|</kbd>` reads back as three nodes — `<kbd>`, the text
     * `|`, `</kbd>` — which is exactly what a file containing that cell parses
     * to, so nothing is lost and the output is a fixed point, but the tree is
     * not the hand-built one. The assertion is therefore about the row and the
     * bytes, which is what a file can actually say. Where the escaped pipe sits
     * inside a *tag* rather than between two, the backslash is kept by
     * micromark and becomes part of the attribute — see `safeInCell`, which now
     * records that case instead of claiming to cover it.
     */
    it("escapes a pipe carried by a raw inline", () => {
      const source = table(
        [{ type: NODE.rawInline, attrs: { text: "<kbd>|</kbd>" } }],
        [text("z")],
      );

      const printed = serializeDoc(source);

      expect(printed).toContain("<kbd>\\|</kbd>");
      expect(rowWidths(printed)).toEqual([[2, 2]]);
      expect(canonicalizeMarkdown(printed)).toBe(printed);
      expect(parseMarkdown(printed).content?.[0]?.content?.[1]?.content?.[0]?.content?.[0]).toEqual(
        {
          type: NODE.paragraph,
          content: [
            { type: NODE.rawInline, attrs: { text: "<kbd>" } },
            { type: NODE.text, text: "|" },
            { type: NODE.rawInline, attrs: { text: "</kbd>" } },
          ],
        },
      );
    });

    /**
     * A raw inline's value is the source text *as written*, backslashes and
     * all, so a document that already spells the pipe correctly must not have
     * its backslash doubled — `\\|` is a literal backslash followed by a
     * delimiter, which is the bug reintroduced by its own fix.
     */
    it("leaves a pipe a raw inline already escaped alone", () => {
      const source = table(
        [{ type: NODE.rawInline, attrs: { text: "<kbd>\\|</kbd>" } }],
        [text("z")],
      );

      const printed = serializeDoc(source);

      expect(printed).toContain("<kbd>\\|</kbd>");
      expect(printed).not.toContain("\\\\|");
      expect(rowWidths(printed)).toEqual([[2, 2]]);
    });

    it("escapes a pipe carried by a bare autolink", () => {
      const markdown = "| a | b |\n| - | - |\n| https://e.test/?x=1\\|2 | z |\n";
      expect(rowWidths(markdown)).toEqual([[2, 2]]);
      expect(rowWidths(canonicalizeMarkdown(markdown))).toEqual([[2, 2]]);
      expect(canonicalizeMarkdown(markdown)).toContain("https://e.test/?x=1\\|2");
    });

    /**
     * `mdast-util-gfm-table` patches `inlineCode` for exactly this, and the
     * module leans on that rather than re-doing it. Nothing would fail if the
     * patch were lost to an upgrade — documents would simply start gaining
     * columns again — so it is asserted here.
     */
    it("escapes a pipe inside a code span, which the printer does itself", () => {
      const markdown = "| a | b |\n| - | - |\n| `x \\| y` | z |\n";
      expect(canonicalizeMarkdown(markdown)).toContain("`x \\| y`");
      expect(rowWidths(canonicalizeMarkdown(markdown))).toEqual([[2, 2]]);
    });

    it("leaves a pipe outside a table unescaped", () => {
      expect(canonicalizeMarkdown("a | b\n")).toBe("a | b\n");
      const printed = serializeDoc(
        doc(paragraph({ type: NODE.docRef, attrs: { id: "doc_ab12cd34", alias: "the alias" } })),
      );
      expect(printed).toBe("[[doc_ab12cd34|the alias]]\n");
    });
  });

  /**
   * A row the file itself wrote wider than its header (UI-104).
   *
   * The pipe the author left bare is already a delimiter by the time this
   * module sees the document — the reader split the row, exactly as GFM says to
   * — so the ProseMirror table has a row wider than its header. GFM's own
   * answer is to *ignore* the surplus, which would delete the user's text; the
   * printer's is to widen the whole table to the widest row, which rewrites
   * every other row in it.
   *
   * Neither is acceptable, so the surplus is folded back into the last column
   * behind the `|` it came from — the table keeps its columns, every character
   * survives, and the escaped pipe never splits a row again.
   */
  describe("a row with more cells than its header", () => {
    function rowWidths(markdown: string): number[][] {
      return (parseMarkdown(markdown).content ?? [])
        .filter((node) => node.type === NODE.table)
        .map((node) => (node.content ?? []).map((row) => (row.content ?? []).length));
    }

    it("folds the surplus into the last column rather than adding one", () => {
      const markdown = "| a | b |\n| - | - |\n| x | y | z |\n";
      expect(rowWidths(markdown)).toEqual([[2, 3]]);

      const once = canonicalizeMarkdown(markdown);

      expect(once).toBe("| a | b    |\n| - | ---- |\n| x | y\\|z |\n");
      expect(rowWidths(once)).toEqual([[2, 2]]);
    });

    it("settles there — an escaped pipe never splits a row again", () => {
      const once = canonicalizeMarkdown("| a | b |\n| - | - |\n| x | y | z |\n");
      expect(canonicalizeMarkdown(once)).toBe(once);
    });

    it("folds every surplus cell of a row, in order", () => {
      const once = canonicalizeMarkdown("| a | b |\n| - | - |\n| x | y | z | w |\n");
      expect(once).toContain("| y\\|z\\|w |");
      expect(rowWidths(once)).toEqual([[2, 2]]);
    });

    /**
     * The width is the header's, so a table the editor grew a column on prints
     * with that column — `attrs.align` is parse-time data the table commands do
     * not maintain, and reading the width off it would fold the new column away.
     */
    it("takes its width from the header row, not from `align`", () => {
      const td = (value: string): PmNode => ({
        type: NODE.tableCell,
        attrs: { colspan: 1, rowspan: 1, colwidth: null },
        content: [paragraph(text(value))],
      });
      const source = doc({
        type: NODE.table,
        // Two columns' worth of alignment, three columns' worth of cells.
        attrs: { align: [null, null] },
        content: [
          { type: NODE.tableRow, content: [td("a"), td("b"), td("c")] },
          { type: NODE.tableRow, content: [td("x"), td("y"), td("z")] },
        ],
      });

      expect(rowWidths(serializeDoc(source))).toEqual([[3, 3]]);
    });

    it("leaves a row shorter than its header to the printer", () => {
      const once = canonicalizeMarkdown("| a | b |\n| - | - |\n| x |\n");
      expect(once).toBe("| a | b |\n| - | - |\n| x |   |\n");
      expect(canonicalizeMarkdown(once)).toBe(once);
    });
  });

  it("serialises a task list with its checked state", () => {
    expect(canonicalizeMarkdown("- [x] done\n- [ ] open\n")).toBe("- [x] done\n- [ ] open\n");
  });

  /**
   * A task list all of whose items are empty comes back a bullet list, and that
   * is **accepted on the record** (UI-104), not a defect left unfixed.
   *
   * GFM defines a task list item as one whose first block is a paragraph
   * beginning with `[ ]` **followed by whitespace and then content**
   * (GFM §5.3, "Task list items"). Nothing after the marker fails that test, so
   * `- [ ]` alone is a bullet item holding the literal text `[ ]`.
   *
   * **What UI-104 originally recorded — "there is no spelling of an empty task
   * item that survives a round trip" — is false against this repo's own
   * parser**, and PR #41's review is right to call it (MINOR 4).
   * `- [ ] <!-- -->` round-trips byte for byte, reads back as
   * `taskList(taskItem(paragraph(rawInline)))` and renders as an empty task
   * item; so does `- [ ] <span></span>`. The content GFM demands can be an HTML
   * comment, which renders as nothing at all.
   *
   * So the bare `-` is not the only honest output — it is a **choice not to
   * write something into the user's file that the user did not write**. §5
   * makes the file the source of truth and §1 makes it theirs; an editor that
   * silently plants `<!-- -->` in a document because its own model needs a
   * marker to survive is exactly the class of act this issue exists to stop,
   * and the comment would then be permanent, visible in every diff, and
   * impossible to remove through the editor that added it. Losing the list's
   * type is the smaller intrusion: no text moves, the output is a fixed point,
   * and the moment any item in the list has content the whole list is a task
   * list again, empty items included.
   *
   * The residual cost, recorded rather than hidden: `- [ ] &#32;` — a task item
   * whose only content is a space — loses **both** its task-ness *and* that
   * space, because trailing whitespace is dropped before the item is written.
   * Pinned below.
   */
  describe("a task list with nothing in it", () => {
    const emptyTaskList = (checked: boolean): PmNode =>
      doc({
        type: NODE.taskList,
        content: [{ type: NODE.taskItem, attrs: { checked }, content: [{ type: NODE.paragraph }] }],
      });

    it.each(["- [ ]\n", "- [ ] \n", "- [x]\n", "- [ ]\n- [x]\n"])(
      "%j is a bullet list before anything is printed",
      (markdown) => {
        expect(parseMarkdown(markdown).content?.[0]?.type).toBe(NODE.bulletList);
      },
    );

    /**
     * The counterexample the acceptance argument has to answer, rather than the
     * claim it used to rest on. If this ever stops round-tripping, the reason
     * the printer writes a bare `-` changes from "we decline to add a comment"
     * back to "nothing survives", and the docstring above is wrong.
     */
    it("survives as an HTML comment, which is why the bare marker is a choice", () => {
      const source = "- [ ] <!-- -->\n";
      const parsed = parseMarkdown(source);

      expect(parsed.content?.[0]?.type).toBe(NODE.taskList);
      expect(parsed.content?.[0]?.content?.[0]?.content?.[0]?.content?.[0]?.type).toBe(
        NODE.rawInline,
      );
      expect(serializeDoc(parsed)).toBe(source);
    });

    it("loses the space as well, when the space is all there was", () => {
      const printed = serializeDoc(parseMarkdown("- [ ] &#32;\n"));

      expect(printed).toBe("-\n");
      expect(parseMarkdown(printed).content?.[0]?.type).toBe(NODE.bulletList);
      expect(canonicalizeMarkdown(printed)).toBe(printed);
    });

    it.each([true, false])("prints as a bare marker when checked is %s", (checked) => {
      expect(serializeDoc(emptyTaskList(checked))).toBe("-\n");
    });

    it("loses only its task-ness, and settles there", () => {
      const printed = serializeDoc(emptyTaskList(false));
      expect(parseMarkdown(printed).content?.[0]?.type).toBe(NODE.bulletList);
      expect(canonicalizeMarkdown(printed)).toBe(printed);
    });

    it("stays a task list as soon as one item has content", () => {
      const source = doc({
        type: NODE.taskList,
        content: [
          { type: NODE.taskItem, attrs: { checked: false }, content: [{ type: NODE.paragraph }] },
          {
            type: NODE.taskItem,
            attrs: { checked: true },
            content: [paragraph(text("Bee two."))],
          },
        ],
      });

      const printed = serializeDoc(source);

      expect(printed).toBe("-\n- [x] Bee two.\n");
      expect(parseMarkdown(printed).content?.[0]?.type).toBe(NODE.taskList);
    });
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
 * a table becomes another row of it. §10 gives the editor autosave and no save
 * button, so each of those reaches the user's own file the first time anything
 * is typed in the document.
 *
 * **Idempotence is the property, because it is checkable without knowing the
 * right answer**: whatever spelling the printer chooses, printing its own output
 * must not choose differently. It is asserted here over every ordered pair of
 * block types rather than for a fixture, since a round trip that is not a fixed
 * point for one construct is unlikely to be one for exactly one construct — the
 * sweep that found this found the same failure in five other shapes.
 *
 * **One node per block type is not enough**, and the first version of this probe
 * proved it by passing over two live defects. Whether a list may be printed
 * flush depends on the list's *spelling*, not its type: an ordered list is
 * uninterruptible when its first number is not 1, and any list is when its first
 * item is empty. A probe parameterised at `start: 1` with a non-empty first item
 * everywhere structurally cannot fail on either. So {@link SPELLINGS} adds the
 * spellings that change the answer, and the pairs run over those too.
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

  /**
   * An empty paragraph as `parseMarkdown` spells one: no `content` key at all.
   *
   * The probe compares parsed trees to hand-built ones, so an empty item has to
   * be built the way the parser builds it or every pair holding one fails for a
   * reason that is not the printer's.
   */
  function emptyParagraph(): PmNode {
    return { type: NODE.paragraph };
  }

  /**
   * The list spellings that decide whether a list may be printed flush.
   *
   * Not extra block *types* — {@link BLOCKS} already has one of each — but the
   * two ways a list stops being able to interrupt a paragraph, in each list
   * flavour that can express them. Both are two keystrokes away in the editor,
   * and both were printed flush, and destroyed, until UI-103's follow-up.
   */
  const SPELLINGS: Readonly<Record<string, PmNode>> = {
    // An ordered list that does not start at 1 cannot interrupt a paragraph:
    // printed flush, `5. item five` is lazy continuation text, and the save
    // after that escapes it to `5\. item five` for good.
    orderedListFromFive: {
      type: NODE.orderedList,
      attrs: { start: 5 },
      content: [listItem(paragraph(text("item five"))), listItem(paragraph(text("item six")))],
    },
    // A list whose first item is empty cannot either — and a lone `-` on the
    // line under a paragraph is a **setext underline**, so the paragraph above
    // it becomes an H2.
    bulletListEmptyLead: bulletList(
      listItem(emptyParagraph()),
      listItem(paragraph(text("Bee second."))),
    ),
    orderedListEmptyLead: {
      type: NODE.orderedList,
      attrs: { start: 1 },
      content: [listItem(emptyParagraph()), listItem(paragraph(text("Bee second.")))],
    },
    // The task-list flavour of the same hole. `mdast-util-gfm-task-list-item`
    // writes no `[ ] ` checkbox when the marker is followed by nothing, so an
    // empty task item prints as a bare `-` exactly like a bullet one.
    taskListEmptyLead: {
      type: NODE.taskList,
      content: [
        { type: NODE.taskItem, attrs: { checked: false }, content: [emptyParagraph()] },
        { type: NODE.taskItem, attrs: { checked: true }, content: [paragraph(text("Bee two."))] },
      ],
    },
  };

  const VARIANTS: Readonly<Record<string, PmNode>> = { ...BLOCKS, ...SPELLINGS };

  const PAIRS = Object.keys(VARIANTS).flatMap((left) =>
    Object.keys(VARIANTS).map((right) => [left, right] as const),
  );

  /** An item holding `left` then `right` after its lead paragraph, with a sibling after it. */
  function itemHolding(left: string, right: string): PmNode {
    const clone = (node: PmNode): PmNode => JSON.parse(JSON.stringify(node)) as PmNode;
    return doc(
      bulletList(
        listItem(
          paragraph(text("Aye lead.")),
          clone(VARIANTS[left] as PmNode),
          clone(VARIANTS[right] as PmNode),
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
    // …and every extra spelling is a spelling of a type already covered, so the
    // two maps can be merged without the coverage claim above weakening.
    expect([...new Set(Object.values(VARIANTS).map((node) => node.type))].sort()).toEqual(admitted);
  });

  it("parameterises both conditions that stop a list interrupting a paragraph", () => {
    // The probe's own guard. A spelling map that drifts back to `start: 1` with
    // a non-empty first item everywhere cannot fail on the two defects it is
    // pointed at, and would go on passing while they were reintroduced.
    const spellings = Object.values(SPELLINGS);
    expect(
      spellings.some((list) => list.attrs?.["start"] !== 1 && list.attrs?.["start"] !== undefined),
    ).toBe(true);
    expect(
      spellings.some((list) => (list.content?.[0]?.content?.[0]?.content ?? []).length === 0),
    ).toBe(true);
  });

  it.each(PAIRS)("reads back unchanged with %s then %s in one item", (left, right) => {
    const source = itemHolding(left, right);
    expect(parseMarkdown(serializeDoc(source))).toEqual(source);
  });

  it.each(PAIRS)("prints the same twice with %s then %s in one item", (left, right) => {
    const once = serializeDoc(itemHolding(left, right));
    expect(canonicalizeMarkdown(once)).toBe(once);
  });

  it("keeps a nested list flush under a paragraph of the same item", () => {
    // The join that stays tight: this is what hand-written markdown looks like,
    // and widening it would rewrite every nested list in the corpus. It is not
    // limited to the item's *lead* paragraph — a list may follow a later
    // paragraph of the item too, and does so flush for the same reason.
    expect(canonicalizeMarkdown("- outer\n  - nested\n")).toBe("- outer\n  - nested\n");
    expect(canonicalizeMarkdown("- outer\n\n  later paragraph\n  - nested\n")).toBe(
      "- outer\n\n  later paragraph\n  - nested\n",
    );
  });

  it("leaves two same-marker lists to the printer, which alternates the bullet", () => {
    // What keeps them two lists is **bullet alternation**, not a separator: the
    // printer tracks `state.bulletLastUsed` (`mdast-util-to-markdown`'s
    // `handle/list.js`) and writes the second list with the other marker. There
    // is no `<!---->` in the output and there is no blank line — a blank line is
    // what would merge them.
    const source = doc(
      bulletList(
        listItem(
          paragraph(text("lead")),
          bulletList(listItem(paragraph(text("a")))),
          bulletList(listItem(paragraph(text("b")))),
        ),
      ),
    );
    expect(serializeDoc(source)).toBe("- lead\n  - a\n  * b\n");
    expect(parseMarkdown(serializeDoc(source))).toEqual(source);
  });
});

/**
 * The two list spellings that may not be printed flush under a paragraph.
 *
 * The flush exception for a list inside a list item is what keeps every
 * hand-written nested list byte-identical, and it was written unconditionally.
 * But a list only *stays* a list where it was put if it can interrupt the
 * paragraph above it, and CommonMark says two spellings cannot. Both are
 * reachable by typing — this is not a shape that only arrives from a file — and
 * printing either one flush is a silent, unasked-for rewrite of the user's
 * document on the very next autosave.
 */
describe("a sublist that cannot interrupt the paragraph above it", () => {
  it("keeps an ordered sublist that does not start at 1 out of the paragraph", () => {
    const markdown = "- Lead paragraph.\n\n  5. item five\n  6. item six\n";
    // Byte-identical through the round trip…
    expect(canonicalizeMarkdown(markdown)).toBe(markdown);
    // …and a fixed point, which is the half that used to fail *twice*: printed
    // flush, the sublist became lazy continuation text, and printing that again
    // escaped the markers to `5\. item five` — permanently.
    expect(canonicalizeMarkdown(canonicalizeMarkdown(markdown))).toBe(markdown);
    const item = parseMarkdown(canonicalizeMarkdown(markdown)).content?.[0]?.content?.[0];
    expect(item?.content?.map((child) => child.type)).toEqual([NODE.paragraph, NODE.orderedList]);
    expect(item?.content?.[1]?.attrs?.["start"]).toBe(5);
  });

  it("keeps a sublist whose first item is empty from underlining the paragraph", () => {
    // `Enter` then `Tab` at the end of a bullet's text, then a pause: autosave
    // is what writes this, and printed flush the lone `-` is a setext
    // underline, so "Lead paragraph." comes back as an H2.
    const source = doc({
      type: NODE.bulletList,
      content: [
        {
          type: NODE.listItem,
          content: [
            paragraph(text("Lead paragraph.")),
            {
              type: NODE.bulletList,
              content: [{ type: NODE.listItem, content: [{ type: NODE.paragraph }] }],
            },
          ],
        },
      ],
    });
    expect(serializeDoc(source)).toBe("- Lead paragraph.\n\n  -\n");
    expect(parseMarkdown(serializeDoc(source))).toEqual(source);
    expect(canonicalizeMarkdown("- Lead paragraph.\n\n  -\n")).toBe("- Lead paragraph.\n\n  -\n");
  });

  it("keeps them separated under a sibling list too, not only under a paragraph", () => {
    // The rule is on the list being printed, not on what precedes it: the last
    // line of a sibling list is a paragraph line just as much as an item's own
    // paragraph is.
    for (const markdown of [
      "- Lead.\n  - a\n\n  5. item five\n  6. item six\n",
      "- Lead.\n  - a\n\n  *\n  * Bee second.\n",
    ]) {
      expect(canonicalizeMarkdown(markdown)).toBe(markdown);
    }
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
