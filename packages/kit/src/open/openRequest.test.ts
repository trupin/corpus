import { describe, expectTypeOf, it } from "vitest";
import type { OpenPayload, OpenRequest, RevealTarget } from "./openRequest.js";

/**
 * UI-037's reveal seam, pinned at the type level. The point of the payload is
 * that it is **additive**: every caller written against `onOpen(docId)` keeps
 * compiling, and a caller that wants to point at something inside the document
 * passes one more field rather than reaching for a second callback.
 */
describe("the open payload", () => {
  const open = (_target: OpenPayload): void => undefined;

  it("accepts a bare document id — the call every existing caller makes", () => {
    open("doc_a");
    expectTypeOf<string>().toExtend<OpenPayload>();
  });

  it("accepts a request with an item reveal, with and without disambiguation", () => {
    open({ docId: "doc_a", reveal: { kind: "item", exact: "Call the plumber" } });
    open({
      docId: "doc_a",
      reveal: { kind: "item", exact: "Call the plumber", prefix: "- [ ] ", suffix: " (tuesday)" },
    });
    expectTypeOf<{ docId: string; reveal: RevealTarget }>().toExtend<OpenRequest>();
  });

  it("accepts a request with a thread reveal", () => {
    open({ docId: "doc_a", reveal: { kind: "thread", threadId: "th_1" } });
  });

  it("rejects a reveal that is neither kind, and a kind missing its payload", () => {
    // @ts-expect-error — `kind` is the discriminant; "anchor" is not one of them
    open({ docId: "doc_a", reveal: { kind: "anchor", exact: "x" } });
    // @ts-expect-error — an item reveal without the text to find
    open({ docId: "doc_a", reveal: { kind: "item" } });
    // @ts-expect-error — a thread reveal quoting text instead of naming a thread
    open({ docId: "doc_a", reveal: { kind: "thread", exact: "x" } });
    // @ts-expect-error — a reveal is not an open: the document is still required
    open({ reveal: { kind: "thread", threadId: "th_1" } });
  });
});
