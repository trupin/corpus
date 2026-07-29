/**
 * @vitest-environment jsdom
 */
import { Node as PmModelNode } from "@tiptap/pm/model";
import { beforeEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { corpusSchema } from "../editor/markdown/schema.js";
import { mdRangeToPm } from "./offsetMap.js";
import {
  resetTraceCache,
  TRACE_CACHE_ENTRIES,
  traceOfBody,
  traceOfDoc,
  traceStats,
} from "./traceCache.js";

/**
 * One trace per document version — the measurable half of sprint-011 TEST-88.
 */

const BODY = "The rate is 6.1% today, and it was 5.9% last week.\n";

function document(markdown: string): PmModelNode {
  return PmModelNode.fromJSON(corpusSchema(), parseMarkdown(markdown));
}

beforeEach(() => {
  resetTraceCache();
});

describe("the body trace", () => {
  it("is computed once, however many times it is asked for", () => {
    const first = traceOfBody(BODY);
    for (let index = 0; index < 20; index += 1) traceOfBody(BODY);
    expect(traceStats().computations).toBe(1);
    expect(traceOfBody(BODY)).toBe(first);
  });

  it("is recomputed when the body changes, and not before", () => {
    traceOfBody(BODY);
    traceOfBody(`${BODY}A second paragraph.\n`);
    traceOfBody(`${BODY}A second paragraph.\n`);
    expect(traceStats().computations).toBe(2);
  });

  it("costs one trace for many decorations", () => {
    const source = traceOfBody(BODY);
    // Ten anchors placed off the same trace: the cache is what makes the map a
    // per-document cost rather than a per-highlight one.
    for (let index = 0; index < 10; index += 1) {
      expect(mdRangeToPm(source.trace, { start: 12, end: 16 })).toHaveLength(1);
    }
    expect(traceStats().computations).toBe(1);
  });
});

describe("the live trace", () => {
  it("is keyed by the document itself, which every transaction replaces", () => {
    const doc = document(BODY);
    traceOfDoc(doc);
    traceOfDoc(doc);
    expect(traceStats().computations).toBe(1);

    // An equal but distinct document is a different version, by construction.
    traceOfDoc(document(BODY));
    expect(traceStats().computations).toBe(2);
  });

  it("answers the markdown the editor would save", () => {
    expect(traceOfDoc(document(BODY)).markdown).toBe(BODY);
  });

  it("does not evict the body trace, and is not evicted by it", () => {
    traceOfBody(BODY);
    const doc = document(BODY);
    traceOfDoc(doc);
    traceOfBody(BODY);
    traceOfDoc(doc);
    expect(traceStats().computations).toBe(2);
  });
});

/**
 * PR #10 finding 18. One slot per question meant two open readers evicted each
 * other on every render — the board is several columns of readers side by side,
 * so that is ordinary use, not a corner case.
 */
describe("several documents open at once", () => {
  const OTHER = "A different document entirely.\n";

  it("keeps both bodies, however often the reader alternates between them", () => {
    traceOfBody(BODY);
    traceOfBody(OTHER);
    for (let index = 0; index < 10; index += 1) {
      traceOfBody(BODY);
      traceOfBody(OTHER);
    }
    expect(traceStats().computations).toBe(2);
    expect(traceStats().bodies).toBe(2);
  });

  it("keeps a live trace per open editor", () => {
    const docs = [document(BODY), document(OTHER)];
    for (const doc of docs) traceOfDoc(doc);
    for (let index = 0; index < 10; index += 1) for (const doc of docs) traceOfDoc(doc);
    expect(traceStats().computations).toBe(2);
    expect(traceStats().live).toBe(2);
  });

  it("holds a whole board's worth before it evicts anything", () => {
    const bodies = Array.from(
      { length: TRACE_CACHE_ENTRIES },
      (_unused, index) => `Body number ${String(index)}.\n`,
    );
    for (const body of bodies) traceOfBody(body);
    for (const body of bodies) traceOfBody(body);
    expect(traceStats().computations).toBe(TRACE_CACHE_ENTRIES);
    expect(traceStats().bodies).toBe(TRACE_CACHE_ENTRIES);
  });

  it("stays bounded — the oldest goes, the most recent stay", () => {
    const bodies = Array.from(
      { length: TRACE_CACHE_ENTRIES + 1 },
      (_unused, index) => `Body number ${String(index)}.\n`,
    );
    for (const body of bodies) traceOfBody(body);
    expect(traceStats().bodies).toBe(TRACE_CACHE_ENTRIES);

    // The newest is still cached; the one pushed out is recomputed.
    traceOfBody(bodies.at(-1) ?? "");
    expect(traceStats().computations).toBe(TRACE_CACHE_ENTRIES + 1);
    traceOfBody(bodies[0] ?? "");
    expect(traceStats().computations).toBe(TRACE_CACHE_ENTRIES + 2);
  });
});
