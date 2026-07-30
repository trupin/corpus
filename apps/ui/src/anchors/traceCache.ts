import type { Node as PmDocument } from "@tiptap/pm/model";
import { parseMarkdown } from "../editor/markdown/parse";
import type { PmNode } from "../editor/markdown/schema";
import { serializeDoc, type TraceRun } from "../editor/markdown/serialize";

/**
 * One trace per document version, and never one per decoration.
 *
 * Serialising is the expensive half of the offset map — a full walk plus two
 * printings — and a naive anchor layer would pay for it once per highlight, per
 * render, on every keystroke. The trace is a pure function of the document, so
 * the document *is* the cache key: a ProseMirror doc is immutable and every
 * transaction produces a new one, which makes object identity an exact version
 * stamp with no counter to keep in sync (sprint-011 TEST-88).
 *
 * Two questions, and therefore two caches:
 *
 * - **the live editor's document** — what a new comment quotes, which must be
 *   the text as it stands, including edits the server has not seen;
 * - **the body the server holds** — what its anchor ranges are offsets into.
 *
 * Each holds several entries, not one (PR #10 finding 18). The board is
 * *several* readers side by side and focus mode on top of them, so a single
 * slot per question is thrashed by ordinary use: two open documents alternating
 * re-serialise each other out of the cache on every render, which is exactly
 * the per-render cost the cache exists to remove. The bound is small and fixed
 * — a cache that grows with the session is a leak, and the entries hold whole
 * ProseMirror documents.
 *
 * {@link traceStats} exists so the "N decorations cost one trace" claim can be
 * measured rather than asserted.
 */

export interface DocumentTrace {
  /** The markdown this trace's offsets index into. */
  readonly markdown: string;
  readonly trace: readonly TraceRun[];
}

/**
 * How many documents each cache remembers.
 *
 * Sized for the board: SPEC.md §11's columns each carry their own reader, and
 * focus mode is one more surface over the same document set.
 */
export const TRACE_CACHE_ENTRIES = 6;

/** A capacity-bounded LRU, riding on `Map`'s insertion order. */
class TraceCache<K> {
  readonly #entries = new Map<K, DocumentTrace>();
  readonly #capacity: number;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  get(key: K): DocumentTrace | undefined {
    const hit = this.#entries.get(key);
    if (hit === undefined) return undefined;
    // Re-inserting is what makes the iteration order a recency order.
    this.#entries.delete(key);
    this.#entries.set(key, hit);
    return hit;
  }

  set(key: K, value: DocumentTrace): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

let computations = 0;

const liveTraces = new TraceCache<PmDocument>(TRACE_CACHE_ENTRIES);
const bodyTraces = new TraceCache<string>(TRACE_CACHE_ENTRIES);

function compute(doc: PmNode): DocumentTrace {
  computations += 1;
  const { markdown, trace } = serializeDoc(doc, { trace: true });
  return { markdown, trace };
}

/** The trace of what is on screen right now. */
export function traceOfDoc(doc: PmDocument): DocumentTrace {
  const hit = liveTraces.get(doc);
  if (hit !== undefined) return hit;
  const computed = compute(doc.toJSON() as PmNode);
  liveTraces.set(doc, computed);
  return computed;
}

/** The trace of the body the server returned, whose offsets its anchors use. */
export function traceOfBody(body: string): DocumentTrace {
  const hit = bodyTraces.get(body);
  if (hit !== undefined) return hit;
  const computed = compute(parseMarkdown(body));
  bodyTraces.set(body, computed);
  return computed;
}

/** How many traces have been computed since the process started, and what is held. */
export function traceStats(): {
  readonly computations: number;
  readonly live: number;
  readonly bodies: number;
} {
  return { computations, live: liveTraces.size, bodies: bodyTraces.size };
}

/** Test seam: forgets every entry and the counter. */
export function resetTraceCache(): void {
  computations = 0;
  liveTraces.clear();
  bodyTraces.clear();
}
