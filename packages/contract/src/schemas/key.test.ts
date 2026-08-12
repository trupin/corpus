import { describe, expect, it } from "vitest";
import {
  DOCUMENT_KEY_LENGTH,
  DOCUMENT_KEY_PATTERN,
  DocumentKeySchema,
  KEYED_UPDATE_FIELDS,
  MISSING_DOCUMENT_KEY_MESSAGE,
  updateNeedsDocumentKey,
  userEditingField,
} from "./key.js";

/** A key as the wire carries one — and the only way this file ever makes one. */
const KEY = "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcde";

describe("a document key on the wire", () => {
  it("round-trips verbatim, because a client's only job is to echo it", () => {
    expect(DocumentKeySchema.parse(KEY)).toBe(KEY);
  });

  it("is the fixed width the derivation produces", () => {
    expect(KEY).toHaveLength(DOCUMENT_KEY_LENGTH);
    expect(DOCUMENT_KEY_PATTERN.test(KEY)).toBe(true);
  });

  it.each([
    ["an empty string, which is not a key but reads like an absent one", ""],
    ["a blank string", "   "],
    ["a document id", "doc_a1b2c3"],
    ["a path", "data/docs/mortgage.md"],
    ["an issued-looking token, which this mechanism never mints", "key_01HQ8Z3M4N5P6Q7R"],
    ["one character short", "a".repeat(DOCUMENT_KEY_LENGTH - 1)],
    ["one character long", "a".repeat(DOCUMENT_KEY_LENGTH + 1)],
    ["a non-hex character", `${"a".repeat(DOCUMENT_KEY_LENGTH - 1)}z`],
  ])("refuses %s", (_label, value) => {
    expect(DocumentKeySchema.safeParse(value).success).toBe(false);
  });

  /**
   * Two spellings of one value would make equality — the only operation a key
   * supports — depend on which spelling a caller happened to send.
   */
  it("refuses uppercase hex rather than case-folding it", () => {
    expect(DocumentKeySchema.safeParse(KEY.toUpperCase()).success).toBe(false);
  });

  it("says what to do about a value that is not a key", () => {
    const parsed = DocumentKeySchema.safeParse("doc_a1b2c3");
    expect(parsed.error?.issues[0]?.message).toContain("read the document");
  });

  /**
   * The published description is the contract a client author reading only
   * `openapi.json` gets. Two things must survive any rewording of it: that the
   * value is opaque and echoed, and that the derivation is *not* published — a
   * caller who knows the algorithm is a caller who will eventually compute one,
   * and a computed key is evidence of a read that never happened.
   */
  it("publishes the opacity rules and withholds the algorithm", () => {
    const description = DocumentKeySchema.meta()?.description ?? "";
    expect(description).toContain("opaque");
    expect(description).toContain("Echo it back exactly as received");
    expect(description).toContain("Never compute");
    for (const leak of ["SHA-256", "sha256", "digest", "hash"]) {
      expect(description, leak).not.toContain(leak);
    }
  });
});

describe("which writes must present a key (SPEC.md §7)", () => {
  it("names the block-replacing fields, and only those", () => {
    expect([...KEYED_UPDATE_FIELDS]).toEqual(["body"]);
  });

  it("demands one for a body write", () => {
    expect(updateNeedsDocumentKey({ body: "new body" })).toBe(true);
  });

  /** An omitted body is exactly a `{}` body: a save that rewrites nothing. */
  it("demands none when the body is absent", () => {
    expect(updateNeedsDocumentKey({})).toBe(false);
    expect(updateNeedsDocumentKey({ body: undefined })).toBe(false);
  });

  /** Replacing the block with nothing is the most destructive spelling of it. */
  it("demands one for an emptied body", () => {
    expect(updateNeedsDocumentKey({ body: "" })).toBe(true);
  });

  it("tells a keyless body write what it is missing and why", () => {
    expect(MISSING_DOCUMENT_KEY_MESSAGE).toContain("`key` is required");
    expect(MISSING_DOCUMENT_KEY_MESSAGE).toContain("§7");
  });
});

describe("the advisory editing signal", () => {
  it("is a plain fact, true or false", () => {
    expect(userEditingField.parse(true)).toBe(true);
    expect(userEditingField.parse(false)).toBe(false);
    expect(userEditingField.safeParse(null).success).toBe(false);
  });

  /**
   * The one thing the description must never stop saying. §7 makes the trade
   * deliberately: ignoring this costs politeness, where forgetting the old lock
   * cost correctness.
   */
  it("says it is never a gate", () => {
    const description = userEditingField.meta()?.description ?? "";
    expect(description).toContain("never a gate");
    expect(description).toContain("nothing to release");
    expect(description).toContain("§7");
  });
});
