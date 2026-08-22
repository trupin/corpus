import { DocumentIdSchema } from "@corpus/contract";
import { REF_PATTERN } from "@corpus/kit";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";
import type { MdNode, MdRoot } from "../editor/markdown/mdast";
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
 * So this module reads remark's own node positions and produces the projection a
 * renderer draws:
 *
 * - **`plain`** — the characters a reader sees, with every piece of syntax
 *   removed: no `##`, no `**`, no fence lines, no link destinations.
 * - **`runs`** — each stretch of `plain` with the markdown offsets it came from.
 *
 * Two rules make it honest:
 *
 * - **A run is atomic when its markdown and its text differ character for
 *   character** — an escape (`\*`), an entity (`&amp;`), a code span whose value
 *   the delimiters hide. A partial hit inside one quotes the *whole* run rather
 *   than slicing a string whose offsets do not line up, exactly as
 *   `offsetMap.ts` treats its atomic runs.
 * - **`[[ref]]` is in neither projection.** `MarkdownView` renders a reference as
 *   the referenced document's *title*, which is a query result and not text in
 *   the file. Dropping the token from `plain` is what keeps this projection and
 *   the DOM's text describing the same characters; a selection that lands on one
 *   simply finds no quote and is declined.
 *
 * `plain` is not required to equal the DOM's text byte for byte — block
 * boundaries, a fence's trailing newline and a ref's title all differ. It is
 * required to *agree about occurrences*, because that is all the callers ask of
 * it: which of several identical phrases the user pointed at.
 */

export interface SourceRun {
  readonly plainStart: number;
  readonly plainEnd: number;
  readonly mdStart: number;
  readonly mdEnd: number;
  /** The markdown and the text disagree: a partial hit quotes the whole run. */
  readonly atomic: boolean;
}

export interface SourceTrace {
  /** The markdown the offsets index into. */
  readonly markdown: string;
  /** What a renderer draws from it, syntax removed. */
  readonly plain: string;
  readonly runs: readonly SourceRun[];
}

/**
 * Node types that render no text of their own.
 *
 * `image` renders as an `alt` attribute, `html` is dropped by `MarkdownView`
 * (there is no `rehype-raw` in the pipeline, by construction), and a `definition`
 * or a `yaml` block is never drawn at all.
 */
const SILENT_NODES = new Set(["image", "imageReference", "html", "definition", "yaml"]);

/**
 * The pipeline, built once. Deliberately **not** `parseToMdast`: that one runs
 * `remarkCorpusRefs`, whose synthesised nodes carry no `position` — and a trace
 * built from unpositioned nodes would silently lose every paragraph containing a
 * reference. Refs are handled here instead, from the token in the text.
 */
let processor: Processor | undefined;

function markdownProcessor(): Processor {
  processor ??= unified().use(remarkParse).use(remarkGfm).freeze() as unknown as Processor;
  return processor;
}

/** The `[[ref]]` tokens in a text run, as offsets into it. */
function refSpans(value: string): readonly SelectionRange[] {
  // `matchAll` seeds its clone from `lastIndex`; a shared global regex would
  // otherwise let one call's cursor decide where the next one starts.
  REF_PATTERN.lastIndex = 0;
  const spans: SelectionRange[] = [];
  for (const match of value.matchAll(REF_PATTERN)) {
    const start = match.index;
    if (start === undefined) continue;
    // What counts as a document id is the contract's call, never a pattern
    // restated here — the same test `refs.ts` applies before rendering a link.
    if (!DocumentIdSchema.safeParse(match[1] ?? "").success) continue;
    spans.push({ start, end: start + match[0].length });
  }
  return spans;
}

class TraceBuilder {
  readonly #runs: SourceRun[] = [];
  #plain = "";

