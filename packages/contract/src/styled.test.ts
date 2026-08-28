import { describe, expect, it } from "vitest";
import {
  ALIGN_VALUES,
  blockFenceAttributes,
  formatStyleAttributes,
  hasStyleAttributes,
  INDENT_LEVELS,
  isBlockFenceClose,
  parseStyleAttributes,
  scanInlineStyles,
  STYLE_ROLES,
  stripStyling,
} from "./styled.js";
import { codeRanges } from "./code.js";

const kinds = (text: string): string[] =>
  scanInlineStyles(text, codeRanges(text)).map((match) => match.kind);

const inners = (text: string): string[] =>
  scanInlineStyles(text, codeRanges(text)).map((match) =>
    text.slice(match.innerStart, match.innerEnd),
  );

describe("parseStyleAttributes", () => {
  it("reads a single admissible pair", () => {
    expect(parseStyleAttributes('color="accent"', "inline")).toEqual({ color: "accent" });
  });

  it("reads two pairs in either written order", () => {
    expect(parseStyleAttributes('color="muted" highlight="warning"', "inline")).toEqual({
      color: "muted",
      highlight: "warning",
    });
    expect(parseStyleAttributes('highlight="warning" color="muted"', "inline")).toEqual({
      color: "muted",
      highlight: "warning",
    });
  });

  it("reads block attributes, with indent as a number", () => {
    expect(parseStyleAttributes('align="center" indent="2"', "block")).toEqual({
      align: "center",
      indent: 2,
    });
  });

  it.each([
    ["an unknown name", 'colour="accent"', "inline"],
    ["a value outside the role set", 'color="chartreuse"', "inline"],
    ["a block attribute written inline", 'align="center"', "inline"],
    ["an inline attribute written on a block", 'color="accent"', "block"],
    ["an indent level outside the set", 'indent="17"', "block"],
    ["a bare name", "color", "inline"],
    ["a single-quoted value", "color='accent'", "inline"],
    ["a repeated name", 'color="accent" color="muted"', "inline"],
    ["two pairs run together", 'color="accent"highlight="muted"', "inline"],
    ["trailing rubbish", 'color="accent" and more', "inline"],
    ["nothing at all", "   ", "inline"],
  ] as const)("refuses %s", (_label, source, position) => {
    expect(parseStyleAttributes(source, position)).toBeNull();
  });

  it("round-trips through formatStyleAttributes in canonical order", () => {
    const source = 'highlight="positive" color="accent"';
    const parsed = parseStyleAttributes(source, "inline");
    expect(parsed).not.toBeNull();
    const formatted = formatStyleAttributes(parsed ?? {});
    expect(formatted).toBe('color="accent" highlight="positive"');
    expect(parseStyleAttributes(formatted, "inline")).toEqual(parsed);
  });

  it("formats every value of every vocabulary back to something it parses", () => {
    for (const role of STYLE_ROLES) {
      const inline = formatStyleAttributes({ color: role, highlight: role });
      expect(parseStyleAttributes(inline, "inline")).toEqual({ color: role, highlight: role });
    }
    for (const align of ALIGN_VALUES) {
      for (const indent of INDENT_LEVELS) {
        const block = formatStyleAttributes({ align, indent });
        expect(parseStyleAttributes(block, "block")).toEqual({ align, indent });
      }
    }
  });

  it("reports whether an attribute set says anything", () => {
    expect(hasStyleAttributes({})).toBe(false);
    expect(hasStyleAttributes({ color: "accent" })).toBe(true);
  });
});

