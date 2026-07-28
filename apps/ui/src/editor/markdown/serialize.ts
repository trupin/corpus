import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified, type Processor } from "unified";
import { numberAttr, optionalStringAttr, stringAttr } from "./attrs.js";
import { escapeMarkdownText } from "./escape.js";
import type { MdNode, MdRoot } from "./mdast.js";
import { parseMarkdown } from "./parse.js";
import { refSource } from "./refNode.js";
import { MARK, NODE, type PmMark, type PmNode } from "./schema.js";

/**
 * ProseMirror → markdown. The other half of the round trip, and the module
 * UI-007's offset map is derived from.
 *
 * **An explicit walk, keyed on node and mark type.** Nothing here converts HTML
 * to markdown (sprint-011 TEST-9): the editor's document is a ProseMirror tree
 * over the schema in `schema.ts`, and every case below names a node or a mark
 * from that schema. The tree it produces is mdast, which is then *printed* by
 * `remark-stringify` — the same family that parsed it. Printing is deliberately
 * not hand-rolled: list indentation, fence widening, blockquote prefixing and
 * table padding are where a hand-rolled printer produces markdown that parses
 * back as something else, and they have exactly one correct answer.
 *
 * What *is* hand-rolled is escaping, because the printer's defensive answer
 * rewrites untouched prose (`escape.ts`). The two are reconciled by
 * {@link serializeDoc}: it prints twice — once minimally escaped, once with the
 * printer's own escaping — parses both back, and keeps the minimal output only
 * when the two parse identically. Byte-minimal diffs when the rules hold,
 * defensive output when they do not, and never a document that means something
 * else.
 *
 * The normalisation the output commits to (sprint-011 TEST-8):
 *
 * - headings are ATX (`## `), never setext;
 * - bullets are `- `, ordered markers keep the source's first number;
 * - bold is `**`, italic is `*`;
 * - fences are ``` and keep their language string;
 * - exactly one blank line between block nodes;
 * - the file ends with exactly one `\n`, and an empty body is `""`.
 */

/** Custom mdast node types this module emits and teaches the printer to print. */
const REF_TYPE = "corpusRef";
const RAW_BLOCK_TYPE = "corpusRawBlock";
const RAW_INLINE_TYPE = "corpusRawInline";
const AUTOLINK_TYPE = "corpusAutolink";

/* ── ProseMirror → mdast ────────────────────────────────────────────── */

export function toMdast(doc: PmNode): MdRoot {
  return { type: "root", children: blockChildren(doc.content ?? []) };
}