  push(text: string, mdStart: number, mdEnd: number, atomic: boolean): void {
    if (text === "" || mdEnd <= mdStart) return;
    this.#runs.push({
      plainStart: this.#plain.length,
      plainEnd: this.#plain.length + text.length,
      mdStart,
      mdEnd,
      atomic,
    });
    this.#plain += text;
  }

  done(markdown: string): SourceTrace {
    return { markdown, plain: this.#plain, runs: this.#runs };
  }
}

/** A `text` node: 1:1 with its source unless it carries escapes, minus its refs. */
function pushText(
  out: TraceBuilder,
  markdown: string,
  value: string,
  start: number,
  end: number,
): void {
  if (markdown.slice(start, end) !== value) {
    out.push(value, start, end, true);
    return;
  }
  let cursor = 0;
  for (const span of refSpans(value)) {
    if (span.start > cursor) {
      out.push(value.slice(cursor, span.start), start + cursor, start + span.start, false);
    }
    cursor = span.end;
  }
  if (cursor < value.length) out.push(value.slice(cursor), start + cursor, end, false);
}

function walk(node: MdNode, markdown: string, out: TraceBuilder): void {
  if (SILENT_NODES.has(node.type)) return;
  const value = node.value;
  if (typeof value === "string") {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start !== "number" || typeof end !== "number") return;
    if (node.type === "text") {
      pushText(out, markdown, value, start, end);
      return;
    }
    // `inlineCode` and `code` carry their text *inside* delimiters whose length
    // varies (`` `a` ``, ```` ```ts …``` ````). Locating the value in the slice
    // is exact where it occurs and atomic where it does not.
    const at = markdown.slice(start, end).indexOf(value);
    if (at === -1) out.push(value, start, end, true);
    else out.push(value, start + at, start + at + value.length, false);
    return;
  }
  for (const child of node.children ?? []) walk(child, markdown, out);
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
    // Re-inserting is what makes the iteration order a recency order.
    cache.delete(markdown);
    cache.set(markdown, hit);
    return hit;
  }
  const out = new TraceBuilder();
  const tree = markdownProcessor().parse(markdown) as unknown as MdRoot;
  walk(tree, markdown, out);
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

/**
 * What a stretch of the rendered text quotes, as one contiguous slice of the
 * file — the mirror of `pmRangeToMd`, and contiguous for the same reason: a
 * selection crossing `**bold**` quotes the asterisks, because that is what the
 * file says and what the server's resolution ladder matches against.
 */
export function mdRangeOfPlain(
  runs: readonly SourceRun[],
  start: number,
  end: number,
): SelectionRange | null {
  if (end <= start) return null;
  let mdStart: number | null = null;
  let mdEnd = 0;
  for (const run of runs) {
    if (run.plainEnd <= start) continue;
    if (run.plainStart >= end) break;
    const from = Math.max(start, run.plainStart);
    const to = Math.min(end, run.plainEnd);
    if (to <= from) continue;
    if (mdStart === null) {
      mdStart = run.atomic ? run.mdStart : run.mdStart + (from - run.plainStart);
    }
    mdEnd = run.atomic ? run.mdEnd : run.mdStart + (to - run.plainStart);
  }
  return mdStart === null ? null : { start: mdStart, end: mdEnd };
}

/** Where a markdown range lands in the rendered text — the other direction. */
export function plainRangeOfMd(
  runs: readonly SourceRun[],
  start: number,
  end: number,
): SelectionRange | null {
  if (end <= start) return null;
  let plainStart: number | null = null;
  let plainEnd = 0;
  for (const run of runs) {
    if (run.mdEnd <= start) continue;
    if (run.mdStart >= end) break;
    const from = Math.max(start, run.mdStart);
    const to = Math.min(end, run.mdEnd);
    if (to <= from) continue;
    if (plainStart === null) {
      plainStart = run.atomic ? run.plainStart : run.plainStart + (from - run.mdStart);
    }
    plainEnd = run.atomic ? run.plainEnd : run.plainStart + (to - run.mdStart);
  }
  return plainStart === null ? null : { start: plainStart, end: plainEnd };
}
