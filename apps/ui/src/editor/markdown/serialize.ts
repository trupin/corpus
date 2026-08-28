import { styleDelimiters, type StyleInfo } from "@corpus/kit";
import type { StyleRole } from "@corpus/contract";
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
 * - fences keep their language string and are ``` **by default, not by cap**:
 *   the delimiter widens to one backtick longer than the longest run in the
 *   payload, so a block holding its own fence stays one block instead of
 *   closing early and splitting (UI-057, from AGENT-012). This is the printer's
 *   widening, not ours — which is why `serialize.test.ts` asserts it;
 * - exactly one blank line between block nodes, including between the block
 *   children of a list item — except a nested list, which stays flush under a
 *   paragraph of the same item or under another list, and only when it is a
 *   list that may interrupt a paragraph (see {@link separateListItemBlocks});
 * - a hard break inside a table cell is `<br>`, GFM's only spelling for one
 *   (UI-064); everywhere else a hard break stays a trailing `\`;
 * - the file ends with exactly one `\n`, and an empty body is `""`.
 */

/** Custom mdast node types this module emits and teaches the printer to print. */
const REF_TYPE = "corpusRef";
const RAW_BLOCK_TYPE = "corpusRawBlock";
const RAW_INLINE_TYPE = "corpusRawInline";
const AUTOLINK_TYPE = "corpusAutolink";
/**
 * The two styled wrappers (SPEC.md §5, UI-182). Two types rather than one so the
 * flanking rule can be stated by type: `==` must sit flush against its own text
 * exactly as `**` must, while `<u>` and `[…]{…}` may hold a space at either edge.
 */
const STYLE_FLUSH_TYPE = "corpusStyleFlush";
const STYLE_LOOSE_TYPE = "corpusStyleLoose";

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

/**
 * The token a break becomes inside a cell (UI-064).
 *
 * Written here rather than as a printer handler because only this function
 * knows it is building a cell: every markdown spelling of a hard break is a
 * newline, a newline ends a table row, and the printer's default answer is
 * therefore to flatten the break into a **space** — the user's line break,
 * silently deleted on the next save. `<br>` is what GFM writes instead, so it
 * is what is written here, as a construct the printer already emits verbatim.
 * The parser reads the same token back (`parse.ts`), which is what closes the
 * round trip.
 *
 * Rewritten in place rather than mapped to fresh nodes: a node's identity is
 * its key in the position trace, so cloning the `strong` around a break would
 * drop that run's address out of the offset map.
 */
function breaksAsTokens(nodes: MdNode[]): MdNode[] {
  for (const [index, node] of nodes.entries()) {
    if (node.type === "break") {
      nodes[index] = { type: RAW_INLINE_TYPE, value: "<br>" };
      continue;
    }
    if (node.children !== undefined) breaksAsTokens(node.children);
  }
  return nodes;
}

/**
 * A cell's inline content. A cell is phrasing in markdown but `block+` in
 * ProseMirror; flatten its paragraphs rather than emitting a table GFM cannot
 * express.
 */
function cellChildren(cell: PmNode): MdNode[] {
  return breaksAsTokens(
    (cell.content ?? []).flatMap((block) => inlineChildren(block.content ?? [])),
  );
}

/**
 * A row's cells, none of them beyond the table's last column (UI-104).
 *
 * A GFM table has exactly as many columns as its delimiter row, and a row is
 * allowed to carry more cells than that — the surplus is the reader's problem,
 * and CommonMark's GFM extension says it is ignored. Ours keeps it, because
 * dropping it would delete the user's text; the ProseMirror table therefore has
 * rows wider than its header whenever a document contains a bare `|` inside a
 * cell (`` `jq '.events|length'` ``, `string | null`, `2 failed | 8 passed` —
 * twelve documents in this repo when this was measured, fourteen when UI-104
 * was filed against a slightly older corpus).
 *
 * The printer's answer to such a table is `markdown-table`, which lays every
 * row into a matrix as wide as the **widest** row: the header gains a column,
 * the delimiter row gains a `---`, and every row in the table shifts. A table
 * the author wrote with three columns comes back with four, on the first save,
 * because of one pipe on one line.
 *
 * So the surplus is folded back into the last column instead, separated by the
 * literal `|` it came from — which the printer then escapes as `\|`, the only
 * spelling that makes a pipe content rather than a delimiter. The table keeps
 * its column count, every character survives, and the next read gets the cell
 * the author meant. It is idempotent from there: an escaped pipe never splits a
 * row again.
 *
 * The width is the **first row's**, not `attrs.align`'s: a column added through
 * the editor's table commands extends every row including the header, while
 * `align` is parse-time data that those commands do not maintain. Reading the
 * width off `align` would fold a newly added column away.
 */
function foldSurplusCells(cells: readonly PmNode[], columns: number): MdNode[][] {
  const mapped = cells.map(cellChildren);
  if (columns <= 0 || mapped.length <= columns) return mapped;
  const kept = mapped.slice(0, columns);
  const last = kept[columns - 1];
  if (last === undefined) return mapped;
  for (const surplus of mapped.slice(columns)) last.push({ type: "text", value: "|" }, ...surplus);
  return kept;
}

function tableMdast(node: PmNode): MdNode {
  const rawAlign = attr(node, "align");
  const align = Array.isArray(rawAlign)
    ? rawAlign.map((entry) => (typeof entry === "string" ? entry : null))
    : null;
  const rows = node.content ?? [];
  const columns = rows[0]?.content?.length ?? 0;
  return {
    type: "table",
    align,
    children: rows.map((row) => ({
      type: "tableRow",
      children: foldSurplusCells(row.content ?? [], columns).map((children) => ({
        type: "tableCell",
        children,
      })),
    })),
  };
}

/* ── Inline ─────────────────────────────────────────────────────────── */

/**
 * Marks in the order they must nest: link outermost, then the styling wrappers,
 * then strike/bold/italic, code innermost.
 *
 * The styling marks sit outside emphasis because that is what the file reads
 * best as — `==**a**==` rather than `**==a==**` — and because an attribute span
 * is the widest statement of the three: it can carry two roles at once, so it
 * wraps rather than being wrapped. Code stays innermost, unchanged: nothing
 * inside a code span was ever a mark.
 */
const MARK_ORDER: readonly string[] = [
  MARK.link,
  MARK.styleSpan,
  MARK.underline,
  MARK.highlight,
  MARK.strike,
  MARK.bold,
  MARK.italic,
  MARK.code,
];

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
 * The same, with the whitespace markdown has no spelling for taken out.
 *
 * Two positions have none: the edge of a *line* (a space there is dropped on
 * the way back in, or — before a line ending — turns into a hard break), and
 * the inside edge of an emphasis marker (`** **` neither opens nor closes, so
 * the emphasis stops being emphasis). The printer's faithful answer in both is
 * the character reference: `**alpha beta&#x20;**`, and then `&#x67;amma`
 * because the letter after a marker it could not close has to be encoded too.
 * A body full of entities is a data-integrity failure (SPEC.md §6) and it
 * compounds into every later diff.
 *
 * So the tree is fixed instead of the output. Whitespace at a mark boundary is
 * **moved outside** the markers by {@link hoistEdgeWhitespace} — the space
 * between two runs belongs between them, and `**alpha beta** gamma` says
 * exactly what the document meant. Whitespace at a line edge is **dropped**,
 * which is what markdown itself does to it. Whitespace anywhere else is
 * untouched, and a code block never comes through here.
 */
