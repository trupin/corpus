/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOMParser as PmDOMParser,
  Node as PmModelNode,
  Slice,
  type Fragment,
} from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import {
  cleanPastedHtml,
  clipboardSerializer,
  noRefTargets,
  refLabel,
  sliceMarkdown,
  UNRESOLVED_REF,
  type RefResolver,
  type RefTarget,
} from "./clipboard.js";
import { parseMarkdown } from "./markdown/parse.js";
import { corpusSchema, type PmNode } from "./markdown/schema.js";
import { serializeDoc } from "./markdown/serialize.js";

/**
 * The §10 clipboard rider, both directions.
 *
 * The pre-fix reproduction (UI-042's E2E log) is the shape of this file: the
 * `text/html` flavor was already structural and is asserted here so it stays
 * that way; the `text/plain` flavor was ProseMirror's `textBetween` dump and is
 * asserted to be markdown; and the ref was a raw `doc_` id inside a link to
 * `about:blank`, which is what the ref cases below exist to keep out.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GOOGLE_DOCS_HTML = readFileSync(join(HERE, "fixtures/google-docs-paste.html"), "utf8");

/** The user's repro shape: heading, prose with emphasis, bullets, and more. */
const BODY = [
  "# Quarterly memo",
  "",
  "Lead paragraph with **bold** and *italic* and `code`.",
  "",
  "## Findings",
  "",
  "- first bullet",
  "- second **bold** bullet",
  "",
  "1. one",
  "2. two",
  "",
  "- [ ] open task",
  "- [x] done task",
  "",
  "See [the site](https://example.com) for numbers.",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
].join("\n");

function docNode(markdown: string): PmModelNode {
  return PmModelNode.fromJSON(corpusSchema(), parseMarkdown(markdown));
}

/** Everything in the document, as a copied slice. */
function wholeDoc(markdown: string): Slice {
  return new Slice(docNode(markdown).content, 0, 0);
}

/** The inline content of the document's first block, as a copied slice. */
function inlineOf(markdown: string): Slice {
  const first = docNode(markdown).child(0);
  return new Slice(first.content, 0, 0);
}

/** A resolver that answers for exactly the ids it is given. */
function resolving(targets: Readonly<Record<string, RefTarget>>): RefResolver {
  return (id) => targets[id] ?? UNRESOLVED_REF;
}

function serializeHtml(fragment: Fragment, resolve: RefResolver): string {
  const host = document.createElement("div");
  host.append(clipboardSerializer(corpusSchema(), resolve).serializeFragment(fragment));
  return host.innerHTML;
}

/**
 * `html` wearing Google Docs' signature — the wrapper it puts around every
 * copied selection, and the gate the repairs below are behind.
 *
 * The HTML parser's adoption agency reconstructs the `<b>` inside each block it
 * cannot contain, id and all, so unwrapping still yields the bare `html` back.
 */
function fromDocs(html: string): string {
  return `<b style="font-weight:normal;" id="docs-internal-guid-2b7f">${html}</b>`;
}

/** The Google Docs fixture, cleaned, parsed through the schema, saved. */
function pasteToMarkdown(html: string): string {
  const body = new DOMParser().parseFromString(cleanPastedHtml(html), "text/html").body;
  const parsed = PmDOMParser.fromSchema(corpusSchema()).parse(body);
  return serializeDoc(parsed.toJSON() as PmNode);
}

