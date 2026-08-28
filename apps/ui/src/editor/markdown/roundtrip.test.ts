import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHARACTER_REFERENCE } from "./escape.js";
import { parseMarkdown } from "./parse.js";
import { canonicalizeMarkdown, serializeDoc } from "./serialize.js";

/**
 * The round trip, over a corpus of canonical markdown.
 *
 * Two properties, and both are asserted (sprint-011 TEST-6 / TEST-7):
 *
 * 1. **Byte-identical for canonical input.** Every fixture is markdown in the
 *    exact shape the serializer emits, so `serialize(parse(md)) === md` down to
 *    the byte. This is the property autosave depends on: a document nobody
 *    edited must not produce a diff.
 * 2. **Idempotent from the second pass for arbitrary input.** Non-canonical
 *    markdown legitimately normalises — setext headings become ATX, `*` bullets
 *    become `-` — but it must settle after exactly one pass, or every save
 *    would rewrite the file again.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixtureNames(): readonly string[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

describe("the fixture corpus", () => {
  const names = fixtureNames();

  it("covers every construct the schema models", () => {
    // Stated rather than counted loosely: the corpus is the evidence for
    // TEST-6, and a fixture silently deleted would otherwise weaken it in
    // total silence.
    expect(names).toEqual([
      "blockquotes.md",
      "code-blocks.md",
      "emphasis.md",
      "hard-wrapped.md",
      "headings.md",
      "links.md",
      "lists-block-content.md",
      "lists-bullet.md",
      "lists-ordered.md",
      "mixed-note.md",
      "mixed-spec.md",
      "nested-fences.md",
      "raw-constructs.md",
      "refs.md",
      "rules-and-breaks.md",
      "styled-text.md",
      "tables.md",
      "task-lists.md",
    ]);
    expect(names).toHaveLength(18);
  });

  it.each(names)("%s round-trips byte for byte", (name) => {
    const markdown = readFileSync(join(FIXTURES, name), "utf8");
    expect(serializeDoc(parseMarkdown(markdown))).toBe(markdown);
  });

  it.each(names)("%s is idempotent under a second pass", (name) => {
    const markdown = readFileSync(join(FIXTURES, name), "utf8");
    const once = canonicalizeMarkdown(markdown);
    expect(canonicalizeMarkdown(once)).toBe(once);
  });
});

/**
 * Inputs that are *not* canonical. Each one is expected to change on the first
 * pass; none of them may change on the second.
 */
const NON_CANONICAL: readonly (readonly [string, string])[] = [
  ["setext h1", "Title\n=====\n\nbody\n"],
  ["setext h2", "Title\n-----\n\nbody\n"],
  ["star bullets", "* one\n* two\n"],
  ["plus bullets", "+ one\n+ two\n"],
  ["underscore italic", "_italic_ and __bold__\n"],
  ["ordered list starting at three", "3. three\n4. four\n"],
  ["ordered list with paren markers", "1) one\n2) two\n"],
  ["trailing whitespace", "a line   \nnext line\n"],
  ["CRLF line endings", "# Title\r\n\r\nbody\r\n"],
  ["several blank lines between blocks", "one\n\n\n\n\ntwo\n"],
  ["tilde fences", "~~~js\nconst a = 1;\n~~~\n"],
  ["indented code", "    indented code\n"],
  ["no trailing newline", "just a line"],
  ["leading blank lines", "\n\n\nfirst\n"],
  ["loose list", "- one\n\n- two\n"],
  ["hard break by two spaces", "one  \ntwo\n"],
  ["mixed nesting", "* a\n  1. b\n     * c\n"],
  // What a save wrote before UI-103: the blank line before an outer item's
  // trailing paragraph, dropped. The paragraph now *is* part of the nested
  // item — markdown says so — and the second read indents it to match. It has
  // to settle there rather than keep moving, which is what this pins; the
  // damage itself is not something a later save can undo.
  ["a list item an older serializer flattened", "- outer\n  - nested\n  trailing\n"],
  ["html block", "<section>\n  <p>x</p>\n</section>\n"],
  ["escaped characters", "a \\* b \\_ c \\[ d\n"],
  ["reference link", "[text][id]\n\n[id]: https://example.com\n"],
  // The body an older serializer wrote when a bold selection carried its
  // trailing space: it has to heal on the next save, not survive.
  ["character references in a body", "**alpha beta&#x20;**&#x67;amma delta\n"],
  // The same corruption in its other two spellings (PR #10 finding 18): a
  // check that only knew `&#x` would let a printer writing `&#32;` through.
  ["decimal character references in a body", "**alpha beta&#32;**&#103;amma delta\n"],
  ["a named character reference in a body", "**alpha&nbsp;**beta\n"],
  ["a space against an emphasis marker", "**alpha beta ** gamma\n"],
  ["a ref straight after a bold run", "**link:&#x20;**[[doc_mbc52nvo]]**6.4%** week\n"],
  // UI-064: the canonical spelling of a break in a cell is `<br>`, so the
  // self-closing spellings normalise to it exactly as `*` bullets normalise
  // to `-`. `<br>` itself is canonical and lives in `fixtures/tables.md`.
  ["a self-closing break in a table cell", "| a | b |\n| - | - |\n| one<br/>two | x |\n"],
  ["a spaced self-closing break in a cell", "| a | b |\n| - | - |\n| one<br />two | x |\n"],
];