describe("scanInlineStyles", () => {
  it("finds each of the three forms", () => {
    expect(kinds("<u>a</u>")).toEqual(["underline"]);
    expect(kinds("==a==")).toEqual(["highlight"]);
    expect(kinds('[a]{color="accent"}')).toEqual(["span"]);
  });

  it("reports the inner text of each", () => {
    expect(inners('one <u>two</u> ==three== [four]{color="muted"}')).toEqual([
      "two",
      "three",
      "four",
    ]);
  });

  it("returns outermost matches only, never overlapping", () => {
    const text = "==a <u>b</u> c==";
    expect(kinds(text)).toEqual(["highlight"]);
    expect(inners(text)).toEqual(["a <u>b</u> c"]);
  });

  it("closes a span on `]{`, so a bracketed construct can be styled", () => {
    const text = '[[[doc_a1b2c3]]]{color="accent"}';
    expect(kinds(text)).toEqual(["span"]);
    expect(inners(text)).toEqual(["[[doc_a1b2c3]]"]);
  });

  it.each([
    ["an uppercase tag", "<U>a</U>"],
    ["a tag with a space", "<u >a</u>"],
    ["a tag with attributes", '<u class="x">a</u>'],
    ["an unterminated underline", "<u>a"],
    ["an empty underline", "<u></u>"],
    ["spaced equals", "a == b"],
    ["an unterminated highlight", "==a"],
    ["an empty highlight", "===="],
    ["a run of three", "===a==="],
    ["a highlight opening on whitespace", "== a=="],
    ["an ordinary link", "[a](b)"],
    ["an unknown attribute", '[a]{colour="accent"}'],
    ["a block attribute inline", '[a]{align="center"}'],
    ["a detached attribute list", '[a] {color="accent"}'],
    ["an empty span", '[]{color="accent"}'],
  ])("does not recognise %s", (_label, text) => {
    expect(kinds(text)).toEqual([]);
  });

  it("recognises nothing inside a code span or a fenced block", () => {
    expect(kinds("`==a==`")).toEqual([]);
    expect(kinds("```\n==a==\n<u>b</u>\n```")).toEqual([]);
    expect(kinds('`[a]{color="accent"}`')).toEqual([]);
  });

  it("recognises a marker beside a code span", () => {
    expect(kinds("`code` ==a==")).toEqual(["highlight"]);
  });
});

describe("blockFenceAttributes", () => {
  it("opens on a fence line carrying admissible attributes", () => {
    expect(blockFenceAttributes('::: {align="center"}')).toEqual({ align: "center" });
    expect(blockFenceAttributes('   ::: {indent="3"}  ')).toEqual({ indent: 3 });
  });

  it.each([
    ["an inline attribute", '::: {color="accent"}'],
    ["no attributes", "::: {}"],
    ["no braces", "::: center"],
    ["text after the fence", '::: {align="center"} and more'],
    ["four spaces of indent", '    ::: {align="center"}'],
  ])("stays prose for %s", (_label, line) => {
    expect(blockFenceAttributes(line)).toBeNull();
  });

  it("recognises a closing fence, alone on its line", () => {
    expect(isBlockFenceClose(":::")).toBe(true);
    expect(isBlockFenceClose("  :::  ")).toBe(true);
    expect(isBlockFenceClose("::: end")).toBe(false);
    expect(isBlockFenceClose("text :::")).toBe(false);
  });
});

describe("stripStyling", () => {
  it("drops the wrapper and keeps the inner text", () => {
    expect(stripStyling("<u>a</u>")).toBe("a");
    expect(stripStyling("==a==")).toBe("a");
    expect(stripStyling('[a]{color="accent"}')).toBe("a");
  });

  it("strips nested markers", () => {
    expect(stripStyling("==a <u>b</u> c==")).toBe("a b c");
    expect(stripStyling('[==a==]{color="warning"}')).toBe("a");
  });

  it("removes a block fence pair and keeps what it wrapped", () => {
    const body = '::: {align="center"}\n\nCentred prose.\n\n:::\n';
    expect(stripStyling(body)).toBe("\nCentred prose.\n\n");
  });

  it("leaves an unclosed fence as prose", () => {
    const body = '::: {align="center"}\n\nProse.\n';
    expect(stripStyling(body)).toBe(body);
  });

  it("leaves a fence line inside a code block alone", () => {
    const body = '```\n::: {align="center"}\n:::\n```\n';
    expect(stripStyling(body)).toBe(body);
  });

  it("returns marker-free text identically, line endings included", () => {
    const plain = "# Heading\r\n\r\nProse with **bold**, a `code == span` and a [link](x).\r\n";
    expect(stripStyling(plain)).toBe(plain);
  });

  it("touches nothing markdown owns", () => {
    const body = "**bold** *italic* ~~strike~~ [link](url) ![img](src)\n\n- item\n";
    expect(stripStyling(body)).toBe(body);
  });

  it("is idempotent", () => {
    const body = 'A ==bright== <u>line</u> with [a role]{color="muted"}.\n';
    const once = stripStyling(body);
    expect(once).toBe("A bright line with a role.\n");
    expect(stripStyling(once)).toBe(once);
  });

  it("keeps a code sample that shows a marker", () => {
    const body = "Write it as `==this==`, like so:\n\n```\n==sample==\n```\n";
    expect(stripStyling(body)).toBe(body);
  });

  it("strips markers around a document reference without eating it", () => {
    expect(stripStyling('see [[[doc_a1b2c3]]]{color="accent"} now')).toBe("see [[doc_a1b2c3]] now");
  });
});
