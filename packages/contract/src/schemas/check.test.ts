import { describe, expect, it } from "vitest";
import {
  CHECK_CODES,
  CHECK_ERROR_CODES,
  CHECK_REQUEST_XOR_MESSAGE,
  CHECK_WARNING_CODES,
  CheckDocumentInputSchema,
  CheckFindingSchema,
  CheckReportSchema,
  CheckRequestSchema,
} from "./check.js";

const finding = {
  code: "ref-unresolved" as const,
  severity: "warning" as const,
  docId: "doc_a1b2c3",
  path: "data/docs/mortgage.md",
  detail: "reference `[[doc_zzz]]` does not resolve to a document in the corpus",
};

const errorFinding = {
  code: "duplicate-id" as const,
  severity: "error" as const,
  docId: "doc_a1b2c3",
  path: "data/docs/copy.md",
  detail: "id `doc_a1b2c3` is also used by data/docs/mortgage.md",
};

describe("the check code vocabulary", () => {
  /**
   * Transcribed from `apps/server/src/core/check.ts`'s `CHECK_CODES`, which the
   * contract cannot import (the dependency direction runs contract ← server).
   * Pinned literally so a drifted transcription is a failing test rather than a
   * `400` nobody can explain.
   */
  it("names the validator's fifteen codes, in its order", () => {
    expect([...CHECK_CODES]).toEqual([
      "frontmatter-unparseable",
      "frontmatter-invalid",
      "id-prefix-mismatch",
      "duplicate-id",
      "anchor-malformed",
      "duplicate-anchor-id",
      "thread-parent-missing",
      "thread-anchor-missing",
      "anchor-claimed-twice",
      "anchor-unused",
      "duplicate-turn-timestamp",
      "unterminated-fence",
      "anchor-unresolved",
      "ref-unresolved",
      "resident-malformed",
    ]);
  });

  it("names each code once", () => {
    expect(new Set(CHECK_CODES).size).toBe(CHECK_CODES.length);
  });

  /** SPEC.md §11 carves out the non-failing states, and no others. */
  it("treats exactly the §11 states as warnings", () => {
    expect([...CHECK_WARNING_CODES]).toEqual([
      "anchor-unresolved",
      "ref-unresolved",
      // A designation is user-only state on a thread the user owns, and every
      // non-warning code blocks the write — so an error here would make the
      // broken thread permanently unwritable (CONTRACT-085).
      "resident-malformed",
    ]);
  });

  it("partitions the vocabulary into twelve errors and three warnings", () => {
    expect(CHECK_ERROR_CODES).toHaveLength(12);
    expect(CHECK_WARNING_CODES).toHaveLength(3);
    expect([...CHECK_ERROR_CODES, ...CHECK_WARNING_CODES].sort()).toEqual([...CHECK_CODES].sort());
  });

  /**
   * §11 lists "every anchor belongs to an existing thread" among the rules a
   * mutation must satisfy, so a highlight pointing at no conversation is
   * structural drift rather than an evolving-corpus state. It is the one code
   * that reads like a warning and is not.
   */
  it("keeps anchor-unused on the failing side", () => {
    expect(CHECK_ERROR_CODES).toContain("anchor-unused");
    expect([...CHECK_WARNING_CODES]).not.toContain("anchor-unused");
  });

  it.each([...CHECK_CODES])("accepts %s as a finding code", (code) => {
    expect(CheckFindingSchema.parse({ ...finding, code }).code).toBe(code);
  });

  it("rejects a code outside the closed vocabulary", () => {
    expect(CheckFindingSchema.safeParse({ ...finding, code: "vibes-off" }).success).toBe(false);
  });
});

