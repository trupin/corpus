import { describe, expect, it } from "vitest";
import { escapeMarkdownText, leadingMarkerIndex } from "./escape.js";
import { canonicalizeMarkdown } from "./serialize.js";

/**
 * Escaping, which is the whole reason this repo does not hand the printing job
 * to `mdast-util-to-markdown` unchanged.
 *
 * Two families of assertion: the characters that **must** be escaped because
 * the text would otherwise mean something else, and the characters that must
 * **not** be, because escaping them is the churn sprint-011 TEST-22 forbids.
 */

function escape(value: string, before = "", after = ""): string {
  return escapeMarkdownText(value, { before, after });
}

describe("characters left alone", () => {
  it("leaves intraword underscores alone", () => {
    expect(escape("snake_case_name")).toBe("snake_case_name");
    expect(canonicalizeMarkdown("snake_case_name\n")).toBe("snake_case_name\n");
  });

  it("leaves a lone asterisk surrounded by spaces alone", () => {
    expect(escape("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("leaves brackets that open nothing alone", () => {
    expect(escape("a [draft] note")).toBe("a [draft] note");
    expect(canonicalizeMarkdown("a [draft] note\n")).toBe("a [draft] note\n");
  });

  it("leaves an ampersand that is not a character reference alone", () => {
    expect(escape("Tom & Jerry")).toBe("Tom & Jerry");
  });

  it("leaves a less-than that opens no tag alone", () => {
    expect(escape("3 < 5")).toBe("3 < 5");
  });

  it("leaves a single tilde alone", () => {
    expect(escape("approx ~5")).toBe("approx ~5");
  });

  it("leaves a hash that is not at the start of a line alone", () => {
    expect(escape("issue #12", "a ")).toBe("issue #12");
  });
});

describe("characters that must be escaped", () => {
  it("escapes a backslash", () => {
    expect(escape("a \\ b")).toBe("a \\\\ b");
  });

  it("escapes a backtick", () => {
    expect(escape("a ` b")).toBe("a \\` b");
  });

  it("escapes an asterisk that could flank", () => {
    expect(escape("*emph*")).toBe("\\*emph\\*");
    expect(escape("a*b")).toBe("a\\*b");
  });

  it("escapes an underscore that could flank", () => {
    expect(escape("_emph_")).toBe("\\_emph\\_");
    expect(escape("end_ start")).toBe("end\\_ start");
  });

  it("escapes a double tilde", () => {
    expect(escape("~~struck~~")).toBe("\\~\\~struck\\~\\~");
  });

  it("escapes a bracket that opens a link", () => {
    expect(escape("[text](url)")).toBe("\\[text](url)");
    expect(escape("[text][id]")).toBe("\\[text][id]");
    expect(escape("a footnote[^1]")).toBe("a footnote\\[^1]");
  });

  it("escapes an entity-looking ampersand", () => {
    expect(escape("a &amp; b")).toBe("a \\&amp; b");
  });

  it("escapes a tag-looking less-than", () => {
    expect(escape("<div>")).toBe("\\<div>");
    expect(escape("</p>")).toBe("\\</p>");
  });
});

describe("line-start markers", () => {
  it("finds the marker a line would open a block with", () => {
    expect(leadingMarkerIndex("# heading")).toBe(0);
    expect(leadingMarkerIndex("###### six")).toBe(0);
    expect(leadingMarkerIndex("  - bullet")).toBe(2);
    expect(leadingMarkerIndex("+ bullet")).toBe(0);
    expect(leadingMarkerIndex("> quote")).toBe(0);
    expect(leadingMarkerIndex("```fence")).toBe(0);
    expect(leadingMarkerIndex("~~~fence")).toBe(0);
    expect(leadingMarkerIndex("---")).toBe(0);
    expect(leadingMarkerIndex("===")).toBe(0);
    // The delimiter, not the digits: `1\. x` is what keeps the number readable.
    expect(leadingMarkerIndex("12. item")).toBe(2);
    expect(leadingMarkerIndex("12) item")).toBe(2);
  });

  it("finds nothing when the line opens no block", () => {
    expect(leadingMarkerIndex("plain prose")).toBe(-1);
    expect(leadingMarkerIndex("#hashtag")).toBe(-1);
    expect(leadingMarkerIndex("a - b")).toBe(-1);
    expect(leadingMarkerIndex("")).toBe(-1);
  });

  it("escapes a year that would open an ordered list", () => {
    // `2026. was a year` at the start of a block *is* an ordered list in
    // CommonMark, so the delimiter has to go — an unescaped one turns a
    // sentence into a list on the next read.
    expect(leadingMarkerIndex("2026. was a year")).toBe(4);
    expect(escape("2026. was a year")).toBe("2026\\. was a year");
  });

  it("escapes the marker only when the value actually starts a line", () => {
    expect(escape("# not a heading")).toBe("\\# not a heading");
    expect(escape("# mid sentence", "a ")).toBe("# mid sentence");
  });

  it("applies the rules to every line after a soft break", () => {
    expect(escape("first\n- not a bullet")).toBe("first\n\\- not a bullet");
  });
});

describe("through the serializer", () => {
  it("round-trips prose full of ambiguous punctuation", () => {
    const source =
      "The file_name_two column, 2 * 3 = 6, a [draft] tag, Tom & Jerry, 3 < 5 and ~ tilde.\n";
    expect(canonicalizeMarkdown(source)).toBe(source);
  });

  it("keeps a paragraph that begins with characters a block would use", () => {
    const source = "\\# not a heading\n\n\\- not a bullet\n\n\\> not a quotation\n";
    expect(canonicalizeMarkdown(source)).toBe(source);
  });

  it("falls back to defensive escaping rather than changing the meaning", () => {
    // Whatever the rules above decide, the output must parse back to the same
    // document — the property `serializeDoc` verifies on every call.
    const awkward = [
      "a *b* c _d_ e",
      "[x](y) and [z][w]",
      "| pipes | in | prose |",
      "<span>inline html</span>",
      "text with a \\* literal star",
      "1986. A year that opens a line.",
    ];
    for (const source of awkward) {
      const once = canonicalizeMarkdown(`${source}\n`);
      expect(canonicalizeMarkdown(once)).toBe(once);
    }
  });
});
