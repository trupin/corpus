import { DocumentIdSchema, scanInlineStyles } from "@corpus/contract";
import { REF_PATTERN } from "@corpus/kit";
import { toHast } from "mdast-util-to-hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";
import type { MdPosition, MdRoot } from "../editor/markdown/mdast";
import type { SelectionRange } from "../editor/selection";

/**
 * The **emission trace of a rendered markdown surface** — the read-only twin of
 * `offsetMap.ts`.
 *
 * A document body is a ProseMirror document, and `offsetMap.ts` maps its
 * positions to markdown offsets through the serializer's trace. A *thread turn*
 * has no editor: it is `MarkdownView`, which is `react-markdown`, and what the
 * user selects there is a DOM range over rendered text. Anchoring that selection
 * (SPEC.md §6, §10's "Commenting on a selection") needs the same map in the same
 * two directions, derived from the only thing both sides share — the markdown.
 *
 * So this module produces the projection a renderer draws:
 *
 * - **`plain`** — the characters a reader sees, with every piece of syntax
 *   removed: no `##`, no `**`, no fence lines, no link destinations.
 * - **`runs`** — each stretch of `plain` with the markdown offsets it came from.
 *
 * ## Why the walk is over hast rather than over mdast (UI-060)
 *
 * `plain` used to be built by walking remark's mdast and concatenating what each
 * node said. That reproduces every character a reader sees and **none of the
 * whitespace between them**, because the whitespace is not in the markdown at
 * all — `mdast-util-to-hast` writes it while converting the tree. It puts a
 * `"\n"` between sibling blocks, one on each side of a list or a blockquote, and
 * one beside every hard break. A parallel walk emits nothing there, so `plain`
 * was the rendered text with its joins closed up.
 *
 * Closing a join up can **manufacture an occurrence the reader never saw**:
 * `the\n\nnext hen` draws one `hen` and used to trace two, the second straddling
 * the paragraph break. Counting in the DOM and looking the index up in the trace
 * then landed a comment on words nobody selected. That was measured, and it is
 * not exotic — bullets seldom end in punctuation, so a join routinely welds
 * `…set` and `up…` into a `setup` that exists in only one of the projections.
 *
 * The joins are structural, so the fix is to stop having a second opinion about
 * them: this walks the hast that `mdast-util-to-hast` produces **from the very
 * tree remark positioned**, which is the same conversion `react-markdown` runs.
 * The trace does not re-implement the wrapping rules, it asks the library that
 * owns them.
 *
 * Three rules make it honest:
 *
 * - **A text node with a position is addressable**; one without is a
 *   {@link SourceRun.separator} — in `plain` because the reader sees it, in
 *   neither direction of the map because no markdown was consumed to produce it.
 *   `mdast-util-to-hast` patches every node it derives from the source and
 *   patches nothing it invents, so the distinction is the library's own.
 * - **A run is atomic when its markdown and its text differ character for
 *   character** — an escape (`\*`), an entity (`&amp;`). A partial hit inside one
 *   quotes the *whole* run rather than slicing a string whose offsets do not line
 *   up, exactly as `offsetMap.ts` treats its atomic runs.
 * - **A `[[ref]]` and an inline styling marker are in neither projection.**
 *   `MarkdownView` renders a reference as the referenced document's *title*, and
 *   SPEC.md §5's markers as styling — neither draws the characters the file
 *   spells. Dropping them from `plain` is what keeps this projection and the
 *   DOM's text describing the same characters.
 *
 * ## What still differs, deliberately
 *
 * **Raw HTML.** `react-markdown` draws an unrecognised tag as literal text; the
 * `raw` nodes are skipped here, as the `html` mdast nodes were before. Matching
 * it would mean drawing `<u>` and `</u>` too, and those are SPEC.md §5's
 * underline — `remarkCorpusStyling` turns them into an element and the reader
 * sees neither tag. Getting a shipped feature wrong to describe a rare one is
 * the worse trade, so a selection whose quote appears inside raw HTML falls to
 * the disagreement guard in `turnAnchors.ts` and is declined.
 *
 * **A styling marker split across another inline node.** `==a **b** c==` reaches
 * this walk as three nodes, and a delimiter scan of any one of them finds no
 * pair. The reader sees the highlight, `plain` keeps the `==`, and the guard
 * declines. The flat case — which is what people write — agrees.
 */

