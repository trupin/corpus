import { describe, expect, it } from "vitest";
import { WARNING_CODES, WarningSchema, warningsField } from "./warning.js";

describe("Warning", () => {
  it.each(WARNING_CODES)("round-trips a %s warning", (code) => {
    const warning = { code, detail: "pre-commit hook exited 1: lint failed" };
    expect(WarningSchema.parse(JSON.parse(JSON.stringify(WarningSchema.parse(warning))))).toEqual(
      warning,
    );
  });

  it("names exactly SPEC.md §14's two warning families", () => {
    expect(WARNING_CODES).toEqual([
      "commit_failed",
      "commit_skipped",
      "orphaned_anchor",
      "unresolved_ref",
    ]);
  });

  it("rejects an unknown code rather than passing it through", () => {
    expect(WarningSchema.safeParse({ code: "kaboom", detail: "x" }).success).toBe(false);
  });

  it("requires a detail, since a bare code surfaces nothing loudly", () => {
    expect(WarningSchema.safeParse({ code: "commit_failed" }).success).toBe(false);
  });
});

describe("the warnings carrier", () => {
  it("treats the normal case — nothing went wrong — as an empty array", () => {
    expect(warningsField.parse([])).toEqual([]);
  });

  it("carries several warnings from one mutation", () => {
    const warnings = [
      { code: "commit_failed" as const, detail: "hook rejected" },
      { code: "orphaned_anchor" as const, detail: "anc_k4f7 no longer resolves" },
    ];
    expect(warningsField.parse(warnings)).toEqual(warnings);
  });

  it("is not optional — a missing array is a malformed response", () => {
    expect(warningsField.safeParse(undefined).success).toBe(false);
  });
});