function blockInlineChildren(nodes: readonly PmNode[]): MdNode[] {
  return trimLineEdges(inlineChildren(nodes).flatMap(splitSoftLines));
}

/** The length of the run `pattern` matches in `value`, or 0. */
function runLength(pattern: RegExp, value: string): number {
  return pattern.exec(value)?.[0].length ?? 0;
}

/** Leading/trailing ASCII blanks — the ones a line edge silently eats. */
const LEADING_BLANK = /^[ \t]+/;
const TRAILING_BLANK = /[ \t]+$/;

/**
 * Leading/trailing whitespace by CommonMark's flanking rules, which count
 * Unicode whitespace — a no-break space against a `**` closes nothing either.
 */
const LEADING_SPACE = /^\s+/;
const TRAILING_SPACE = /\s+$/;

/** Shortens a text node from one end, keeping the range it claims honest. */
function trimTextNode(node: MdNode, count: number, side: "start" | "end"): void {
  const value = node.value ?? "";
  node.value = side === "start" ? value.slice(count) : value.slice(0, value.length - count);
  const span = mdSpans.get(node);
  if (span === undefined) return;
  // A run that still claimed the trimmed characters would hand out addresses
  // for text the file does not contain.
  mdSpans.set(
    node,
    side === "start" ? { ...span, from: span.from + count } : { ...span, to: span.to - count },
  );
}

