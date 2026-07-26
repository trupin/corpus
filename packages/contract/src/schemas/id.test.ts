import { describe, expect, it } from "vitest";
import {
  AnchorIdSchema,
  DocIdSchema,
  DocumentIdSchema,
  EventIdSchema,
  ThreadIdSchema,
} from "./id.js";

const cases = [
  { name: "DocId", schema: DocIdSchema, valid: "doc_a1b2c3", invalid: "th_x9y8" },
  { name: "ThreadId", schema: ThreadIdSchema, valid: "th_x9y8", invalid: "doc_a1b2c3" },
  { name: "AnchorId", schema: AnchorIdSchema, valid: "anc_k4f7", invalid: "anchor_k4f7" },
  { name: "EventId", schema: EventIdSchema, valid: "evt_7c1d", invalid: "event_7c1d" },
] as const;

describe.each(cases)("$name", ({ schema, valid, invalid }) => {
  it("round-trips a well-formed id", () => {
    expect(schema.parse(valid)).toBe(valid);
  });

  it("rejects an id carrying another kind's prefix", () => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unprefixed id", () => {
    expect(schema.safeParse("a1b2c3").success).toBe(false);
  });
});

describe("DocumentId", () => {
  it.each(["doc_a1b2c3", "th_x9y8"])("accepts %s because threads are documents", (id) => {
    expect(DocumentIdSchema.parse(id)).toBe(id);
  });

  it.each(["anc_k4f7", "evt_7c1d", "doc_", "doc a1"])("rejects %s", (id) => {
    expect(DocumentIdSchema.safeParse(id).success).toBe(false);
  });
});
