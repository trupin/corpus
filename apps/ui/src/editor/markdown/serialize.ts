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

/* ── Position trace (UI-007's offset map, at its source) ────────────── */

/**
 * One contiguous run of **content** with both of its addresses: the
 * ProseMirror range that produced it, and the markdown range the printer put it
 * in.
 *
 * A run is content only. Syntax the printer adds — `## `, `- `, `**`, a fence
 * line, a blockquote's `> ` — belongs to no ProseMirror text and appears in no
 * run, which is exactly what lets the offset map say that an offset landing in
 * it is not addressable and snap to the nearest content boundary.
 *
 * Inside a non-atomic run the two addresses advance one-for-one, so mapping is
 * a binary search plus arithmetic. Escaping breaks that correspondence, so a
 * run is **split** at each inserted character rather than carrying a correction
 * table: `a*b` printed as `a\*b` is three runs, each 1:1.
 */
export interface TraceRun {
  readonly pmFrom: number;
  readonly pmTo: number;
  readonly mdStart: number;
  readonly mdEnd: number;
  /** Index of the textblock this run sits in; a PM inline decoration never spans two. */
  readonly block: number;
  /** Whole-or-nothing. A `[[ref]]` has one address, not one per bracket. */
  readonly atomic: boolean;
}

export interface TracedSerialization {
  readonly markdown: string;
  readonly trace: readonly TraceRun[];
}

/**
 * Nodes with no content of their own: size 1, and nothing inside them has an
 * address of its own.
 *
 * Hand-listed rather than read from `corpusSchema()` so that serialising never
 * needs the extension list built (and therefore never needs a DOM). It is a
 * duplicate of a fact the schema owns, so `serialize.test.ts` asserts the two
 * agree — drift is a test failure, not a silently shifted trace.
 */
export const LEAF_NODES: ReadonlySet<string> = new Set([
  NODE.hardBreak,
  NODE.image,
  NODE.docRef,
  NODE.horizontalRule,
  NODE.rawBlock,
  NODE.rawInline,
]);

/** Nodes whose children are inline. Each is one decoration horizon. */
export const TEXT_BLOCKS: ReadonlySet<string> = new Set([
  NODE.paragraph,
  NODE.heading,
  NODE.codeBlock,
]);

interface PmSpan {
  readonly from: number;
  readonly to: number;
  readonly block: number;
}

interface TracedSpan extends PmSpan {
  readonly atomic: boolean;
}

/**
 * Where every node of the ProseMirror JSON sits, by ProseMirror's own counting:
 * a text node is its length, a leaf is 1, everything else is 2 plus its
 * content. Keyed by object identity, which `Node.toJSON()` makes unique per
 * node.
 */
function indexPositions(doc: PmNode): Map<PmNode, PmSpan> {
  const spans = new Map<PmNode, PmSpan>();
  let blocks = 0;

  const visit = (node: PmNode, from: number, block: number): number => {
    if (node.type === NODE.text) {
      const size = node.text?.length ?? 0;
      spans.set(node, { from, to: from + size, block });
      return size;
    }
    if (LEAF_NODES.has(node.type)) {
      spans.set(node, { from, to: from + 1, block });
      return 1;
    }
    const own = TEXT_BLOCKS.has(node.type) ? (blocks += 1) : block;
    let inner = from + 1;
    for (const child of node.content ?? []) inner += visit(child, inner, own);
    spans.set(node, { from, to: inner + 1, block: own });
    return inner + 1 - from;
  };

  let position = 0;
  for (const child of doc.content ?? []) position += visit(child, position, 0);
  return spans;
}

/**
 * Serialisation-scoped state. Both are set for the duration of one traced
 * `serializeDoc` call and cleared in its `finally` — printing is synchronous,
 * so there is never a second walk in flight to confuse them, and an untraced
 * call leaves both null and pays nothing.
 */
let pmSpans: Map<PmNode, PmSpan> | null = null;
let emissions: Map<MdNode, string> | null = null;

/** mdast node → the ProseMirror range it came from. Per-call keys, so a WeakMap. */
const mdSpans = new WeakMap<MdNode, TracedSpan>();

/** Records a leaf's origin, when the walk is tracing. */
function traceLeaf(source: PmNode, node: MdNode, atomic: boolean): MdNode {
  const span = pmSpans?.get(source);
  if (span !== undefined) mdSpans.set(node, { ...span, atomic });
  return node;
}

/** Records the origin of a node built by collapsing others (`inlineCode`, an autolink). */
function traceCollapsed(node: MdNode, children: readonly MdNode[], atomic: boolean): MdNode {
  if (pmSpans === null) return node;
  const spans = children.map((child) => mdSpans.get(child)).filter((span) => span !== undefined);
  const first = spans[0];
  const last = spans.at(-1);
  if (first === undefined || last === undefined) return node;
  mdSpans.set(node, { from: first.from, to: last.to, block: first.block, atomic });
  return node;
}