/**
 * Splits a text node at `offset`. The node keeps the head; the tail is
 * returned, with the two ranges dividing the original between them.
 */
function splitTextNode(node: MdNode, offset: number): MdNode {
  const value = node.value ?? "";
  const tail: MdNode = { type: "text", value: value.slice(offset) };
  node.value = value.slice(0, offset);
  const span = mdSpans.get(node);
  if (span !== undefined) {
    mdSpans.set(tail, { ...span, from: span.from + offset });
    mdSpans.set(node, { ...span, to: span.from + offset });
  }
  return tail;
}

/** Wrappers whose delimiters have to sit flush against their own text. */
const FLANKING_WRAPPERS: ReadonlySet<string> = new Set([
  "strong",
  "emphasis",
  "delete",
  // `== a ==` neither opens nor closes, for the same reason `** a **` does not.
  // `<u> a </u>` and `[ a ]{…}` are legitimate and are deliberately not here.
  STYLE_FLUSH_TYPE,
]);

/**
 * An emphasis wrapper, with any whitespace at its edges moved outside it.
 *
 * `<strong>alpha beta </strong>gamma` — what pressing **B** over a selection
 * that includes its trailing space produces — becomes `**alpha beta** gamma`:
 * the same words, the same spacing, and markers that close. A wrapper left
 * holding nothing but whitespace disappears entirely, since a mark over a
 * space is not something the file can say.
 *
 * Nested marks need no special case: the inner wrapper is hoisted before the
 * outer one is built, so its whitespace is already a sibling by the time this
 * looks at the outer one's edges.
 */
function hoistEdgeWhitespace(node: MdNode): MdNode[] {
  if (!FLANKING_WRAPPERS.has(node.type)) return [node];
  const children = [...(node.children ?? [])];
  const before: MdNode[] = [];
  const after: MdNode[] = [];

  const first = children[0];
  if (first !== undefined && first.type === "text") {
    const count = runLength(LEADING_SPACE, first.value ?? "");
    if (count > 0) {
      const rest = splitTextNode(first, count);
      before.push(first);
      if ((rest.value ?? "") === "") {
        mdSpans.delete(rest);
        children.shift();
      } else {
        children[0] = rest;
      }
    }
  }

  const last = children.at(-1);
  if (last !== undefined && last.type === "text") {
    const value = last.value ?? "";
    const count = runLength(TRAILING_SPACE, value);
    if (count > 0) {
      after.push(splitTextNode(last, value.length - count));
      if ((last.value ?? "") === "") {
        mdSpans.delete(last);
        children.pop();
      }
    }
  }

  if (before.length === 0 && after.length === 0) return [node];
  if (children.length === 0) return [...before, ...after];
  node.children = children;
  return [...before, node, ...after];
}

/**
 * A text value carrying a soft break with blanks against it, as one node per
 * line — so that the outer pass can see those inner line edges at all.
 *
 * Splitting rather than rewriting the value in place is what keeps a run
 * one-for-one with the text it came from: each piece gets its own range, and
 * the blanks between them belong to no run because they reach no file.
 */