describe("the plain-text flavor", () => {
  it("is the markdown, not a run of stripped paragraphs", () => {
    const text = sliceMarkdown(wholeDoc(BODY), noRefTargets);
    expect(text).toBe(BODY);
  });

  it("carries every construct the rider names", () => {
    const text = sliceMarkdown(wholeDoc(BODY), noRefTargets);
    expect(text).toContain("# Quarterly memo");
    expect(text).toContain("## Findings");
    expect(text).toContain("**bold**");
    expect(text).toContain("*italic*");
    expect(text).toContain("`code`");
    expect(text).toContain("- first bullet");
    expect(text).toContain("1. one");
    expect(text).toContain("- [ ] open task");
    expect(text).toContain("- [x] done task");
    expect(text).toContain("[the site](https://example.com)");
    expect(text).toContain("```ts");
  });

  it("never emits the blank-line runs `textBetween` produced", () => {
    // The reproduction's signature: five consecutive newlines between two list
    // items, because every nesting level contributed its own separator.
    expect(sliceMarkdown(wholeDoc(BODY), noRefTargets)).not.toMatch(/\n{3}/);
  });

  it("gives an inline-only selection its paragraph back, without a file's newline", () => {
    // A phrase copied out of a sentence is not a document: the trailing newline
    // `serializeDoc` ends a file with would break the line it is pasted into.
    const text = sliceMarkdown(inlineOf("Lead with **bold** and *italic*.\n"), noRefTargets);
    expect(text).toBe("Lead with **bold** and *italic*.");
  });

  it("keeps the file's newline for a selection of whole blocks", () => {
    expect(sliceMarkdown(wholeDoc(BODY), noRefTargets).endsWith("```\n")).toBe(true);
  });

  /**
   * The shape a caret dragged through a sentence actually produces: the
   * enclosing paragraph, open at both ends. Testing the fragment's node type
   * instead answers "blocks" here, which is how the newline reached the
   * clipboard for every real mid-sentence copy.
   */
  it("drops the newline for words dragged out of the middle of a sentence", () => {
    const doc = docNode("Rates moved 6.4% this week. And then stopped.\n");
    expect(sliceMarkdown(doc.slice(13, 28), noRefTargets)).toBe("6.4% this week.");
  });

  it("keeps the newline for a selection that spans two paragraphs", () => {
    const doc = docNode("First para here.\n\nSecond para here.\n");
    expect(sliceMarkdown(doc.slice(7, 26), noRefTargets)).toBe("para here.\n\nSecond\n");
  });

  it("is empty for an empty selection", () => {
    expect(sliceMarkdown(Slice.empty, noRefTargets)).toBe("");
  });
});

describe("a [[ref]] on the clipboard", () => {
  const RESOLVER = resolving({ doc_a1b2c3: { title: "Lender spreads", href: null } });

  it("goes out as the target's title, aliased so it still parses back", () => {
    const text = sliceMarkdown(wholeDoc("See [[doc_a1b2c3]] for the numbers.\n"), RESOLVER);
    expect(text).toBe("See [[doc_a1b2c3|Lender spreads]] for the numbers.\n");
    // …and it is still the same reference when pasted into another document.
    expect(serializeDoc(parseMarkdown(text))).toBe(text);
  });

  it("keeps the author's alias rather than overwriting it with the title", () => {
    const text = sliceMarkdown(wholeDoc("See [[doc_a1b2c3|the memo]].\n"), RESOLVER);
    expect(text).toBe("See [[doc_a1b2c3|the memo]].\n");
  });

  it("leaves the bare form when nothing knows the title", () => {
    expect(sliceMarkdown(wholeDoc("See [[doc_zz9]].\n"), RESOLVER)).toBe("See [[doc_zz9]].\n");
  });

  it("leaves the bare form when the title cannot be an alias", () => {
    // `]` and newlines are outside the alias grammar in `@corpus/kit`; markdown
    // that would not parse back as a ref is worse than a bare id.
    const resolve = resolving({ doc_a1b2c3: { title: "Rates [2026] q3", href: null } });
    expect(sliceMarkdown(wholeDoc("See [[doc_a1b2c3]].\n"), resolve)).toBe("See [[doc_a1b2c3]].\n");
  });

  it("renders as plain title text — never a link to nowhere, never a doc id", () => {
    const html = serializeHtml(docNode("See [[doc_a1b2c3]].\n").content, RESOLVER);
    expect(html).toContain(">Lender spreads<");
    expect(html).not.toContain("doc_a1b2c3<");
    expect(html).not.toContain("href");
    expect(html).toContain('data-corpus-ref="doc_a1b2c3"');
  });

  it("renders as a link when the target has an address outside Corpus", () => {
    const resolve = resolving({
      doc_a1b2c3: { title: "Lender spreads", href: "https://docs.example.com/d/1" },
    });
    const html = serializeHtml(docNode("See [[doc_a1b2c3]].\n").content, resolve);
    expect(html).toContain('href="https://docs.example.com/d/1"');
    expect(html).toContain(">Lender spreads<");
  });

  it("round-trips back into the same reference when pasted into Corpus", () => {
    const html = serializeHtml(docNode("See [[doc_a1b2c3]].\n").content, RESOLVER);
    const body = new DOMParser().parseFromString(html, "text/html").body;
    const parsed = PmDOMParser.fromSchema(corpusSchema()).parse(body);
    expect(serializeDoc(parsed.toJSON() as PmNode)).toBe("See [[doc_a1b2c3]].\n");
  });

  it("falls back to the id only where the reader also sees the id", () => {
    expect(refLabel({ id: "doc_x1", alias: null }, UNRESOLVED_REF)).toBe("doc_x1");
    expect(refLabel({ id: "doc_x1", alias: null }, { title: "", href: null })).toBe("doc_x1");
    expect(refLabel({ id: "doc_x1", alias: "" }, { title: "Memo", href: null })).toBe("Memo");
    expect(refLabel({ id: "doc_x1", alias: "as text" }, { title: "Memo", href: null })).toBe(
      "as text",
    );
  });

  it("resolves nothing for a ref with no id at all", () => {
    const schema = corpusSchema();
    const node = schema.nodes["docRef"]?.create({ id: "", alias: null });
    expect(node).toBeDefined();
    if (node === undefined) return;
    const fragment = schema.nodes["paragraph"]?.create(null, node)?.content;
    expect(fragment).toBeDefined();
    if (fragment === undefined) return;
    expect(
      serializeHtml(fragment, () => {
        throw new Error("an empty id must not reach the resolver");
      }),
    ).toContain('data-corpus-ref=""');
  });
});