describe("CheckFinding round-trips", () => {
  it.each([
    ["a warning", finding],
    ["an error", errorFinding],
  ])("preserves %s unchanged", (_label, value) => {
    expect(CheckFindingSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  /**
   * `docId` is deliberately an unvalidated nullable string: `id-prefix-mismatch`
   * and `frontmatter-invalid` exist to report an id that is malformed or of the
   * wrong kind, so a validated field would make the report unserializable in
   * exactly the cases it is written for.
   */
  it.each(["doc_a1b2c3", "th_x9y8", "note_oops", "", null])(
    "carries the offending id verbatim (%s)",
    (docId) => {
      expect(CheckFindingSchema.parse({ ...errorFinding, docId }).docId).toBe(docId);
    },
  );

  it("demands every field", () => {
    for (const field of ["code", "severity", "docId", "path", "detail"] as const) {
      const { [field]: _omitted, ...rest } = errorFinding;
      expect(CheckFindingSchema.safeParse(rest).success, field).toBe(false);
    }
  });
});

describe("CheckReport round-trips", () => {
  it("preserves a clean report", () => {
    const report = { ok: true, errors: [], warnings: [] };
    expect(CheckReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("preserves a report carrying one finding of each severity", () => {
    const report = { ok: false, errors: [errorFinding], warnings: [finding] };
    expect(CheckReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("demands the verdict rather than leaving it derivable", () => {
    expect(CheckReportSchema.safeParse({ errors: [], warnings: [] }).success).toBe(false);
  });
});

describe("CheckDocumentInput is toCheckDocument's argument list", () => {
  it("is exactly the (path, content) pair", () => {
    const pair = { path: "data/docs/mortgage.md", content: "---\nid: doc_a1b2c3\n---\n\nBody.\n" };
    expect(CheckDocumentInputSchema.parse(JSON.parse(JSON.stringify(pair)))).toEqual(pair);
  });

  /** Saving an empty file reports unparseable frontmatter; checking it must too. */
  it("accepts empty content", () => {
    expect(CheckDocumentInputSchema.parse({ path: "data/docs/x.md", content: "" }).content).toBe(
      "",
    );
  });

  it("rejects an empty path, which no finding could point at", () => {
    expect(CheckDocumentInputSchema.safeParse({ path: "", content: "x" }).success).toBe(false);
  });

  it.each(["path", "content"] as const)("demands %s", (field) => {
    const pair: Record<string, string> = { path: "data/docs/x.md", content: "x" };
    delete pair[field];
    expect(CheckDocumentInputSchema.safeParse(pair).success).toBe(false);
  });
});

describe("the check request is ids XOR content pairs", () => {
  it("accepts the ids form", () => {
    const request = { ids: ["doc_a1b2c3", "th_x9y8"] };
    expect(CheckRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });

  it("accepts the staged-content form", () => {
    const request = { documents: [{ path: "data/docs/x.md", content: "---\n---\n" }] };
    expect(CheckRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });

  /**
   * Empty means "nothing to check", not "check everything": `corpus doc check
   * --staged` with no staged document paths exits 0 silently, and a rejection
   * here would force the CLI to branch on emptiness before it could call at all.
   */
  it.each([
    ["ids", { ids: [] }],
    ["documents", { documents: [] }],
  ])("accepts an empty %s array", (_label, request) => {
    expect(CheckRequestSchema.parse(request)).toEqual(request);
  });

  /** The XOR lives here, in the schema — not in a handler that does not exist yet. */
  it("rejects a request naming both forms", () => {
    expect(CheckRequestSchema.safeParse({ ids: ["doc_a1b2c3"], documents: [] }).success).toBe(
      false,
    );
  });

  it("rejects a request naming neither", () => {
    expect(CheckRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown key alongside a valid form", () => {
    expect(CheckRequestSchema.safeParse({ ids: [], scope: "workspace" }).success).toBe(false);
  });

  it("rejects an id that is not a document id", () => {
    expect(CheckRequestSchema.safeParse({ ids: ["anc_k4f7"] }).success).toBe(false);
  });

  it("rejects a pair missing its content", () => {
    expect(CheckRequestSchema.safeParse({ documents: [{ path: "data/docs/x.md" }] }).success).toBe(
      false,
    );
  });

  /**
   * Zod reports a failed union as one top-level issue, so the default "Invalid
   * input" would reach the caller as the whole explanation. A schema-level XOR
   * whose refusal says nothing is a handler-shaped problem wearing a schema.
   */
  it.each([
    ["both forms", { ids: ["doc_a1b2c3"], documents: [] }],
    ["neither form", {}],
    ["an unknown key", { ids: [], scope: "workspace" }],
  ])("explains the rule when the request names %s", (_label, request) => {
    const result = CheckRequestSchema.safeParse(request);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([CHECK_REQUEST_XOR_MESSAGE]);
    expect(CHECK_REQUEST_XOR_MESSAGE).toContain("never both, never neither");
  });
});
