import { remarkCorpusRefs } from "@corpus/kit";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";
import { refAttributesOf, sourceOf, type MdNode, type MdRoot } from "./mdast.js";
import { MARK, NODE, type PmMark, type PmNode } from "./schema.js";

/**
 * markdown → ProseMirror, half of the round trip (`serialize.ts` is the other).
 *
 * **remark parses; this module maps.** Hand-rolling a markdown parser to feed an
 * editor is how an editor ends up disagreeing with the renderer beside it about
 * what a document says: `MarkdownView` renders through `react-markdown`, which
 * is remark, so parsing here with anything else would make the reader and the
 * editor two different readings of one file. What is written by hand is the
 * part that is genuinely ours — the walk from mdast to the schema in
 * `schema.ts`, keyed on node type, one case per construct.
 *
 * `[[ref]]` is **not** re-parsed here either. The kit's `remarkCorpusRefs` runs
 * in the pipeline and this module only reads the `{id, alias}` it produced, so
 * the grammar of a reference is stated exactly once in the repo
 * (sprint-011 Adjudication 7).
 */

/**
 * The pipeline, built once. `unified()` freezes on first use; rebuilding it per
 * parse would re-run plugin setup for every keystroke's worth of paste.
 */
let processor: Processor | undefined;

function markdownProcessor(): Processor {
  processor ??= unified()
    .use(remarkParse)
    .use(remarkGfm)
    // Typed loosely on purpose: the kit exports a plain mdast transform rather
    // than a unified-typed plugin, precisely so it does not drag unified's
    // types into every consumer.
    .use(remarkCorpusRefs as never)
    .freeze() as unknown as Processor;
  return processor;
}

/**
 * The mdast tree for a body, for callers that want the intermediate form.
 *
 * `parse` runs the *parser* only; `runSync` is what runs the attached
 * transformers, and `remarkCorpusRefs` is one. Skipping it is a silent failure
 * — the tree is valid mdast, every ref is still ordinary text, and nothing
 * downstream can tell the difference until a reference stops resolving.
 */
export function parseToMdast(markdown: string): MdRoot {
  const processorInstance = markdownProcessor();
  const tree = processorInstance.parse(markdown);
  // `MdRoot` is this repo's structural view of mdast (see `mdast.ts`); unified
  // types the tree with `@types/mdast`'s nominal one.
  return processorInstance.runSync(tree) as unknown as MdRoot;
}

/**
 * A document body as a ProseMirror JSON document.
 *
 * Always at least one paragraph: `doc` is `block+`, so an empty body — a file
 * that is frontmatter and nothing else — becomes one empty paragraph rather
 * than an invalid document. Serialising that back yields `""`, not `"\n\n"`
 * (sprint-011 TEST-10).
 */
export function parseMarkdown(markdown: string): PmNode {
  const tree = parseToMdast(markdown);
  const content = blockNodes(tree.children, markdown);
  return {
    type: NODE.doc,
    content: content.length === 0 ? [emptyParagraph()] : content,
  };
}

function emptyParagraph(): PmNode {
  return { type: NODE.paragraph };
}

/**
 * Whether a run of plain text is worth reading as markdown.
 *
 * Pasting `## Heading` into a document that renders markdown should produce a
 * heading — that is the whole promise of a markdown editor, and the alternative
 * is a paragraph of literal hashes the user then has to retype. But *every*
 * paste is not markdown: a pasted sentence, a pasted URL, a pasted snippet of
 * prose has no structure to find, and running it through the parser only risks
 * finding some.
 *
 * So the test is for a construct, not for plausibility: a block marker at the
 * start of a line, or an inline construct anywhere. Prose with none of them is
 * inserted as the text it is.
 */
const MARKDOWN_CONSTRUCT =
  /(^|\n) {0,3}(#{1,6} |[-*+] |\d{1,9}[.)] |> |```|~~~|\||\[\^)|\*\*|__|~~|`[^`\n]+`|\[[^\]\n]*\]\(|!\[[^\]\n]*\]\(|\[\[[A-Za-z][A-Za-z0-9]*_/;

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_CONSTRUCT.test(text);
}

function node(type: string, content?: readonly PmNode[], attrs?: Record<string, unknown>): PmNode {
  return {
    type,
    ...(attrs === undefined ? {} : { attrs }),
    ...(content === undefined || content.length === 0 ? {} : { content }),
  };
}

/* ── Blocks ─────────────────────────────────────────────────────────── */

