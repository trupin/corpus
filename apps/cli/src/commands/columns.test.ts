import { describe, expect, it } from "vitest";
import { oneLine, renderColumns } from "./columns.js";

/**
 * The house table, extracted from `doc list` when `search` and `doc related`
 * needed exactly it (CLI-019). `doc/list.test.ts`'s exact-output assertion is
 * the real regression guard — it is asserted against the shipped rendering and
 * was not touched; these cover the properties the three verbs rely on directly.
 */

describe("renderColumns", () => {
  it("pads every column but the last to the widest value in the batch", () => {
    expect(
      renderColumns([
        ["doc_a1b2c3", "note", "Mortgage options"],
        ["doc_zz", "skill", "Weekly review"],
      ]),
    ).toEqual(["doc_a1b2c3  note   Mortgage options", "doc_zz      skill  Weekly review"]);
  });

  it("leaves no trailing whitespace when the ragged last cell is empty", () => {
    expect(renderColumns([["doc_a1b2c3", "linked", ""]])).toEqual(["doc_a1b2c3  linked"]);
  });

  it("renders nothing for no rows, rather than a blank line", () => {
    expect(renderColumns([])).toEqual([]);
  });

  it("sizes from every row, not just the first", () => {
    expect(
      renderColumns([
        ["a", "x"],
        ["longer", "y"],
      ]),
    ).toEqual(["a       x", "longer  y"]);
  });
});

describe("oneLine", () => {
  it("collapses newlines and runs of whitespace so one thing stays one line", () => {
    expect(oneLine("a snippet\nthat   wrapped\t here ")).toBe("a snippet that wrapped here");
  });

  it("truncates nothing — what to cut is the caller's decision", () => {
    const long = "x".repeat(500);
    expect(oneLine(long)).toBe(long);
  });

  it("reads whitespace-only text as empty", () => {
    expect(oneLine("  \n ")).toBe("");
  });
});
