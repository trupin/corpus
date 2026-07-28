/**
 * @vitest-environment jsdom
 */
import { Node as PmModelNode } from "@tiptap/pm/model";
import { beforeEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../editor/markdown/parse.js";
import { corpusSchema } from "../editor/markdown/schema.js";
import { mdRangeToPm } from "./offsetMap.js";
import { resetTraceCache, traceOfBody, traceOfDoc, traceStats } from "./traceCache.js";

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
