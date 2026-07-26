import { describe, expect, it } from "vitest";
import { TextQuoteSelectorSchema } from "./anchor.js";

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