describe("the rich-text flavor", () => {
  it("carries real structure for a multi-block selection", () => {
    const html = serializeHtml(docNode(BODY).content, noRefTargets);
    expect(html).toContain("<h1>Quarterly memo</h1>");
    expect(html).toContain("<h2>Findings</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<pre><code class="language-ts">const x = 1;</code></pre>');
  });
});

describe("pasted Google Docs HTML", () => {
  it("keeps headings, emphasis, both list kinds and the table", () => {
    expect(pasteToMarkdown(GOOGLE_DOCS_HTML)).toBe(
      [
        "# Quarterly memo",
        "",
        "Lead paragraph with **bold**, *italic* and underlined copy.",
        "",
        "## Findings",
        "",
        "- first bullet",
        "- **second** bullet",
        "",
        "1. step one",
        "2. step two",
        "",
        "See [the rates page](https://example.com/rates) for the numbers.",
        "",
        "| **Lender** | **Spread** |",
        "| ---------- | ---------- |",
        "| Acme       | 6.1%       |",
        "",
      ].join("\n"),
    );
  });

  it("leaks no HTML into the saved markdown", () => {
    const markdown = pasteToMarkdown(GOOGLE_DOCS_HTML);
    expect(markdown).not.toContain("<span");
    expect(markdown).not.toContain("style=");
    expect(markdown).not.toContain("docs-internal-guid");
    expect(markdown).not.toContain("<br");
  });

  it("degrades an unsupported construct to its text rather than dropping it", () => {
    // Underline has no place in this schema; the words still arrive.
    expect(pasteToMarkdown(GOOGLE_DOCS_HTML)).toContain("and underlined copy");
  });

  it("unwraps the redirect Google Docs puts on every link", () => {
    expect(pasteToMarkdown(GOOGLE_DOCS_HTML)).toContain("(https://example.com/rates)");
    expect(pasteToMarkdown(GOOGLE_DOCS_HTML)).not.toContain("google.com/url");
  });
});

describe("cleaning pasted HTML", () => {
  it("unwraps the docs-internal-guid wrapper without losing its children", () => {
    const html = cleanPastedHtml(
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p>kept</p></b>',
    );
    expect(html).toBe("<p>kept</p>");
  });

  it("leaves an ordinary <b> alone", () => {
    expect(cleanPastedHtml(fromDocs("<p><b>bold</b></p>"))).toBe("<p><b>bold</b></p>");
  });

  it("drops a <br> between blocks and keeps one inside a paragraph", () => {
    expect(cleanPastedHtml(fromDocs("<p>one<br>two</p><br><p>three</p>"))).toBe(
      "<p>one<br>two</p><p>three</p>",
    );
  });

  it.each([
    ["a heading", "<h2>a<br>b</h2>"],
    ["a list item", "<ul><li>a<br>b</li></ul>"],
    ["a table cell", "<table><tbody><tr><td>a<br>b</td></tr></tbody></table>"],
    // The middle ground the allowlist missed: an element that is not a block
    // *host* by name, but whose contents are still text with a break in them.
    ["a div", "<div>a<br>b</div>"],
    ["a span", "<p><span>a<br>b</span></p>"],
    ["a section", "<section>a<br>b</section>"],
    ["an unnamed element", "<x-note>a<br>b</x-note>"],
  ])("keeps a <br> inside %s", (_name, html) => {
    expect(cleanPastedHtml(fromDocs(html))).toContain("<br>");
  });

  /**
   * UI-048 item 1. A run of breaks used to keep itself alive: `<br>` is inline in
   * HTML, so each break in `<p>A</p><br><br><p>B</p>` — an empty paragraph in a
   * Docs selection — saw the other as content it was separating, and two stray
   * `\` lines reached the saved markdown.
   */
  it("drops a run of <br> between blocks, not just a single one", () => {
    expect(cleanPastedHtml(fromDocs("<p>A</p><br><br><p>B</p>"))).toBe("<p>A</p><p>B</p>");
    expect(cleanPastedHtml(fromDocs("<p>A</p><br><br><br><p>B</p>"))).toBe("<p>A</p><p>B</p>");
  });

  /**
   * …and the other side of that trade, which is why the rule reads neighbours
   * rather than counting breaks: a deliberate blank line between two runs of
   * text is what every mail client writes, and both of its breaks still take
   * their answer from real content.
   */
  it("keeps a deliberate blank line between two runs of text", () => {
    expect(cleanPastedHtml(fromDocs("<div>one<br><br>two</div>"))).toBe(
      "<div>one<br><br>two</div>",
    );
  });

  it("rewrites only the redirects it can read a destination out of", () => {
    expect(
      cleanPastedHtml(
        fromDocs('<a href="https://www.google.com/url?q=https://x.test/a&amp;sa=D">x</a>'),
      ),
    ).toContain('href="https://x.test/a"');
    // No `q`: nothing better is known, so the link is left exactly as it came.
    expect(cleanPastedHtml(fromDocs('<a href="https://www.google.com/url?sa=D">x</a>'))).toContain(
      'href="https://www.google.com/url?sa=D"',
    );
    expect(cleanPastedHtml(fromDocs('<a href="https://example.com/direct">x</a>'))).toContain(
      'href="https://example.com/direct"',
    );
  });

  it("hands the HTML back untouched where there is no DOM to parse it with", () => {
    expect(cleanPastedHtml(fromDocs("<p>x</p>"), () => null)).toBe(fromDocs("<p>x</p>"));
  });
});

/**
 * The paste that is *not* Google Docs (PR #19 review, MAJOR + MINOR 1).
 *
 * Everything above describes a payload carrying the Docs signature. Every other
 * clipboard in the world must reach ProseMirror's own parser exactly as it
 * arrived: it has a `wrapMap` that re-hosts a bare `<tr>` fragment inside a
 * table, and a `<style>`-folding pass that turns a word processor's
 * class-plus-stylesheet emphasis into marks. A DOMParser round trip in front of
 * it silently loses both, and the `<br>` rule lost text outright.
 */
describe("a paste from anywhere but Google Docs", () => {
  it("is handed on untouched, byte for byte", () => {
    const gmail = "<div>line one<br>line two</div>";
    expect(cleanPastedHtml(gmail)).toBe(gmail);
  });

  it("leaves a bare table fragment for the parser's wrapMap to re-host", () => {
    // A DOMParser round trip drops the cells on the floor: `<tr>` outside a
    // `<table>` is not a tree the HTML parser will build.
    const fragment = "<tr><td>Acme</td><td>6.1%</td></tr>";
    expect(cleanPastedHtml(fragment)).toBe(fragment);
  });

  it("leaves a Word payload's <style> block where the parser can fold it", () => {
    // Word and Outlook express emphasis as a class plus a stylesheet in <head>;
    // parsing to a body and re-serialising it throws the stylesheet away.
    const word =
      "<html><head><style>.c1 { font-weight: bold }</style></head>" +
      '<body><p class="c1">strong words</p></body></html>';
    expect(cleanPastedHtml(word)).toBe(word);
  });

  it.each([
    ["a div", "<div>line one<br>line two</div>"],
    ["a span", "<span>line one<br>line two</span>"],
    ["a section", "<section>line one<br>line two</section>"],
  ])("keeps both lines of a %s separated, all the way to the markdown", (_name, html) => {
    // The regression this file exists to prevent: the two lines arriving welded
    // into `line oneline two`, which is what a hand-listed allowlist of block
    // hosts produced for every clipboard Gmail, Outlook web or Slack writes.
    expect(pasteToMarkdown(html)).toBe("line one\\\nline two\n");
  });
});