function blockChildren(nodes: readonly PmNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (const child of nodes) {
    const mapped = blockNode(child);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

function attr(node: PmNode, name: string): unknown {
  return node.attrs?.[name];
}

function blockNode(node: PmNode): MdNode | null {
  switch (node.type) {
    case NODE.paragraph:
      return { type: "paragraph", children: blockInlineChildren(node.content ?? []) };
    case NODE.heading:
      return {
        type: "heading",
        depth: numberAttr(attr(node, "level"), 1),
        children: blockInlineChildren(node.content ?? []),
      };
    case NODE.blockquote:
      return { type: "blockquote", children: blockChildren(node.content ?? []) };
    case NODE.bulletList:
      return {
        type: "list",
        ordered: false,
        start: null,
        spread: false,
        children: listItems(node.content ?? [], null),
      };
    case NODE.orderedList:
      return {
        type: "list",
        ordered: true,
        start: numberAttr(attr(node, "start"), 1),
        spread: false,
        children: listItems(node.content ?? [], null),
      };
    case NODE.taskList:
      return {
        type: "list",
        ordered: false,
        start: null,
        spread: false,
        children: listItems(node.content ?? [], "task"),
      };
    case NODE.codeBlock:
      return {
        type: "code",
        lang: optionalStringAttr(attr(node, "language")),
        meta: null,
        value: textOf(node.content ?? []),
      };
    case NODE.horizontalRule:
      return { type: "thematicBreak" };
    case NODE.table:
      return tableMdast(node);
    case NODE.rawBlock:
      return { type: RAW_BLOCK_TYPE, value: stringAttr(attr(node, "source")) };
    default:
      // A block the schema grew and this walk has not learned yet. Dropping it
      // would delete the user's text; a paragraph of its text content is the
      // conservative reading.
      return { type: "paragraph", children: blockInlineChildren(node.content ?? []) };
  }
}

function listItems(nodes: readonly PmNode[], kind: "task" | null): MdNode[] {
  return nodes.map((item) => ({
    type: "listItem",
    spread: false,
    checked: kind === "task" ? attr(item, "checked") === true : null,
    children: blockChildren(item.content ?? []),
  }));
}

function textOf(nodes: readonly PmNode[]): string {
  return nodes.map((child) => child.text ?? "").join("");
}

function tableMdast(node: PmNode): MdNode {
  const rawAlign = attr(node, "align");
  const align = Array.isArray(rawAlign)
    ? rawAlign.map((entry) => (typeof entry === "string" ? entry : null))
    : null;
  return {
    type: "table",
    align,
    children: (node.content ?? []).map((row) => ({
      type: "tableRow",
      children: (row.content ?? []).map((cell) => ({
        type: "tableCell",
        // A cell is phrasing in markdown but `block+` in ProseMirror; flatten
        // its paragraphs rather than emitting a table GFM cannot express.
        children: (cell.content ?? []).flatMap((block) => inlineChildren(block.content ?? [])),
      })),
    })),
  };
}

/* ── Inline ─────────────────────────────────────────────────────────── */

/** Marks in the order they must nest: link outermost, then strike/bold/italic, code innermost. */
const MARK_ORDER: readonly string[] = [MARK.link, MARK.strike, MARK.bold, MARK.italic, MARK.code];

function markRank(mark: PmMark): number {
  const index = MARK_ORDER.indexOf(mark.type);
  return index === -1 ? MARK_ORDER.length : index;
}

function sortedMarks(marks: readonly PmMark[]): PmMark[] {
  return [...marks].sort((left, right) => markRank(left) - markRank(right));
}

function sameMark(left: PmMark, right: PmMark): boolean {
  return (
    left.type === right.type &&
    JSON.stringify(left.attrs ?? {}) === JSON.stringify(right.attrs ?? {})
  );
}

/**
 * Inline content, with mark runs rebuilt into nesting.
 *
 * ProseMirror keeps marks per text node; markdown nests them. Consecutive nodes
 * sharing a mark have to become one `strong`/`emphasis` node or the output is
 * `**a****b**` — which parses back as two emphases with an empty one between.
 */
function inlineChildren(nodes: readonly PmNode[]): MdNode[] {
  return runsToMdast(nodes, []);
}

/**
 * The same, with trailing whitespace dropped from the end of the block.
 *
 * Markdown has no spelling for a space at the end of a line. The printer's
 * faithful one is the character reference `&#x20;` — observed landing in a real
 * document the first time a `[[ref]]` ended a paragraph — and a file full of
 * `&#x20;` is worse than a lost space nobody can see. Whitespace *inside* a
 * block is untouched, and a code block never comes through here, so the only
 * thing this discards is a character markdown was going to discard anyway.
 */
function blockInlineChildren(nodes: readonly PmNode[]): MdNode[] {
  const children = inlineChildren(nodes);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child === undefined || child.type !== "text") break;
    const trimmed = (child.value ?? "").replace(/[ \t]+$/, "");
    if (trimmed === (child.value ?? "")) break;
    if (trimmed === "") {
      children.splice(index, 1);
      continue;
    }
    child.value = trimmed;
    break;
  }
  return children;
}

