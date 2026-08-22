import { describe, expect, it } from "vitest";
import { WARNING_CODES, WarningSchema, warningsField } from "./warning.js";

describe("Warning", () => {
  it.each(WARNING_CODES)("round-trips a %s warning", (code) => {
    const warning = { code, detail: "pre-commit hook exited 1: lint failed" };
    expect(WarningSchema.parse(JSON.parse(JSON.stringify(WarningSchema.parse(warning))))).toEqual(
      warning,
    );
  });

  it("names exactly §11's two warning families and CONTRACT-047's third", () => {
    expect(WARNING_CODES).toEqual([
      "commit_failed",
      "commit_skipped",
      "orphaned_anchor",
      "unresolved_ref",
      "carried_skill",
      "carried_reconciliation",
    ]);
  });

  /**
   * The two carried facts differ in kind, so they differ in `code`. A carry is
   * §7 working as specified and happens on every nested skill a folder move
   * touches; a reconciliation is the server rewriting the frontmatter of a file
   * the caller never named, and is rare. `detail` is prose the contract forbids
   * parsing, so folding both under one code would leave a console with no way
   * to tell the routine one from the one worth stopping at.
   */
  it("gives the carry and the frontmatter rewrite separate codes", () => {
    expect(WARNING_CODES).toContain("carried_skill");
    expect(WARNING_CODES).toContain("carried_reconciliation");
    expect(new Set(WARNING_CODES).size).toBe(WARNING_CODES.length);
  });

  /**
   * The id stamp a folder move writes into a carried file (SERVER-078) has no
   * code, deliberately: it keeps the document's identity rather than changing
   * it, and it fires on nearly every carry — which is how the reconciliation
   * beside it would come to be ignored. Pinned so restoring the symmetry
   * ("both are writes, so report both") fails a test rather than a reader.
   */
  it("has no code for the id stamp, which changes nothing a reader would notice", () => {
    const codes: readonly string[] = WARNING_CODES;
    for (const name of ["carried_id", "id_stamped", "carried_stamp", "id_written"]) {
      expect(codes, name).not.toContain(name);
    }
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

  /**
   * The shape an archive/unarchive that carried a nested skill populates
   * (CONTRACT-047), written out so the server issue implementing it has a
   * concrete target: one warning per carried document, `detail` naming the
   * document, where its file now is, and what changed about it.
   */
  it("carries a folder move's report of the documents it was never asked about", () => {
    const warnings = [
      {
        code: "carried_skill" as const,
        detail:
          "doc_skill9f2a1c (.claude/skills/demo/helper/SKILL.md) was carried by this skill " +
          "folder move and is now enabled; this act did not unarchive it in its own right " +
          "(SPEC.md §7)",
      },
      {
        code: "carried_reconciliation" as const,
        detail:
          "doc_skill9f2a1c (.claude/skills/demo/helper/SKILL.md) still said `status: archived` " +
          "under the enabled skills root, so its status was reconciled to `open`",
      },
    ];
    expect(warningsField.parse(warnings)).toEqual(warnings);
  });

  it("is not optional — a missing array is a malformed response", () => {
    expect(warningsField.safeParse(undefined).success).toBe(false);
  });
});