function splitSoftLines(node: MdNode): MdNode[] {
  if (node.type !== "text") return [node];
  const value = node.value ?? "";
  if (!/[ \t]\n|\n[ \t]/.test(value)) return [node];
  const span = mdSpans.get(node);
  const out: MdNode[] = [];
  const push = (start: number, end: number): void => {
    if (end <= start) return;
    const piece: MdNode = { type: "text", value: value.slice(start, end) };
    if (span !== undefined) {
      mdSpans.set(piece, { ...span, from: span.from + start, to: span.from + end });
    }
    out.push(piece);
  };

  const lines = value.split("\n");
  let at = 0;
  lines.forEach((line, index) => {
    const start = at;
    at += line.length + 1;
    // The break itself is content; the blanks either side of it are not.
    if (index > 0) push(start - 1, start);
    const lead = index === 0 ? 0 : runLength(LEADING_BLANK, line);
    const trail = index === lines.length - 1 ? 0 : runLength(TRAILING_BLANK, line);
    push(start + lead, start + line.length - trail);
  });
  mdSpans.delete(node);
  return out;
}

/** Whether the node at `index` opens a line, and so cannot start with a blank. */
function startsLine(nodes: readonly MdNode[], index: number): boolean {
  const previous = nodes[index - 1];
  if (previous === undefined) return true;
  return previous.type === "break" || (previous.value ?? "").endsWith("\n");
}

/** Whether the node at `index` closes a line, and so cannot end with a blank. */
function endsLine(nodes: readonly MdNode[], index: number): boolean {
  const next = nodes[index + 1];
  if (next === undefined) return true;
  return next.type === "break" || (next.value ?? "").startsWith("\n");
}

/**
 * Blanks at the start and end of every line of the block, removed.
 *
 * Repeated to a fixed point because removing a node makes its neighbours
 * adjacent: two whitespace-only nodes at the head of a block — one of them
 * just hoisted out of an emphasis — are only both at a line start once the
 * first is gone.
 */
function trimLineEdges(children: MdNode[]): MdNode[] {
  let nodes = children;
  let changed = true;
  while (changed) {
    changed = false;
    const kept: MdNode[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const child = nodes[index];
      if (child === undefined) continue;
      if (child.type !== "text") {
        kept.push(child);
        continue;
      }
      const value = child.value ?? "";
      const lead = startsLine(nodes, index) ? runLength(LEADING_BLANK, value) : 0;
      const trail = endsLine(nodes, index) ? runLength(TRAILING_BLANK, value) : 0;
      if (lead === 0 && trail === 0) {
        if (value === "") changed = true;
        else kept.push(child);
        continue;
      }
      changed = true;
      if (lead + trail >= value.length) {
        mdSpans.delete(child);
        continue;
      }
      if (lead > 0) trimTextNode(child, lead, "start");
      if (trail > 0) trimTextNode(child, trail, "end");
      kept.push(child);
    }
    nodes = kept;
  }
  return nodes;
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
    out.push(...hoistEdgeWhitespace(wrapMark(next, inner)));
    index = end;
  }
  return out;
}

/**
 * A styling wrapper, carrying the delimiters the kit names for it.
 *
 * The delimiters are data rather than a second `switch` in the handler: the
 * spelling of a marker belongs to the grammar (`@corpus/contract`, through
 * `styleDelimiters`), and a serializer that wrote its own `==` would be the
 * second copy of a format rule this repository keeps refusing to grow.
 */
function styledMdast(info: StyleInfo, children: MdNode[]): MdNode {
  const { open, close } = styleDelimiters(info);
  return {
    type: info.kind === "highlight" ? STYLE_FLUSH_TYPE : STYLE_LOOSE_TYPE,
    data: { open, close },
    children,
  };
}

