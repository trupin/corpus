import { describe, expect, it } from "vitest";
import { TextQuoteSelectorRequestSchema, TextQuoteSelectorSchema } from "./anchor.js";

describe("TextQuoteSelector", () => {
  it("round-trips the SPEC.md §6 example", () => {
    const selector = {
      exact: "assume a 30-year fixed at 6.1%",
      prefix: "the model we ",
      suffix: " which may be stale",
    };
    expect(TextQuoteSelectorSchema.parse(selector)).toEqual(selector);
  });

  it("defaults the disambiguating context to empty, so a bare quote is valid", () => {
    expect(TextQuoteSelectorSchema.parse({ exact: "6.1%" })).toEqual({
      exact: "6.1%",
      prefix: "",
      suffix: "",
    });
  });

  it("rejects an empty quote, which could never resolve", () => {
    expect(TextQuoteSelectorSchema.safeParse({ exact: "" }).success).toBe(false);
  });
});

/**
 * The wire twin of the same selector. It exists only because a `default` on a
 * request-side field renders as a *required* member of the generated client
 * type (CONTRACT-003) — so the request form leaves the context strings absent
 * where the parse form fills them in.
 */
describe("TextQuoteSelectorRequest", () => {
  it("accepts a bare quote and leaves the context absent, not empty", () => {
    expect(TextQuoteSelectorRequestSchema.parse({ exact: "6.1%" })).toEqual({ exact: "6.1%" });
  });

  it("round-trips the SPEC.md §6 example unchanged", () => {
    const selector = {
      exact: "assume a 30-year fixed at 6.1%",
      prefix: "the model we ",
      suffix: " which may be stale",
    };
    expect(TextQuoteSelectorRequestSchema.parse(selector)).toEqual(selector);
  });

  it("still rejects an empty quote", () => {
    expect(TextQuoteSelectorRequestSchema.safeParse({ exact: "" }).success).toBe(false);
  });

  /** Whatever the request omits, the parse-side schema fills — the two stay compatible. */
  it("produces a value the parse-side selector accepts once the server fills the context", () => {
    const request = TextQuoteSelectorRequestSchema.parse({ exact: "6.1%" });
    expect(TextQuoteSelectorSchema.parse(request)).toEqual({
      exact: "6.1%",
      prefix: "",
      suffix: "",
    });
  });

  // A caller holding only a quote must be able to omit context, and must not be
  // led to believe what it sends is stored: the server reads the stored context
  // off the parent's own bytes (SERVER-071).
  it.each(["prefix", "suffix"] as const)("documents that %s is not stored as sent", (field) => {
    const description = TextQuoteSelectorRequestSchema.shape[field].meta()?.description ?? "";
    expect(description).toContain("Not stored as sent");
    expect(description).toContain("omitting this costs nothing");
  });
});