function blockNodes(children: readonly MdNode[], source: string): PmNode[] {
  const out: PmNode[] = [];
  for (const child of children) {
    const mapped = blockNode(child, source);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function blockNode(md: MdNode, source: string): PmNode | null {
  switch (md.type) {
    case "paragraph":
      return node(NODE.paragraph, inlineNodes(md.children ?? [], [], source));
    case "heading":
      return node(NODE.heading, inlineNodes(md.children ?? [], [], source), {
        level: clampLevel(md.depth),
      });
    case "blockquote":
      return node(NODE.blockquote, orEmptyParagraph(blockNodes(md.children ?? [], source)));
    case "list":
      return listNode(md, source);
    case "code":
      return codeBlockNode(md);
    case "thematicBreak":
      return node(NODE.horizontalRule);
    case "table":
      return tableNode(md, source);
    // `yaml` is the frontmatter block. The server strips frontmatter before it
    // hands over `doc.body`, so seeing one here means the body itself opens
    // with `---` — preserved verbatim rather than swallowed.
    default:
      return rawBlockNode(md, source);
  }
}

function orEmptyParagraph(content: PmNode[]): PmNode[] {
  return content.length === 0 ? [emptyParagraph()] : content;
}

function clampLevel(depth: number | undefined): number {
  if (typeof depth !== "number" || !Number.isFinite(depth)) return 1;
  return Math.min(6, Math.max(1, Math.round(depth)));
}

function codeBlockNode(md: MdNode): PmNode {
  const value = md.value ?? "";
  const language = typeof md.lang === "string" && md.lang !== "" ? md.lang : null;
  return node(NODE.codeBlock, value === "" ? [] : [{ type: NODE.text, text: value }], { language });
}

function listNode(md: MdNode, source: string): PmNode {
  const items = (md.children ?? []).filter((child) => child.type === "listItem");
  const isTask = items.some((item) => item.checked === true || item.checked === false);
  if (isTask) {
    return node(
      NODE.taskList,
      items.map((item) =>
        node(NODE.taskItem, listItemContent(item, source), { checked: item.checked === true }),
      ),
    );
  }
  const children = items.map((item) => node(NODE.listItem, listItemContent(item, source)));
  if (md.ordered === true) {
    return node(NODE.orderedList, children, { start: typeof md.start === "number" ? md.start : 1 });
  }
  return node(NODE.bulletList, children);
}

/**
 * A list item's blocks, with a paragraph guaranteed first.
 *
 * `listItem` is `paragraph block*` in the schema, and markdown allows an item
 * that opens with a nested list (`- - a`). Prepending an empty paragraph keeps
 * such an item representable instead of dropping it.
 */
function listItemContent(md: MdNode, source: string): PmNode[] {
  const blocks = blockNodes(md.children ?? [], source);
  if (blocks.length === 0) return [emptyParagraph()];
  if (blocks[0]?.type !== NODE.paragraph) return [emptyParagraph(), ...blocks];
  return blocks;
}

function tableNode(md: MdNode, source: string): PmNode {
  const rows = (md.children ?? []).filter((child) => child.type === "tableRow");
  if (rows.length === 0) return rawBlockNode(md, source) ?? emptyParagraph();
  const align: (string | null)[] | null =
    md.align === null || md.align === undefined ? null : [...md.align];
  const content = rows.map((row, index) =>
    node(
      NODE.tableRow,
      (row.children ?? []).map((cell) =>
        node(
          index === 0 ? NODE.tableHeader : NODE.tableCell,
          orEmptyParagraph([node(NODE.paragraph, inlineNodes(cell.children ?? [], [], source))]),
          { colspan: 1, rowspan: 1, colwidth: null },
        ),
      ),
    ),
  );
  return node(NODE.table, content, { align });
}

function rawBlockNode(md: MdNode, source: string): PmNode | null {
  const raw = sourceOf(md, source);
  if (raw === null) return null;
  return node(NODE.rawBlock, undefined, { source: raw });
}

/* ── Inline ─────────────────────────────────────────────────────────── */

function withMark(marks: readonly PmMark[], mark: PmMark): PmMark[] {
  return marks.some((existing) => existing.type === mark.type) ? [...marks] : [...marks, mark];
}

function inlineNodes(
  children: readonly MdNode[],
  marks: readonly PmMark[],
  source: string,
): PmNode[] {
  const out: PmNode[] = [];
  for (const child of children) out.push(...inlineNode(child, marks, source));
  return out;
}

function textNode(value: string, marks: readonly PmMark[]): PmNode[] {
  // ProseMirror rejects an empty text node outright, and an empty one carries
  // no information anyway.
  if (value === "") return [];
  return [{ type: NODE.text, text: value, ...(marks.length === 0 ? {} : { marks: [...marks] }) }];
}

function inlineNode(md: MdNode, marks: readonly PmMark[], source: string): PmNode[] {
  const ref = refAttributesOf(md);
  if (ref !== null) {
    // Marks carry through: `**[[doc_x|alias]]**` is a bolded reference, and
    // dropping the mark here would un-bold it on the next save.
    return [
      {
        type: NODE.docRef,
        attrs: { id: ref.id, alias: ref.alias },
        ...(marks.length === 0 ? {} : { marks: [...marks] }),
      },
    ];
  }

  switch (md.type) {
    case "text":
      return textNode(md.value ?? "", marks);
    case "strong":
      return inlineNodes(md.children ?? [], withMark(marks, { type: MARK.bold }), source);
    case "emphasis":
      return inlineNodes(md.children ?? [], withMark(marks, { type: MARK.italic }), source);
    case "delete":
      return inlineNodes(md.children ?? [], withMark(marks, { type: MARK.strike }), source);
    case "inlineCode":
      return textNode(md.value ?? "", withMark(marks, { type: MARK.code }));
    case "link":
      return inlineNodes(
        md.children ?? [],
        withMark(marks, {
          type: MARK.link,
          attrs: { href: md.url ?? "", title: md.title ?? null },
        }),
        source,
      );
    case "image":
      return [
        {
          type: NODE.image,
          attrs: { src: md.url ?? "", alt: md.alt ?? null, title: md.title ?? null },
          ...(marks.length === 0 ? {} : { marks: [...marks] }),
        },
      ];
    case "break":
      return [{ type: NODE.hardBreak, ...(marks.length === 0 ? {} : { marks: [...marks] }) }];
    default: {
      const raw = sourceOf(md, source);
      if (raw === null) {
        // No position and no known type: the only content left to keep is
        // whatever text hangs below it.
        return inlineNodes(md.children ?? [], marks, source);
      }
      return [
        {
          type: NODE.rawInline,
          attrs: { text: raw },
          ...(marks.length === 0 ? {} : { marks: [...marks] }),
        },
      ];
    }
  }
}