export interface SourceRun {
  readonly plainStart: number;
  readonly plainEnd: number;
  /** The same run on the {@link SourceTrace.sourced} axis. */
  readonly sourcedStart: number;
  readonly sourcedEnd: number;
  readonly mdStart: number;
  readonly mdEnd: number;
  /** The markdown and the text disagree: a partial hit quotes the whole run. */
  readonly atomic: boolean;
  /**
   * Whitespace the **renderer** wrote, not the document: the `"\n"` between two
   * blocks, around a list or a blockquote, and beside a hard break.
   *
   * It is in `plain` because a reader sees it and a DOM selection can cross it.
   * It is addressable in neither direction because there is nothing in the file
   * to address — {@link SourceRun.mdStart} and {@link SourceRun.mdEnd} are both
   * the boundary it sits at, which keeps the run list ordered by markdown offset
   * without ever claiming a character.
   *
   * A range crossing one is still contiguous in the file: `mdRangeOfProjection`
   * takes
   * the first addressable run's start and the last one's end, so the markdown
   * *between* two blocks is quoted along with them — which is what the file says
   * and what the server's resolution ladder matches against.
   */
  readonly separator: boolean;
}

/**
 * Which of the trace's two projections a range is addressed in.
 *
 * They differ by exactly the renderer's own whitespace, and the caller's
 * question decides which one it wants:
 *
 * - **`plain`** — what a reader sees. Use it whenever the other end of the
 *   conversion is the **DOM**: a selection made with a mouse, a highlight to
 *   paint. Only this axis is character-for-character comparable with
 *   `renderedTextOf`.
 * - **`sourced`** — the same characters with the renderer's joins removed, so
 *   the text is the document's own. Use it whenever the other end is **another
 *   spelling of the same file** (`rebase.ts`): two spellings that differ only in
 *   where a blank line sits render with different joins, and comparing those
 *   would report a difference the documents do not have.
 */
export type TraceAxis = "plain" | "sourced";

export interface SourceTrace {
  /** The markdown the offsets index into. */
  readonly markdown: string;
  /** What a renderer draws from it, syntax removed — see {@link TraceAxis}. */
  readonly plain: string;
  /** {@link SourceTrace.plain} without the renderer's own whitespace. */
  readonly sourced: string;
  readonly runs: readonly SourceRun[];
}

/**
 * The pipeline, built once. Deliberately **not** `parseToMdast`, and deliberately
 * not `MarkdownView`'s own plugin list: `remarkCorpusRefs` and
 * `remarkCorpusStyling` both rebuild the nodes they touch, and a rebuilt node
 * carries no `position` — a trace built from one would silently lose every
 * paragraph containing a reference or a styled phrase. What those two plugins
 * change is *inline* content, which this module drops by its own means; what
 * they leave alone is the block structure, which is where the whitespace comes
 * from. So the trace runs the positioned half of the renderer's pipeline and
 * reads the rest out of the source.
 */
let processor: Processor | undefined;

function markdownProcessor(): Processor {
  processor ??= unified().use(remarkParse).use(remarkGfm).freeze() as unknown as Processor;
  return processor;
}

/**
 * The hast shapes the walk touches, declared structurally.
 *
 * Imported from nowhere on purpose, for the reason `mdast.ts` gives for its own
 * `MdNode`: a `@types/hast` import would make a rehype upgrade a change to this
 * module's types, and the walk reads four fields.
 */
interface HastNode {
  readonly type: string;
  readonly tagName?: string | undefined;
  readonly value?: string | undefined;
  readonly children?: readonly HastNode[] | undefined;
  readonly position?: MdPosition | undefined;
}

/**
 * Elements whose whitespace-only text children never reach the DOM.
 *
 * `hast-util-to-jsx-runtime` drops them — `react-dom` warns about any whitespace
 * in a table — so a trace that kept them would put newlines in `plain` that the
 * reader cannot select. The list and the rule are that library's, restated here
 * because this walk stops one step short of it.
 */
const TABLE_ELEMENTS = new Set(["table", "tbody", "thead", "tfoot", "tr"]);

