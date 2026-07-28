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
 * Two entries, because there are two questions:
 *
 * - **the live editor's document** — what a new comment quotes, which must be
 *   the text as it stands, including edits the server has not seen;
 * - **the body the server holds** — what its anchor ranges are offsets into.
 *
 * {@link traceStats} exists so the "N decorations cost one trace" claim can be
 * measured rather than asserted.
 */

export interface DocumentTrace {
  /** The markdown this trace's offsets index into. */
  readonly markdown: string;
  readonly trace: readonly TraceRun[];
}

let computations = 0;

let liveKey: PmDocument | null = null;
let liveValue: DocumentTrace | null = null;

let bodyKey: string | null = null;
let bodyValue: DocumentTrace | null = null;

function compute(doc: PmNode): DocumentTrace {
  computations += 1;
  const { markdown, trace } = serializeDoc(doc, { trace: true });
  return { markdown, trace };
}

/** The trace of what is on screen right now. */
export function traceOfDoc(doc: PmDocument): DocumentTrace {
  if (liveKey === doc && liveValue !== null) return liveValue;
  liveKey = doc;
  liveValue = compute(doc.toJSON() as PmNode);
  return liveValue;
}

/** The trace of the body the server returned, whose offsets its anchors use. */
export function traceOfBody(body: string): DocumentTrace {
  if (bodyKey === body && bodyValue !== null) return bodyValue;
  bodyKey = body;
  bodyValue = compute(parseMarkdown(body));
  return bodyValue;
}

/** How many traces have been computed since the process started. */
export function traceStats(): { readonly computations: number } {
  return { computations };
}

/** Test seam: forgets both entries and the counter. */
export function resetTraceCache(): void {
  computations = 0;
  liveKey = null;
  liveValue = null;
  bodyKey = null;
  bodyValue = null;
}
