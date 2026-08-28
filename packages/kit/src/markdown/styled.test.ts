import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { remarkCorpusStyling, styleOf, STYLE_NODE_TYPE, type StyledMdast } from "./styled.js";

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCorpusStyling).freeze();

function parse(markdown: string): StyledMdast {
  const tree = processor.parse(markdown);
  return processor.runSync(tree, markdown) as unknown as StyledMdast;
}

/** Every styled node in the tree, in document order. */
function styled(node: StyledMdast, out: StyledMdast[] = []): StyledMdast[] {
  if (node.type === STYLE_NODE_TYPE) out.push(node);
  for (const child of node.children ?? []) styled(child, out);
  return out;
}

const kinds = (markdown: string): string[] =>
  styled(parse(markdown)).map((node) => styleOf(node)?.kind ?? "?");

/** The plain text a node covers, styling delimiters gone. */
function textOf(node: StyledMdast): string {
  if (typeof node.value === "string" && node.type === "text") return node.value;
  if (node.type === "inlineCode") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

const firstStyled = (markdown: string): StyledMdast | undefined => styled(parse(markdown))[0];

describe("remarkCorpusStyling — the three inline forms", () => {
  it("recognises each of them", () => {
    expect(kinds("<u>a</u>")).toEqual(["underline"]);
    expect(kinds("==a==")).toEqual(["highlight"]);
    expect(kinds('[a]{color="accent"}')).toEqual(["span"]);
  });

  it("carries the span's attributes onto the node", () => {
    const node = firstStyled('[a]{color="warning" highlight="muted"}');
    expect(styleOf(node ?? { type: "x" })).toEqual({
      kind: "span",
      attrs: { color: "warning", highlight: "muted" },
    });
  });

  it("wraps the content, not the delimiters", () => {
    expect(textOf(firstStyled("==bright==") ?? { type: "x" })).toBe("bright");
    expect(textOf(firstStyled("<u>under</u>") ?? { type: "x" })).toBe("under");
  });
});

describe("a marker that spans other inline nodes", () => {
  it("pairs across a strong node — the case a text-node split cannot see", () => {
    const tree = parse("==a **b** c==");
    const nodes = styled(tree);
    expect(nodes).toHaveLength(1);
    expect(textOf(nodes[0] ?? { type: "x" })).toBe("a b c");
    // The `strong` survives inside it rather than being flattened to text.
    expect(JSON.stringify(nodes[0])).toContain("strong");
  });

  it("pairs across a link, and across a code span", () => {
    expect(kinds("==see [here](x) now==")).toEqual(["highlight"]);
    expect(kinds("==the `code` case==")).toEqual(["highlight"]);
  });

  it("nests, outermost first", () => {
    expect(kinds("==a <u>b</u> c==")).toEqual(["highlight", "underline"]);
    expect(kinds('[==a==]{color="accent"}')).toEqual(["span", "highlight"]);
  });
});

describe("what is not a marker", () => {
  it.each([
    ["an escaped highlight", "\\==a\\=="],
    ["an escaped span", '\\[a]{color="accent"}'],
    ["an escaped underline", "\\<u>a\\</u>"],
    ["spaced equals", "a == b"],
    ["an uppercase tag", "<U>a</U>"],
    ["a tag with attributes", '<u class="x">a</u>'],
    ["an unknown attribute", '[a]{colour="accent"}'],
    ["a block attribute written inline", '[a]{align="center"}'],
    ["an ordinary link", "[a](b)"],
    ["a marker inside a code span", "`==a==`"],
    ["a marker inside a fenced block", "```\n==a==\n```"],
  ])("does not recognise %s", (_label, markdown) => {
    expect(kinds(markdown)).toEqual([]);
  });

  it("leaves an unpaired <u> as the inert html node it was", () => {
    const tree = parse("<u>a");
    expect(styled(tree)).toEqual([]);
    expect(JSON.stringify(tree)).toContain('"html"');
  });

  it("keeps an escaped delimiter's characters in the text", () => {
    const tree = parse("\\==a\\==");
    expect(textOf(tree)).toBe("==a==");
  });
});

describe("markers next to constructs the scanner must not cut", () => {
  it("never puts a delimiter inside another node", () => {
    // The image is opaque: a marker either contains it or does not.
    expect(kinds("==before ![alt](src) after==")).toEqual(["highlight"]);
  });

  it("recognises a marker in a heading, a list item and a table cell", () => {
    expect(kinds("# A ==bright== title")).toEqual(["highlight"]);
    expect(kinds("- A ==bright== item")).toEqual(["highlight"]);
    expect(kinds("| a | b |\n| --- | --- |\n| ==c== | d |")).toEqual(["highlight"]);
  });

  it("recognises two markers in one run", () => {
    expect(kinds("==a== and ==b==")).toEqual(["highlight", "highlight"]);
  });
});