/** Inter-element whitespace, as `hast-util-whitespace` defines it. */
const INTER_ELEMENT_WHITESPACE = /^[ \t\n\f\r]*$/;

/** A half-open span of a source slice that the renderer does not draw. */
interface HiddenSpan {
  readonly start: number;
  readonly end: number;
}

/** The `[[ref]]` tokens in a source slice, as offsets into it. */
function refSpans(value: string): readonly HiddenSpan[] {
  REF_PATTERN.lastIndex = 0;
  const spans: HiddenSpan[] = [];
  for (const match of value.matchAll(REF_PATTERN)) {
    const start = match.index;
    if (start === undefined) continue;
    if (!DocumentIdSchema.safeParse(match[1] ?? "").success) continue;
    spans.push({ start, end: start + match[0].length });
  }
  return spans;
}

/** The delimiters of SPEC.md §5's inline markers, as offsets into the slice. */
function styleSpans(value: string): readonly HiddenSpan[] {
  const spans: HiddenSpan[] = [];
  for (const match of scanInlineStyles(value)) {
    if (match.start < match.innerStart) spans.push({ start: match.start, end: match.innerStart });
    if (match.innerEnd < match.end) spans.push({ start: match.innerEnd, end: match.end });
  }
  return spans;
}

const LINE_BREAK = /\r?\n|\r/g;

/** Whether `character` is one of the two `trim-lines` removes. */
function isSpaceOrTab(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

/** One line of a text node, with the spaces `trim-lines` takes off its ends. */
function pushTrimmedLine(
  spans: HiddenSpan[],
  slice: string,
  from: number,
  to: number,
  trimStart: boolean,
  trimEnd: boolean,
): void {
  let start = from;
  let end = to;
  if (trimStart) while (start < end && isSpaceOrTab(slice[start])) start += 1;
  if (trimEnd) while (end > start && isSpaceOrTab(slice[end - 1])) end -= 1;
  if (end <= start) {
    if (to > from) spans.push({ start: from, end: to });
    return;
  }
  if (start > from) spans.push({ start: from, end: start });
  if (end < to) spans.push({ start: end, end: to });
}

/**
 * The spaces and tabs `trim-lines` removes at every line break inside a text
 * node — the one transformation `mdast-util-to-hast` applies to a text value.
 *
 * Reproduced rather than tolerated because the alternative is an atomic run: a
 * paragraph with one stray trailing space would otherwise quote itself whole for
 * a selection of one word in it, which is the silent widening this module exists
 * to avoid.
 */
function lineWhitespaceSpans(slice: string): readonly HiddenSpan[] {
  const spans: HiddenSpan[] = [];
  const breaks: HiddenSpan[] = [];
  for (const match of slice.matchAll(LINE_BREAK)) {
    if (match.index === undefined) continue;
    breaks.push({ start: match.index, end: match.index + match[0].length });
  }
  if (breaks.length === 0) return spans;
  let from = 0;
  breaks.forEach((line, index) => {
    pushTrimmedLine(spans, slice, from, line.start, index > 0, true);
    from = line.end;
  });
  pushTrimmedLine(spans, slice, from, slice.length, true, false);
  return spans;
}

/** `slice` with `spans` cut out — sorted, non-overlapping spans only. */
function withoutSpans(slice: string, spans: readonly HiddenSpan[]): string {
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) out += slice.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  return out + slice.slice(cursor);
}

/** Spans sorted by start and merged where they touch or overlap. */
function mergeSpans(spans: readonly HiddenSpan[]): readonly HiddenSpan[] {
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  const merged: HiddenSpan[] = [];
  for (const span of sorted) {
    if (span.end <= span.start) continue;
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
      continue;
    }
    merged.push(span);
  }
  return merged;
}

/**
 * Everything in `slice` the reader does not see, or `null` when the difference
 * between the source and what the renderer drew is not one this module can
 * account for character by character.
 *
 * The line-whitespace check is the honesty gate: it runs first, and if removing
 * it does not reconstruct the rendered value then something else — an escape, an
 * entity, a code span's delimiters — is in play and the caller falls back to an
 * atomic run rather than guessing an alignment.
 */