function wrapMark(mark: PmMark, children: MdNode[]): MdNode {
  switch (mark.type) {
    case MARK.bold:
      return { type: "strong", children };
    case MARK.italic:
      return { type: "emphasis", children };
    case MARK.strike:
      return { type: "delete", children };
    case MARK.underline:
      return styledMdast({ kind: "underline", attrs: {} }, children);
    case MARK.highlight:
      return styledMdast({ kind: "highlight", attrs: {} }, children);
    case MARK.styleSpan: {
      const attrs: { color?: StyleRole; highlight?: StyleRole } = {};
      const color = optionalStringAttr(mark.attrs?.["color"]);
      if (color !== null) attrs.color = color as StyleRole;
      const highlight = optionalStringAttr(mark.attrs?.["highlight"]);
      if (highlight !== null) attrs.highlight = highlight as StyleRole;
      // A span with neither role is not something the file can say; the mark
      // disappears and its content stays exactly where it was.
      if (color === null && highlight === null) return { type: "paragraph", children };
      return styledMdast({ kind: "span", attrs }, children);
    }
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
 * How much blank space goes between two block children of a list item.
 *
 * Everywhere else the printer's answer is one blank line and the question is
 * uninteresting. Inside a list item it is not. Items are printed **tight**
 * (`spread: false` in {@link listItems}, because ProseMirror does not model
 * looseness and a corpus of tight lists must not come back loose), and tight
 * is also what the printer then uses between an item's *own* blocks: a bare
 * newline, no blank line. That is right for a nested list under its lead
 * paragraph — it is what hand-written markdown looks like — and wrong for
 * nearly everything else, because the block on the left keeps reading the line
 * below it:
 *
 * - a paragraph after a nested list is a lazy continuation of the last nested
 *   item, and comes back one level deeper than it went in (UI-103);
 * - a paragraph after a blockquote is swallowed into the quotation;
 * - a paragraph after a table becomes one more row of it;
 * - a thematic break after a paragraph is a setext underline, and the
 *   paragraph becomes a heading.
 *
 * Each of those rewrites the user's own file the first time anything is typed
 * in it, because §10 gives the editor autosave and no save button. So the
 * default here is the blank line and the flush spelling is the exception — the
 * safe direction, and the one where a block type the schema grows later is
 * separated rather than silently absorbed. `serialize.test.ts` enumerates
 * every ordered pair of block types in a list item — each in every spelling
 * that changes whether it can be printed flush — and asserts the round trip, so
 * the exception list cannot quietly go stale.
 *
 * The exceptions are both about a **list** on the right, and both are subject
 * to {@link listInterruptsParagraph}: a list only stays where it was put if it
 * is a list that may interrupt a paragraph. See that function — the two
 * spellings that may not are reachable from the editor by typing, and printing
 * them flush destroys the list, or the paragraph above it, on the next save.
 *
 * - **A list under a paragraph of the same item.** Any paragraph, not only the
 *   item's lead one; a list may follow a later paragraph too. This is what
 *   hand-written markdown looks like and it is what keeps every nested list in
 *   a corpus byte-identical.
 * - **Two lists in a row**, which are left to the printer because it knows
 *   something this rule does not: it tracks the bullet it last used
 *   (`state.bulletLastUsed`, `mdast-util-to-markdown`'s `handle/list.js`) and
 *   alternates the marker — `- a` then `* b` — which is what keeps two adjacent
 *   lists two lists with no blank line and no separator between them.
 */

/**
 * What a separation rule may look at: a node's type, and the little the two
 * rules below need in order to know whether a list may be printed flush.
 *
 * Narrower than {@link MdNode} on purpose. The printer hands these rules its own
 * nominal `@types/mdast` nodes, which this module deliberately does not import
 * (see `mdast.ts`); asking for no more than these optional, structurally common
 * fields is what lets the printer's nodes satisfy it without either side
 * knowing the other's declarations.
 */
interface JoinNode {
  readonly type: string;
  readonly ordered?: boolean | null | undefined;
  readonly start?: number | null | undefined;
  readonly value?: string | undefined;
  readonly children?: readonly JoinNode[] | undefined;
}

/**
 * Whether printing this list flush under the line above it still reads back as
 * a list.
 *
 * Inside a tight list item every block the printer emits ends on a line that a
 * following list marker has to *interrupt* to start a list of its own, and
 * CommonMark only lets a list interrupt a paragraph in the cases where the
 * marker cannot be mistaken for a continuation of the text above it
 * (CommonMark §5.3, "Lists"). Two spellings fail that test, and both are two
 * keystrokes away in the editor:
 *
 * - **an ordered list whose first number is not 1** (`orderedList` carries
 *   `attrs.start`, so this is not only reachable from a file). Printed flush,
 *   `- Lead.\n  5. item five\n` makes `5. item five` a lazy continuation of the
 *   paragraph — the list is gone, and the *next* save escapes the marker
 *   permanently as `5\. item five`;
 * - **a list whose first item is empty** — `Enter` then `Tab` at the end of a
 *   bullet. Printed flush, the lone `-` on the line after a paragraph is a
 *   **setext underline**: `- Lead.\n  -\n` reads back as an empty outer item
 *   holding `## Lead.`, and the user's sentence has become a heading.
 *
 * A blank line costs nothing here — it is what the default already is for every
 * other adjacency — and it is what makes both spellings survive.
 */
function listInterruptsParagraph(list: JoinNode): boolean {
  // `start` is only meaningful on an ordered list; `toMdast` leaves it null
  // otherwise, and the printer renumbers from it.
  if (list.ordered === true && list.start !== null && list.start !== undefined && list.start !== 1)
    return false;
  const first = list.children?.[0];
  return first !== undefined && !itemStartsBlank(first);
}

/**
 * Whether a list item's marker is followed by nothing on its own line.
 *
 * That is CommonMark's "list item that begins with a blank line", which may not
 * interrupt a paragraph. The item's first block is what decides it: the schema
 * makes that a paragraph, and only an empty one prints nothing after the
 * marker. A task item is no exception — `mdast-util-gfm-task-list-item` only
 * writes the `[ ] ` checkbox when the marker is followed by content, so an
 * empty task item prints as a bare `-` too.
 */
function itemStartsBlank(item: JoinNode): boolean {
  const head = item.children?.[0];
  if (head === undefined) return true;
  if (head.type !== "paragraph") return false;
  return (head.children ?? []).every(
    (child) => child.type === "text" && (child.value ?? "") === "",
  );
}

function separateListItemBlocks(
  left: JoinNode,
  right: JoinNode,
  parent: JoinNode,
): number | undefined {
  if (parent.type !== "listItem") return undefined;
  // Checked before the exceptions rather than inside each of them: whatever is
  // above it, a list that cannot interrupt a paragraph cannot be printed flush.
  if (right.type === "list" && !listInterruptsParagraph(right)) return 1;
  if (left.type === "list" && right.type === "list") return undefined;
  if (left.type === "paragraph" && right.type === "list") return undefined;
  return 1;
}

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

/**
 * The printer's own walk over a node's inline children — how a construct it does
 * not know still prints everything inside it through the handlers it does.
 *
 * Declared as its own view of the state, and reached by one cast in
 * {@link styledHandler}, because its real parameter is `mdast-util-to-markdown`'s
 * nominal `Parents` union. Widening {@link PrintState} to name it would make
 * every handler in this module structurally incompatible with the printer's own
 * `Handle` type — and importing the union is the dependency `mdast.ts` explains
 * why this module does not take.
 */
interface PhrasingState {
  containerPhrasing(node: unknown, info: PrintInfo): string;
}

interface PrintInfo {
  readonly before?: string;
  readonly after?: string;
}

type PrintHandler = (node: MdNode, parent: unknown, state: PrintState, info: PrintInfo) => string;

/**
 * How many blank lines go between two adjacent block siblings; `undefined`
 * defers to the printer's own rule.
 */
type PrintJoin = (
  left: JoinNode,
  right: JoinNode,
  parent: JoinNode,
  state: PrintState,
) => number | undefined;

/** The join list the printer is built with; a fresh array, since the printer keeps it. */
function printJoin(): PrintJoin[] {
  return [separateListItemBlocks];
}

/** A `|` not already escaped — an odd run of backslashes in front of it is one. */
const BARE_PIPE = /(\\*)\|/g;

/**
 * A construct's own text, made safe to sit in a table cell (UI-104).
 *
 * The printer escapes `|` for everything it knows about — `state.safe` carries
 * `{character: "|", inConstruct: "tableCell"}`, and `mdast-util-gfm-table`
 * patches even `inlineCode`, which is a leaf it would otherwise write out
 * whole. It cannot do the same for a construct it has never heard of, and this
 * module has four: a `[[ref|alias]]`, a raw inline, a raw block and a bare
 * autolink. All of them print **verbatim**, so an alias — which is the ordinary
 * spelling of a reference, not a corner — puts a bare `|` in a cell, and the
 * next read splits the row there. The table gains a column, the alias becomes
 * its own cell, and the file has been rewritten by the tool.
 *
 * Escaping is conditional on the pipe not already being escaped, because a raw
 * inline's value is the source text *as written* (`sourceOf`), backslashes and
 * all: `<kbd>\|</kbd>` in a cell is already correct, and blindly doubling the
 * backslash would turn it into a literal backslash followed by a delimiter —
 * the very bug, introduced by its own fix.
 *
 * **What the conditional does not cover, on the record** (PR #41, MINOR 3). The
 * escape is applied to the construct's whole text, and a raw inline is opaque:
 * for a `|` inside an HTML *tag* rather than beside one —
 * `<span title="a|b">` moved into a cell — the output is
 * `<span title="a\|b">`, micromark keeps the backslash inside the tag, and the
 * rendered `title` attribute permanently gains a character the author never
 * typed. An HTML comment behaves the same way. It converges after one step, so
 * it is a single silent rewrite rather than a runaway, and it is unreachable
 * from a file: *parsing* a cell can never produce such a node, because GFM
 * splits the row on the bare pipe before any inline parsing — it needs the
 * editor to move raw HTML carrying a pipe into a cell.
 *
 * The trade-off is still this way round. Not escaping is strictly worse: the
 * row splits, the table gains a column, and every row after it shifts — on
 * every save, for a construct whose ordinary spelling (`[[id|alias]]`) contains
 * a pipe. A per-construct escape that knew where a tag's text ends would be a
 * second HTML parser living in the serializer, which is the proof obligation
 * this module keeps declining. What is not acceptable is claiming the case is
 * handled, which is what this docstring used to do.
 */
function safeInCell(value: string, state: PrintState): string {
  if (!state.stack.includes("tableCell")) return value;
  return value.replace(BARE_PIPE, (match, slashes: string) =>
    slashes.length % 2 === 0 ? `${slashes}\\|` : match,
  );
}

function verbatim(node: MdNode, _parent: unknown, state: PrintState): string {
  return emit(node, safeInCell(node.value ?? "", state));
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
  state: PrintState,
  info: PrintInfo,
): string {
  const before = info.before ?? "";
  const value = node.value ?? "";
  if (before === "" || /[\s(>]$/.test(before)) return emit(node, safeInCell(value, state));
  // Written as a link, so the run's text is no longer the run's markdown: the
  // trace records the whole thing as one address rather than a wrong one.
  const span = mdSpans.get(node);
  if (span !== undefined) mdSpans.set(node, { ...span, atomic: true });
  return emit(node, safeInCell(`[${value}](${value})`, state));
}

/**
 * A styling wrapper: its delimiters, with the printer's own walk between them.
 *
 * `containerPhrasing` is given the delimiters as the surrounding context so that
 * the text handler's flanking and escaping decisions see what will really sit
 * beside them — a `*` first inside a `==…==` is still flanked by a delimiter,
 * not by the start of a line.
 */
function styledHandler(node: MdNode, _parent: unknown, state: PrintState, info: PrintInfo): string {
  const data = node.data ?? {};
  const open = typeof data["open"] === "string" ? data["open"] : "";
  const close = typeof data["close"] === "string" ? data["close"] : "";
  const inner = (state as unknown as PhrasingState).containerPhrasing(node, {
    ...info,
    before: open,
    after: close,
  });
  // No `emit` here: the children emitted themselves through their own handlers,
  // and recording the wrapper as well would count its content twice in the
  // offset trace.
  return safeInCell(open, state) + inner + safeInCell(close, state);
}

function handlers(escapeText: boolean): Record<string, PrintHandler> {
  return {
    [STYLE_FLUSH_TYPE]: styledHandler,
    [STYLE_LOOSE_TYPE]: styledHandler,
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

/**
 * The one thing the **defensive** printer has to be taught, and why it is taught
 * only to that one.
 *
 * {@link serializeDoc} keeps the minimal output when the two printers' outputs
 * parse alike, and falls back to the defensive one when they do not — on the
 * assumption that the printer's own escaping is at least as safe as ours. For a
 * construct the printer has never heard of that assumption is inverted: literal
 * `==x==` in prose is escaped correctly by `escape.ts` and left bare by the
 * printer, so the two parse *differently*, the net picks the defensive output,
 * and the highlight nobody wrote is written into the user's file.
 *
 * Rather than weaken the net, the printer is told that `=` before `=` is unsafe
 * (SPEC.md §5, UI-182). Both printers then escape the same delimiter and the net
 * compares like with like. It over-escapes — `a == b` needs no backslash and
 * gets one — which costs nothing at all, because that output is only ever
 * *used* when the two disagree about meaning, and here they no longer do.
 *
 * `[` needs no rule: the printer already treats it as unsafe in phrasing, so an
 * attribute span's opening bracket is escaped by both.
 */
const STYLE_UNSAFE = [{ character: "=", after: "=", inConstruct: "phrasing" }];

let minimalPrinter: Processor | undefined;
let defensivePrinter: Processor | undefined;

function printer(escapeText: boolean): Processor {
  if (escapeText) {
    minimalPrinter ??= unified()
      .use(remarkStringify, { ...PRINT_OPTIONS, join: printJoin(), handlers: handlers(true) })
      .use(remarkGfm)
      .freeze() as unknown as Processor;
    return minimalPrinter;
  }
  defensivePrinter ??= unified()
    .use(remarkStringify, {
      ...PRINT_OPTIONS,
      join: printJoin(),
      handlers: handlers(false),
      unsafe: STYLE_UNSAFE,
    })
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

/**
 * Past a link's `](destination)`, from the cursor sitting on its `]`.
 *
 * A link's text is content and its destination is syntax, but the destination
 * is *arbitrary text* — and it comes after the text run, so the cursor left
 * behind by the link's children sits **before** it. Every later search then has
 * the whole URL in front of it: `[a](https://x.test/bold)**bold**` located the
 * bold run inside the URL, four words early, and drew its highlight there.
 *
 * Scanning is exact rather than heuristic. The cursor is only advanced when the
 * markdown really does read `](` at that position, and parentheses are balanced
 * with backslash escapes honoured — which is precisely what the printer wrote,
 * because an unbalanced parenthesis in a destination is escaped or the whole
 * destination is angle-bracketed. Anything else leaves the cursor exactly where
 * it was.
 */
function pastLinkDestination(markdown: string, cursor: number): number {
  if (!markdown.startsWith("](", cursor)) return cursor;
  let depth = 1;
  for (let at = cursor + 2; at < markdown.length; at += 1) {
    const character = markdown[at];
    if (character === "\\") {
      at += 1;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
  }
  return cursor;
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
    if (node.type === "link") cursor = pastLinkDestination(markdown, cursor);
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