/** Records what the printer actually wrote for a node. */
function emit(node: MdNode, text: string): string {
  emissions?.set(node, text);
  return text;
}

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
    case NODE.codeBlock: {
      const code: MdNode = {
        type: "code",
        lang: optionalStringAttr(attr(node, "language")),
        meta: null,
        value: textOf(node.content ?? []),
      };
      // A fence's content is its text children end to end, so the run is the
      // block's *content* range — inside the two positions the node itself
      // occupies.
      const span = pmSpans?.get(node);
      if (span !== undefined) {
        mdSpans.set(code, {
          from: span.from + 1,
          to: span.to - 1,
          block: span.block,
          atomic: false,
        });
      }
      return code;
    }
    case NODE.horizontalRule:
      return { type: "thematicBreak" };
    case NODE.table:
      return tableMdast(node);
    case NODE.rawBlock:
      return traceLeaf(
        node,
        { type: RAW_BLOCK_TYPE, value: stringAttr(attr(node, "source")) },
        true,
      );
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
    const value = child.value ?? "";
    const trimmed = value.replace(/[ \t]+$/, "");
    if (trimmed === value) break;
    if (trimmed === "") {
      mdSpans.delete(child);
      children.splice(index, 1);
      continue;
    }
    child.value = trimmed;
    // The run is now shorter than the text it came from, and a trace that said
    // otherwise would claim addresses for characters the file does not have.
    const span = mdSpans.get(child);
    if (span !== undefined) {
      mdSpans.set(child, { ...span, to: span.to - (value.length - trimmed.length) });
    }
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
      return traceCollapsed({ type: "inlineCode", value: plainText(children) }, children, false);
    }
    case MARK.link: {
      const node: MdNode = {
        type: "link",
        url: stringAttr(mark.attrs?.["href"]),
        title: optionalStringAttr(mark.attrs?.["title"]),
        children,
      };
      return isAutolinkShaped(node)
        ? traceCollapsed({ type: AUTOLINK_TYPE, value: plainText(children) }, children, false)
        : node;
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
        : [traceLeaf(node, { type: "text", value: node.text }, false)];
    case NODE.hardBreak:
      return [{ type: "break" }];
    case NODE.docRef:
      return [
        traceLeaf(
          node,
          {
            type: REF_TYPE,
            value: refSource({
              id: stringAttr(attr(node, "id")),
              alias: optionalStringAttr(attr(node, "alias")),
            }),
          },
          // One address, not one per bracket: an offset anywhere inside
          // `[[doc_a1b2c3|alias]]` is the node (sprint-011 TEST-93).
          true,
        ),
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
      return [
        traceLeaf(node, { type: RAW_INLINE_TYPE, value: stringAttr(attr(node, "text")) }, true),
      ];
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
  return emit(node, node.value ?? "");
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
  if (before === "" || /[\s(>]$/.test(before)) return emit(node, value);
  // Written as a link, so the run's text is no longer the run's markdown: the
  // trace records the whole thing as one address rather than a wrong one.
  const span = mdSpans.get(node);
  if (span !== undefined) mdSpans.set(node, { ...span, atomic: true });
  return emit(node, `[${value}](${value})`);
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
      if (!escapeText || state.stack.includes("tableCell"))
        return emit(node, state.safe(value, info));
      return emit(
        node,
        escapeMarkdownText(value, { before: info.before ?? "", after: info.after ?? "" }),
      );
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

/* ── Aligning the emission back onto the output ─────────────────────── */

/** A stretch of a node's source text that the printer wrote out unchanged. */
interface Piece {
  /** Offset into the node's source text. */
  readonly sourceStart: number;
  /** Offset into what the printer wrote for the node. */
  readonly outStart: number;
  readonly text: string;
}

/**
 * The parts of `source` the printer wrote verbatim, in order.
 *
 * Escaping inserts characters (`*` → `\*`) rather than rewriting them, so a
 * greedy walk that matches each source character against the output recovers
 * an exact one-for-one correspondence in maximal stretches. A construct the
 * printer *replaced* rather than escaped (`&#x20;` for a trailing space) has no
 * such correspondence, and answering `null` is what makes the run atomic
 * instead of wrong.
 */
function alignPieces(source: string, out: string): Piece[] | null {
  const pieces: Piece[] = [];
  let sourceAt = 0;
  let outAt = 0;
  while (sourceAt < source.length) {
    const found = out.indexOf(source[sourceAt] ?? "", outAt);
    if (found === -1) return null;
    let length = 0;
    while (
      sourceAt + length < source.length &&
      found + length < out.length &&
      source[sourceAt + length] === out[found + length]
    ) {
      length += 1;
    }
    pieces.push({
      sourceStart: sourceAt,
      outStart: found,
      text: source.slice(sourceAt, sourceAt + length),
    });
    sourceAt += length;
    outAt = found + length;
  }
  return pieces;
}

/** Splits a piece at newlines: a line prefix (`> `, list indent) sits between them. */
function splitLines(piece: Piece): Piece[] {
  if (!piece.text.includes("\n")) return [piece];
  const out: Piece[] = [];
  let offset = 0;
  for (const line of piece.text.split("\n")) {
    if (line !== "") {
      out.push({
        sourceStart: piece.sourceStart + offset,
        outStart: piece.outStart + offset,
        text: line,
      });
    }
    offset += line.length + 1;
  }
  return out;
}

interface Located {
  readonly start: number;
  readonly end: number;
}

/** Finds each line of `text` in order, and reports the span from the first to the last. */
function locateAcrossLines(markdown: string, text: string, cursor: number): Located | null {
  let at = cursor;
  let start: number | null = null;
  let end = cursor;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const found = markdown.indexOf(line, at);
    if (found === -1) return null;
    start ??= found;
    end = found + line.length;
    at = end;
  }
  return start === null ? null : { start, end };
}

/**
 * The runs one mdast leaf contributes, appended in place; returns the new cursor.
 *
 * The whole emission is located first, in one search: it is the longest and
 * therefore the least ambiguous string available, and finding it fixes every
 * piece inside it by arithmetic rather than by a second search for a fragment
 * short enough to match the wrong place. Only a multi-line emission — which the
 * printer breaks up with indentation and quote markers — falls back to locating
 * line by line.
 */
function appendRuns(
  runs: TraceRun[],
  markdown: string,
  cursor: number,
  span: TracedSpan,
  source: string,
  out: string,
): number {
  if (out === "") return cursor;

  const whole = out.includes("\n") ? -1 : markdown.indexOf(out, cursor);
  const pieces = span.atomic ? null : alignPieces(source, out);

  if (pieces === null) {
    const located =
      whole === -1
        ? locateAcrossLines(markdown, out, cursor)
        : { start: whole, end: whole + out.length };
    if (located === null) return cursor;
    runs.push({
      pmFrom: span.from,
      pmTo: span.to,
      mdStart: located.start,
      mdEnd: located.end,
      block: span.block,
      atomic: true,
    });
    return located.end;
  }

  let at = cursor;
  for (const piece of pieces.flatMap(splitLines)) {
    const start = whole === -1 ? markdown.indexOf(piece.text, at) : whole + piece.outStart;
    if (start === -1) return at;
    runs.push({
      pmFrom: span.from + piece.sourceStart,
      pmTo: span.from + piece.sourceStart + piece.text.length,
      mdStart: start,
      mdEnd: start + piece.text.length,
      block: span.block,
      atomic: false,
    });
    at = start + piece.text.length;
  }
  return at;
}

/** Walks the printed tree in emission order and pairs every run with its output. */
function alignTrace(tree: MdRoot, written: Map<MdNode, string>, markdown: string): TraceRun[] {
  const runs: TraceRun[] = [];
  let cursor = 0;

  const visit = (node: MdNode): void => {
    const span = mdSpans.get(node);
    if (span !== undefined) {
      const source = node.value ?? "";
      cursor = appendRuns(runs, markdown, cursor, span, source, written.get(node) ?? source);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };

  for (const child of tree.children) visit(child);
  return runs;
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
 *
 * With `{ trace: true }` it also answers where every run of content ended up
 * (sprint-011 TEST-87). That is an option on **this** serializer rather than a
 * second walk beside it: a parallel implementation would be a second opinion
 * about what the document is, and the anchors drawn from it would drift from
 * the bytes on disk the first time the two disagreed.
 */
export function serializeDoc(doc: PmNode): string;
export function serializeDoc(doc: PmNode, options: { readonly trace: true }): TracedSerialization;
export function serializeDoc(
  doc: PmNode,
  options?: { readonly trace?: boolean },
): string | TracedSerialization {
  const tracing = options?.trace === true;
  if (tracing) pmSpans = indexPositions(doc);
  try {
    const tree = toMdast(doc);

    const minimalWritten = new Map<MdNode, string>();
    emissions = tracing ? minimalWritten : null;
    const minimal = normalizeBody(print(tree, true));

    const defensiveWritten = new Map<MdNode, string>();
    emissions = tracing ? defensiveWritten : null;
    const defensive = normalizeBody(print(tree, false));
    emissions = null;

    const sameMeaning =
      minimal === defensive ||
      JSON.stringify(parseMarkdown(minimal)) === JSON.stringify(parseMarkdown(defensive));
    const markdown = sameMeaning ? minimal : defensive;

    if (!tracing) return markdown;
    return {
      markdown,
      trace: alignTrace(tree, sameMeaning ? minimalWritten : defensiveWritten, markdown),
    };
  } finally {
    pmSpans = null;
    emissions = null;
  }
}

/** `serializeDoc(parseMarkdown(md))` — the round trip, as one call. */
export function canonicalizeMarkdown(markdown: string): string {
  return serializeDoc(parseMarkdown(markdown));
}
