import { describe, expect, it } from "vitest";
import { anchorEntries, withAnchorEntry, withoutAnchorEntry } from "./anchor-entries.js";

const SELECTOR = { exact: "a quote", prefix: "before ", suffix: " after" };

describe("anchorEntries", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a list", []],
    ["a scalar", "anc_a1b2c3d4"],
  ])("reads %s as an empty map", (_label, value) => {
    expect(anchorEntries(value)).toEqual({});
  });

  it("copies rather than aliasing, so a caller cannot mutate the parsed document", () => {
    const source = { anc_a1b2c3d4: SELECTOR };
    const entries = anchorEntries(source);
    delete entries["anc_a1b2c3d4"];
    expect(source).toEqual({ anc_a1b2c3d4: SELECTOR });
  });

  // A hand-edited file with one malformed entry must not lose it because someone
  // commented on the document; `doc check` reports it (§14), the write preserves it.
  it("keeps entries the selector schema would reject", () => {
    expect(anchorEntries({ anc_a1b2c3d4: "not a selector", nonsense: 7 })).toEqual({
      anc_a1b2c3d4: "not a selector",
      nonsense: 7,
    });
  });
});

describe("withAnchorEntry", () => {
  it("adds an entry to an absent map", () => {
    expect(withAnchorEntry(undefined, "anc_a1b2c3d4", SELECTOR)).toEqual({
      anc_a1b2c3d4: SELECTOR,
    });
  });

  it("keeps every other entry, malformed ones included", () => {
    expect(withAnchorEntry({ anc_00000000: "broken" }, "anc_a1b2c3d4", SELECTOR)).toEqual({
      anc_00000000: "broken",
      anc_a1b2c3d4: SELECTOR,
    });
  });

  it("stores the selector verbatim and by value", () => {
    const selector = { ...SELECTOR };
    const entries = withAnchorEntry({}, "anc_a1b2c3d4", selector);
    selector.exact = "changed";
    expect(entries["anc_a1b2c3d4"]).toEqual(SELECTOR);
  });

  it("replaces an entry under the same id", () => {
    const replaced = withAnchorEntry({ anc_a1b2c3d4: SELECTOR }, "anc_a1b2c3d4", {
      exact: "another",
    });
    expect(replaced).toEqual({ anc_a1b2c3d4: { exact: "another" } });
  });
});

describe("withoutAnchorEntry", () => {
  it("removes the named entry and keeps the rest", () => {
    expect(
      withoutAnchorEntry({ anc_a1b2c3d4: SELECTOR, anc_e5f6g7h8: SELECTOR }, "anc_a1b2c3d4"),
    ).toEqual({ anc_e5f6g7h8: SELECTOR });
  });

  it("answers null when there was nothing to remove", () => {
    expect(withoutAnchorEntry({ anc_e5f6g7h8: SELECTOR }, "anc_a1b2c3d4")).toBeNull();
    expect(withoutAnchorEntry(undefined, "anc_a1b2c3d4")).toBeNull();
  });

  it("does not mutate the map it was handed", () => {
    const source = { anc_a1b2c3d4: SELECTOR };
    expect(withoutAnchorEntry(source, "anc_a1b2c3d4")).toEqual({});
    expect(source).toEqual({ anc_a1b2c3d4: SELECTOR });
  });
});