function runsToMdast(nodes: readonly PmNode[], applied: readonly PmMark[]): MdNode[] {
  const out: MdNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const current = nodes[index];
    if (current === undefined) break;
    const outstanding = sortedMarks(current.marks ?? []).filter(
      (mark) => !applied.some((existing) => sameMark(existing, mark)),
    );
    const next = outstanding[0];
    if (next === undefined) {
      out.push(...leafToMdast(current));
      index += 1;
      continue;
    }
    // Every following node carrying the same mark belongs inside this wrapper.
    let end = index + 1;
    while (end < nodes.length && (nodes[end]?.marks ?? []).some((mark) => sameMark(mark, next))) {
      end += 1;
    }
    const inner = runsToMdast(nodes.slice(index, end), [...applied, next]);
    out.push(wrapMark(next, inner));
    index = end;
  }
  return out;
}

function wrapMark(mark: PmMark, children: MdNode[]): MdNode {
  switch (mark.type) {
    case MARK.bold:
      return { type: "strong", children };
    case MARK.italic:
      return { type: "emphasis", children };
    case MARK.strike:
      return { type: "delete", children };
    case MARK.code: {
      // `inlineCode` is a leaf in mdast: its value is the concatenated text,
      // and any nested emphasis inside a code span was never emphasis anyway.
      return { type: "inlineCode", value: plainText(children) };
    }
    case MARK.link: {
      const node: MdNode = {
        type: "link",
        url: stringAttr(mark.attrs?.["href"]),
        title: optionalStringAttr(mark.attrs?.["title"]),
        children,
      };
      return isAutolinkShaped(node) ? { type: AUTOLINK_TYPE, value: plainText(children) } : node;
    }
    default:
      return { type: "paragraph", children };
  }
}

/**
 * Whether a link is one GFM would have produced from a bare URL.
 *
 * `https://example.com` in prose parses as a link whose text *is* its URL. The
 * printer would write it back as `<https://example.com>` — correct, stable, and
 * a diff on every bare URL in the document the first time anything is saved.
 * Emitting it bare keeps the file as the author wrote it.
 */
function isAutolinkShaped(node: MdNode): boolean {
  if (node.title !== null && node.title !== undefined) return false;
  const children = node.children ?? [];
  if (children.length !== 1 || children[0]?.type !== "text") return false;
  const text = children[0].value ?? "";
  if (text === "" || /\s/.test(text)) return false;
  const url = node.url ?? "";
  return url === text || url === `http://${text}` || url === `mailto:${text}`;
}

function plainText(nodes: readonly MdNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text" || node.value !== undefined
        ? (node.value ?? "")
        : plainText(node.children ?? []),
    )
    .join("");
}

function leafToMdast(node: PmNode): MdNode[] {
  switch (node.type) {
    case NODE.text:
      return node.text === undefined || node.text === ""
        ? []
        : [{ type: "text", value: node.text }];
    case NODE.hardBreak:
      return [{ type: "break" }];
    case NODE.docRef:
      return [
        {
          type: REF_TYPE,
          value: refSource({
            id: stringAttr(attr(node, "id")),
            alias: optionalStringAttr(attr(node, "alias")),
          }),
        },
      ];
    case NODE.image:
      return [
        {
          type: "image",
          url: stringAttr(attr(node, "src")),
          alt: optionalStringAttr(attr(node, "alt")),
          title: optionalStringAttr(attr(node, "title")),
        },
      ];
    case NODE.rawInline:
      return [{ type: RAW_INLINE_TYPE, value: stringAttr(attr(node, "text")) }];
    default:
      return inlineChildren(node.content ?? []);
  }
}

/* ── mdast → markdown ───────────────────────────────────────────────── */

/**
 * Printer options. Every one of them is a normalisation rule this module
 * promises, so they are stated here rather than left to the printer's defaults.
 */
