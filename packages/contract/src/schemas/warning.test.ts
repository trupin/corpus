import { describe, expect, it } from "vitest";
import { CHECK_CODES, CHECK_WARNING_CODES } from "./check.js";
import { WARNING_CODES, WarningSchema, warningsField } from "./warning.js";

describe("Warning", () => {
  it.each(WARNING_CODES)("round-trips a %s warning", (code) => {
    const warning = { code, detail: "pre-commit hook exited 1: lint failed" };
    expect(WarningSchema.parse(JSON.parse(JSON.stringify(WarningSchema.parse(warning))))).toEqual(
      warning,
    );
  });

  it("names exactly §11's two warning families, CONTRACT-047's third and CONTRACT-084's fourth", () => {
    expect(WARNING_CODES).toEqual([
      "commit_failed",
      "commit_skipped",
      "orphaned_anchor",
      "unresolved_ref",
      "validation_error",
      "carried_skill",
      "carried_reconciliation",
      "stage_status",
      "default_open_cleared",
    ]);
  });

  /**
   * CONTRACT-084. The fourth family: a §11 validation finding of **error**
   * severity that the save reported and did not refuse.
   *
   * The assertion that matters is the one below it — this channel and the
   * validator's severity split are **two different families**, and the whole
   * issue turns on not confusing them. `CHECK_WARNING_CODES` (`./check.ts`)
   * decides `corpus doc check`'s exit 0 versus 6 and is closed at two members;
   * this array is the response channel and already spanned `carried_skill`
   * ("nothing went wrong") to `commit_failed`. So nothing moved across the
   * validator's partition to make room here, and `apps/server`'s
   * `check/codes.test.ts` passes unchanged.
   */
  it("gives a tolerated error a way to say so on the response", () => {
    expect(WARNING_CODES).toContain("validation_error");
    expect(new Set(WARNING_CODES).size).toBe(WARNING_CODES.length);
  });

  /**
   * The validator's severity split is untouched by the addition, asserted from
   * this side so the claim is not only in a comment. `validation_error` is a
   * response code and never a `CheckCode`, and no `CheckCode` became a response
   * code to carry it — the mapping from finding to warning stays the server's,
   * through `detail`.
   */
  it("does not move anything across the validator's partition", () => {
    const responseCodes: readonly string[] = WARNING_CODES;
    for (const checkCode of CHECK_CODES) expect(responseCodes, checkCode).not.toContain(checkCode);
    const checkCodes: readonly string[] = CHECK_CODES;
    expect(checkCodes).not.toContain("validation_error");
    expect(CHECK_WARNING_CODES).toEqual([
      "anchor-unresolved",
      "ref-unresolved",
      "resident-malformed",
    ]);
  });

  /**
   * SERVER-138's two, and the reason they are codes rather than prose under an
   * existing one: a client acts on `code` and never parses `detail`, so a
   * console that wanted to show "this board stopped being the default" and a
   * console that wanted to show "your stage set a status" would have had no way
   * to tell either from a skill folder move.
   *
   * `stage_status` is deliberately **not** a `carried_*` code. Those describe a
   * document the request never named; this one describes the request's own
   * subject, changed in a field the request did not name. Same rule (§11: an
   * effect a person would otherwise learn from `git log`), different shape.
   */
  it("gives the two board rules their own codes", () => {
    expect(WARNING_CODES).toContain("stage_status");
    expect(WARNING_CODES).toContain("default_open_cleared");
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
          "under the enabled skills root, so its status was reconciled to `resolved`",
      },
    ];
    expect(warningsField.parse(warnings)).toEqual(warnings);
  });

  it("is not optional — a missing array is a malformed response", () => {
    expect(warningsField.safeParse(undefined).success).toBe(false);
  });
});