describe("non-canonical input", () => {
  it.each(NON_CANONICAL)("%s settles after one pass", (_name, input) => {
    const once = canonicalizeMarkdown(input);
    expect(canonicalizeMarkdown(once)).toBe(once);
  });

  it.each(NON_CANONICAL)("%s survives the round trip without losing its text", (_name, input) => {
    const once = canonicalizeMarkdown(input);
    // Every non-empty input produces non-empty output: the failure this
    // catches is a construct the walk does not know silently vanishing.
    expect(once.trim().length).toBeGreaterThan(0);
  });
});

/**
 * The body is markdown, and only markdown (SPEC.md §6).
 *
 * A character reference is the printer's escape hatch for whitespace markdown
 * cannot spell, and once written it is permanent: it survives every later
 * round trip and shows up in every later diff. Nothing this serializer emits
 * may contain one — asserted over the whole corpus rather than case by case,
 * because the cases that produced them were the ones nobody thought to write a
 * case for.
 */
describe("character references", () => {
  it.each(fixtureNames())("%s is written back without one", (name) => {
    const markdown = readFileSync(join(FIXTURES, name), "utf8");
    expect(canonicalizeMarkdown(markdown)).not.toMatch(CHARACTER_REFERENCE);
  });

  it.each(NON_CANONICAL)("%s normalises without one", (_name, input) => {
    expect(canonicalizeMarkdown(input)).not.toMatch(CHARACTER_REFERENCE);
  });

  /** All three spellings, so "no entity" means no entity (PR #10 finding 18). */
  it.each([
    ["hexadecimal", "&#x20;"],
    ["decimal", "&#32;"],
    ["named", "&nbsp;"],
  ])("recognises the %s form", (_name, reference) => {
    expect(`a${reference}b`).toMatch(CHARACTER_REFERENCE);
    // An escaped ampersand is a literal one, and is what the escaper writes.
    expect(`a\\${reference}b`).not.toMatch(CHARACTER_REFERENCE);
  });

  it("heals a body that already carries them", () => {
    expect(canonicalizeMarkdown("**alpha beta&#x20;**&#x67;amma delta\n")).toBe(
      "**alpha beta** gamma delta\n",
    );
    expect(canonicalizeMarkdown("**alpha beta&#32;**&#103;amma delta\n")).toBe(
      "**alpha beta** gamma delta\n",
    );
    expect(canonicalizeMarkdown("**link:&#x20;**[[doc_a]]**6.4%** week\n")).toBe(
      "**link:** [[doc_a]]**6.4%** week\n",
    );
  });
});