const PRINT_OPTIONS = {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  rule: "-",
  ruleRepetition: 3,
  ruleSpaces: false,
  // `listItemIndent: "one"` indents continuation by the marker width plus one
  // space — two columns for `- `, three for `1. ` — which is what markdown
  // written by hand looks like.
  listItemIndent: "one",
  incrementListMarker: true,
  resourceLink: false,
  setext: false,
} as const;

/** The printer's own view of the world, for the constructs it does not know. */
interface PrintState {
  readonly stack: readonly string[];
  safe(value: string, info: unknown): string;
}

interface PrintInfo {
  readonly before?: string;
  readonly after?: string;
}

type PrintHandler = (node: MdNode, parent: unknown, state: PrintState, info: PrintInfo) => string;

function verbatim(node: MdNode): string {
  return node.value ?? "";
}

/**
 * A bare URL, but only where one would be read back as a link.
 *
 * GFM's autolink literal needs a word boundary in front of it. Directly after a
 * letter it is plain text, so in that position the ordinary link form is the
 * only honest output.
 */
function autolinkHandler(
  node: MdNode,
  _parent: unknown,
  _state: PrintState,
  info: PrintInfo,
): string {
  const before = info.before ?? "";
  const value = node.value ?? "";
  if (before === "" || /[\s(>]$/.test(before)) return value;
  return `[${value}](${value})`;
}

function handlers(escapeText: boolean): Record<string, PrintHandler> {
  return {
    [REF_TYPE]: verbatim,
    [RAW_BLOCK_TYPE]: verbatim,
    [RAW_INLINE_TYPE]: verbatim,
    [AUTOLINK_TYPE]: autolinkHandler,
    text: (node, _parent, state, info) => {
      const value = node.value ?? "";
      // Inside a table the pipe is structural, and the printer's own escaping
      // is the only thing that knows it. Minimal escaping never applies there.
      if (!escapeText || state.stack.includes("tableCell")) return state.safe(value, info);
      return escapeMarkdownText(value, { before: info.before ?? "", after: info.after ?? "" });
    },
  };
}

let minimalPrinter: Processor | undefined;
let defensivePrinter: Processor | undefined;

function printer(escapeText: boolean): Processor {
  if (escapeText) {
    minimalPrinter ??= unified()
      .use(remarkStringify, { ...PRINT_OPTIONS, handlers: handlers(true) })
      .use(remarkGfm)
      .freeze() as unknown as Processor;
    return minimalPrinter;
  }
  defensivePrinter ??= unified()
    .use(remarkStringify, { ...PRINT_OPTIONS, handlers: handlers(false) })
    .use(remarkGfm)
    .freeze() as unknown as Processor;
  return defensivePrinter;
}

function print(tree: MdRoot, escapeText: boolean): string {
  return String(printer(escapeText).stringify(tree as never));
}

/**
 * Exactly one trailing newline, and nothing at all for an empty document
 * (sprint-011 TEST-10).
 */
export function normalizeBody(text: string): string {
  const trimmed = text.replace(/\n+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/**
 * The document as markdown.
 *
 * Printed minimally, verified against the printer's own defensive escaping, and
 * downgraded to that output when the two disagree. The comparison is between
 * the two *parses*, not the two strings: defensive escaping is definitionally
 * meaning-preserving, so a minimal output that parses to the same document is
 * meaning-preserving too — and one that does not is a bug in `escape.ts`
 * caught before it reaches disk.
 */
export function serializeDoc(doc: PmNode): string {
  const tree = toMdast(doc);
  const minimal = normalizeBody(print(tree, true));
  const defensive = normalizeBody(print(tree, false));
  if (minimal === defensive) return minimal;
  const sameMeaning =
    JSON.stringify(parseMarkdown(minimal)) === JSON.stringify(parseMarkdown(defensive));
  return sameMeaning ? minimal : defensive;
}

/** `serializeDoc(parseMarkdown(md))` — the round trip, as one call. */
export function canonicalizeMarkdown(markdown: string): string {
  return serializeDoc(parseMarkdown(markdown));
}
