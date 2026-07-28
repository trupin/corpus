import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
      "headings.md",
      "links.md",
      "lists-bullet.md",
      "lists-ordered.md",
      "mixed-note.md",
      "mixed-spec.md",
      "raw-constructs.md",
      "refs.md",
      "rules-and-breaks.md",
      "tables.md",
      "task-lists.md",
    ]);
    expect(names).toHaveLength(14);
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
  ["html block", "<section>\n  <p>x</p>\n</section>\n"],
  ["escaped characters", "a \\* b \\_ c \\[ d\n"],
  ["reference link", "[text][id]\n\n[id]: https://example.com\n"],
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
