import { describe, expect, it } from "vitest";
import { CaptureRequestSchema, CaptureResultSchema } from "./capture.js";

const png = () => new File(["bytes"], "screenshot.png", { type: "image/png" });

describe("CaptureRequest", () => {
  it("accepts text alone", () => {
    expect(CaptureRequestSchema.parse({ text: "buy a house?" })).toEqual({
      text: "buy a house?",
      files: [],
    });
  });

  it("accepts a screenshot plus one line, the first-class capture of SPEC.md §6", () => {
    const file = png();
    const parsed = CaptureRequestSchema.parse({ text: "this rate looks wrong", files: file });
    expect(parsed.files).toEqual([file]);
  });

  it("requires text — a capture with no text has nothing to file", () => {
    expect(CaptureRequestSchema.safeParse({ files: png() }).success).toBe(false);
    expect(CaptureRequestSchema.safeParse({ text: "" }).success).toBe(false);
  });
});

/** The same tri-state as the thread schemas, over a form body where parts arrive as text. */
describe("CaptureRequest.requestsAgent stays a tri-state", () => {
  it("leaves an omitted signal undefined, so the server applies its own rule", () => {
    const parsed = CaptureRequestSchema.parse({ text: "note" });
    expect(parsed.requestsAgent).toBeUndefined();
    expect("requestsAgent" in parsed).toBe(false);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])('preserves the explicit "%s"', (raw, expected) => {
    expect(CaptureRequestSchema.parse({ text: "note", requestsAgent: raw }).requestsAgent).toBe(
      expected,
    );
  });

  it("keeps an explicit false distinguishable from omission", () => {
    const explicit = CaptureRequestSchema.parse({ text: "note", requestsAgent: "false" });
    const omitted = CaptureRequestSchema.parse({ text: "note" });
    expect(explicit.requestsAgent).toBe(false);
    expect(omitted.requestsAgent).toBeUndefined();
  });

  it("rejects a value that is neither true nor false, rather than coercing it", () => {
    expect(CaptureRequestSchema.safeParse({ text: "note", requestsAgent: "maybe" }).success).toBe(
      false,
    );
  });
});

describe("CaptureResult", () => {
  it("round-trips the document, its filing thread and the enqueued event", () => {
    const result = { docId: "doc_a1b2c3", threadId: "th_x9y8", eventId: "evt_7c1d" };
    expect(CaptureResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips a null event, which an explicit `requestsAgent: false` always produces", () => {
    const result = { docId: "doc_a1b2c3", threadId: "th_x9y8", eventId: null };
    expect(CaptureResultSchema.parse(result)).toEqual(result);
  });

  it("rejects a thread id where the document id belongs", () => {
    const result = { docId: "th_x9y8", threadId: "th_x9y8", eventId: null };
    expect(CaptureResultSchema.safeParse(result).success).toBe(false);
  });
});