describe("the empty document", () => {
  it("parses to a single empty paragraph", () => {
    expect(parseMarkdown("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("serializes to the empty string, not to whitespace", () => {
    expect(serializeDoc(parseMarkdown(""))).toBe("");
    expect(serializeDoc(parseMarkdown("\n\n\n"))).toBe("");
    expect(serializeDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
  });
});

/**
 * SPEC.md §5's styling forms (UI-182). `styled-text.md` above already asserts
 * the corpus property; what is here is the two directions the fixture cannot
 * show — a marker the editor must *not* invent, and prose the serializer must
 * escape so the next read does not invent one.
 */
describe("styled text", () => {
  const marksOf = (markdown: string): string[] => {
    const seen: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node !== "object" || node === null) return;
      const record = node as { marks?: { type: string }[]; content?: unknown[] };
      for (const mark of record.marks ?? []) seen.push(mark.type);
      for (const child of record.content ?? []) walk(child);
    };
    walk(parseMarkdown(markdown));
    return seen;
  };

  it("reads each of the three forms as its own mark", () => {
    expect(marksOf("<u>a</u>\n")).toEqual(["underline"]);
    expect(marksOf("==a==\n")).toEqual(["highlight"]);
    expect(marksOf('[a]{color="accent"}\n')).toEqual(["styleSpan"]);
  });

  it("reads a marker that spans other inline nodes", () => {
    // The delimiters sit in two different text nodes with a `strong` between
    // them, which is the case a text-node split cannot see at all.
    expect(marksOf("==a **b** c==\n")).toContain("highlight");
    expect(marksOf("==a **b** c==\n")).toContain("bold");
  });

  it.each([
    ["an escaped highlight", "\\==a\\==\n"],
    ["an escaped span", '\\[a]{color="accent"}\n'],
    ["spaced equals", "a == b\n"],
    ["an uppercase tag", "<U>a</U>\n"],
    ["an unknown attribute", '[a]{colour="accent"}\n'],
    ["a block attribute written inline", '[a]{align="center"}\n'],
    ["a marker in a code span", "`==a==`\n"],
    ["a marker in a fenced block", "```\n==a==\n```\n"],
  ])("invents no styling mark for %s", (_label, markdown) => {
    // `code` is a mark too, and a code span legitimately produces one; what
    // must not appear is any of §5's three.
    const styling = marksOf(markdown).filter((mark) =>
      ["underline", "highlight", "styleSpan"].includes(mark),
    );
    expect(styling).toEqual([]);
  });

  it("escapes prose that would otherwise be read as a marker", () => {
    // Typed by somebody who meant the characters. Serialising must escape them,
    // and the escaped form must read back as the same characters — otherwise the
    // next save writes a highlight nobody asked for.
    const typed = parseMarkdown("\\==not a highlight\\==\n");
    const printed = serializeDoc(typed);
    expect(printed).toBe("\\==not a highlight\\==\n");
    expect(marksOf(printed)).toEqual([]);
  });

  it("escapes the delimiter without re-escaping the paragraph around it", () => {
    // The reason `escape.ts` learns `=` at all. The defensive printer already
    // escapes it (`STYLE_UNSAFE`), so the safety net would produce a *correct*
    // file either way — but the defensive path re-escapes everything else in
    // the paragraph too, and sprint-011 TEST-22 is that a save touches nothing
    // the user did not. `snake_case` is the witness: minimal leaves it, the
    // printer's own escaping writes `snake\_case`.
    const source = "prose with snake_case and \\==not a highlight\\==\n";
    expect(canonicalizeMarkdown(source)).toBe(source);
  });

  it("does not escape equals that could not open a marker", () => {
    expect(canonicalizeMarkdown("a == b\n")).toBe("a == b\n");
    expect(canonicalizeMarkdown("x = y\n")).toBe("x = y\n");
  });

  it("moves an edge space outside a highlight, as it does for emphasis", () => {
    // `== a ==` closes nothing. The space belongs beside the marker.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a b ", marks: [{ type: "highlight" }] },
            { type: "text", text: "c" },
          ],
        },
      ],
    };
    expect(serializeDoc(doc as never)).toBe("==a b== c\n");
  });

  it("nests styling outside emphasis, so one document has one spelling", () => {
    // `==**a**==` and `**==a==**` are the same document; only one of them can
    // be what this serializer writes, or two editors produce two files for one
    // paste. MARK_ORDER decides, and this pins the decision.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "a",
              marks: [{ type: "bold" }, { type: "highlight" }],
            },
          ],
        },
      ],
    };
    expect(serializeDoc(doc as never)).toBe("==**a**==\n");
  });

  it("prints a span's attributes in one canonical order", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "a",
              marks: [{ type: "styleSpan", attrs: { highlight: "muted", color: "accent" } }],
            },
          ],
        },
      ],
    };
    expect(serializeDoc(doc as never)).toBe('[a]{color="accent" highlight="muted"}\n');
  });

  it("drops a span mark carrying no role at all", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "a",
              marks: [{ type: "styleSpan", attrs: { color: null, highlight: null } }],
            },
          ],
        },
      ],
    };
    expect(serializeDoc(doc as never)).toBe("a\n");
  });

  it("leaves a document with no styling byte-identical", () => {
    const plain = readFileSync(join(FIXTURES, "emphasis.md"), "utf8");
    expect(serializeDoc(parseMarkdown(plain))).toBe(plain);
  });
});