function hiddenSpansOf(slice: string, value: string): readonly HiddenSpan[] | null {
  const lines = lineWhitespaceSpans(slice);
  if (withoutSpans(slice, lines) !== value) return null;
  return mergeSpans([...lines, ...refSpans(slice), ...styleSpans(slice)]);
}

class TraceBuilder {
  readonly #runs: SourceRun[] = [];
  #plain = "";
  #sourced = "";
  /** The end of the last addressable run — where a separator is said to sit. */
  #cursor = 0;

  push(text: string, mdStart: number, mdEnd: number, atomic: boolean): void {
    if (text === "" || mdEnd <= mdStart) return;
    this.#runs.push({
      plainStart: this.#plain.length,
      plainEnd: this.#plain.length + text.length,
      sourcedStart: this.#sourced.length,
      sourcedEnd: this.#sourced.length + text.length,
      mdStart,
      mdEnd,
      atomic,
      separator: false,
    });
    this.#plain += text;
    this.#sourced += text;
    this.#cursor = mdEnd;
  }

  pushSeparator(text: string): void {
    if (text === "") return;
    this.#runs.push({
      plainStart: this.#plain.length,
      plainEnd: this.#plain.length + text.length,
      sourcedStart: this.#sourced.length,
      sourcedEnd: this.#sourced.length,
      mdStart: this.#cursor,
      mdEnd: this.#cursor,
      atomic: false,
      separator: true,
    });
    this.#plain += text;
  }

  done(markdown: string): SourceTrace {
    return { markdown, plain: this.#plain, sourced: this.#sourced, runs: this.#runs };
  }
}

/** A node's half-open markdown range, or `null` when the renderer invented it. */
function offsetsOf(node: HastNode): SelectionRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return null;
  return { start, end };
}

/**
 * Whether an element's whole text belongs to the element's own source range.
 *
 * **A fenced block, and as far as measurement goes only a fenced block.**
 * `mdast-util-to-hast` patches nearly everything it derives from the source,
 * including the text node inside a *code span* — but `code.js` patches the
 * `code` and `pre` elements it builds for a fence and leaves the text between
 * them unpositioned, so that text would otherwise read as renderer whitespace
 * and a comment could not be put on a line of code in a turn.
 *
 * The shape is the test rather than the tag: a positioned element whose children
 * are all unpositioned text is a node that carries a value, and its range is the
 * element's. Written that way because it is the *library's* invariant that makes
 * the fence special, and a tag list here would go stale the first time another
 * handler stopped patching. An earlier version of this comment claimed the code
 * span needed it too; deleting this function turns exactly one test red, and it
 * is the fence's.
 */
function ownsItsText(node: HastNode): boolean {
  const children = node.children ?? [];
  return (
    children.length > 0 &&
    children.every((child) => child.type === "text" && offsetsOf(child) === null)
  );
}

/** A node's text content, as the DOM would report it. */
function textContentOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  let out = "";
  for (const child of node.children ?? []) out += textContentOf(child);
  return out;
}

/** Text the source produced, split around everything the renderer hides. */
function pushSourced(
  out: TraceBuilder,
  markdown: string,
  value: string,
  start: number,
  end: number,
): void {
  const slice = markdown.slice(start, end);
  const hidden = hiddenSpansOf(slice, value);
  if (hidden !== null) {
    let cursor = 0;
    for (const span of hidden) {
      if (span.start > cursor) {
        out.push(slice.slice(cursor, span.start), start + cursor, start + span.start, false);
      }
      cursor = span.end;
    }
    if (cursor < slice.length) out.push(slice.slice(cursor), start + cursor, end, false);
    return;
  }
  // A code span or a fence: the delimiters are in the range and not in the
  // value, so the value's own offsets are recoverable exactly. Anything else —
  // an escape, an entity — is atomic.
  const at = slice.indexOf(value);
  if (at === -1) out.push(value, start, end, true);
  else out.push(value, start + at, start + at + value.length, false);
}

function walk(node: HastNode, markdown: string, out: TraceBuilder, inTable: boolean): void {
  if (node.type === "text") {
    const value = node.value ?? "";
    if (value === "") return;
    if (inTable && INTER_ELEMENT_WHITESPACE.test(value)) return;
    const at = offsetsOf(node);
    if (at === null) out.pushSeparator(value);
    else pushSourced(out, markdown, value, at.start, at.end);
    return;
  }
  // `raw` (an unrecognised HTML token), `comment` and `doctype` draw no text
  // this projection claims — see the module comment.
  if (node.type !== "element" && node.type !== "root") return;
  const at = offsetsOf(node);
  if (at !== null && ownsItsText(node)) {
    pushSourced(out, markdown, textContentOf(node), at.start, at.end);
    return;
  }
  const table = node.tagName !== undefined && TABLE_ELEMENTS.has(node.tagName);
  for (const child of node.children ?? []) walk(child, markdown, out, table);
}

/** How many bodies the trace cache remembers — a thread's worth of turns. */
export const SOURCE_TRACE_ENTRIES = 24;

const cache = new Map<string, SourceTrace>();

/**
 * The trace of a markdown body, memoised.
 *
 * Parsing is the expensive half and a trace is a pure function of its input, so
 * the markdown *is* the key. Bounded because a cache that grows with the session
 * is a leak: the board renders several threads at once, each a handful of turns.
 */
export function sourceTraceOf(markdown: string): SourceTrace {
  const hit = cache.get(markdown);
  if (hit !== undefined) {
    cache.delete(markdown);
    cache.set(markdown, hit);
    return hit;
  }
  const out = new TraceBuilder();
  const tree = markdownProcessor().parse(markdown) as unknown as MdRoot;
  walk(toHast(tree as never), markdown, out, false);
  const trace = out.done(markdown);
  cache.set(markdown, trace);
  while (cache.size > SOURCE_TRACE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return trace;
}

/** Test seam: forgets every entry. */
export function resetSourceTraceCache(): void {
  cache.clear();
}

/** A run's range on one of the two projections. */
function axisRange(run: SourceRun, axis: TraceAxis): SelectionRange {
  return axis === "plain"
    ? { start: run.plainStart, end: run.plainEnd }
    : { start: run.sourcedStart, end: run.sourcedEnd };
}

/**
 * What a stretch of a projection quotes, as one contiguous slice of the file —
 * the mirror of `pmRangeToMd`, and contiguous for the same reason: a selection
 * crossing `**bold**` quotes the asterisks, because that is what the file says
 * and what the server's resolution ladder matches against.
 *
 * A range that covers nothing but the renderer's own whitespace quotes nothing
 * and comes back `null` — `trimToText` takes those edges off a real selection
 * before it ever reaches here.
 */
export function mdRangeOfProjection(
  runs: readonly SourceRun[],
  axis: TraceAxis,
  start: number,
  end: number,
): SelectionRange | null {
  if (end <= start) return null;
  let mdStart: number | null = null;
  let mdEnd = 0;
  for (const run of runs) {
    const at = axisRange(run, axis);
    if (at.end <= start) continue;
    if (at.start >= end) break;
    const from = Math.max(start, at.start);
    const to = Math.min(end, at.end);
    if (to <= from) continue;
    if (run.separator) continue;
    if (mdStart === null) mdStart = run.atomic ? run.mdStart : run.mdStart + (from - at.start);
    mdEnd = run.atomic ? run.mdEnd : run.mdStart + (to - at.start);
  }
  return mdStart === null ? null : { start: mdStart, end: mdEnd };
}

/** Where a markdown range lands in a projection — the other direction. */
export function projectionRangeOfMd(
  runs: readonly SourceRun[],
  axis: TraceAxis,
  start: number,
  end: number,
): SelectionRange | null {
  if (end <= start) return null;
  let projectedStart: number | null = null;
  let projectedEnd = 0;
  for (const run of runs) {
    if (run.separator) continue;
    if (run.mdEnd <= start) continue;
    if (run.mdStart >= end) break;
    const from = Math.max(start, run.mdStart);
    const to = Math.min(end, run.mdEnd);
    if (to <= from) continue;
    const at = axisRange(run, axis);
    if (projectedStart === null) {
      projectedStart = run.atomic ? at.start : at.start + (from - run.mdStart);
    }
    projectedEnd = run.atomic ? at.end : at.start + (to - run.mdStart);
  }
  return projectedStart === null ? null : { start: projectedStart, end: projectedEnd };
}
