import { describe, expect, it } from "vitest";
import { AnchorIdSchema, DocIdSchema, EventIdSchema, ThreadIdSchema } from "@corpus/contract";
import {
  ID_PREFIXES,
  IdGenerationError,
  MAX_ID_ATTEMPTS,
  idPrefixForDocType,
  isAnchorId,
  isDocId,
  isDocumentId,
  isEventId,
  isThreadId,
  newId,
} from "./ids.js";

const GENERATED_SHAPE = /^(doc|th|anc|evt)_[a-z2-7]{8}$/;

describe("newId", () => {
  it.each(Object.values(ID_PREFIXES))("mints a %s_* id in the generated shape", (prefix) => {
    const id = newId(prefix);
    expect(id.startsWith(`${prefix}_`)).toBe(true);
    expect(id).toMatch(GENERATED_SHAPE);
  });

  it("mints ids the contract's schemas accept", () => {
    expect(DocIdSchema.safeParse(newId(ID_PREFIXES.doc)).success).toBe(true);
    expect(ThreadIdSchema.safeParse(newId(ID_PREFIXES.thread)).success).toBe(true);
    expect(AnchorIdSchema.safeParse(newId(ID_PREFIXES.anchor)).success).toBe(true);
    expect(EventIdSchema.safeParse(newId(ID_PREFIXES.event)).success).toBe(true);
  });

  it("does not repeat itself over a large batch", () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => newId(ID_PREFIXES.doc)));
    expect(ids.size).toBe(20_000);
  });

  it("retries past a predicate that reports the first candidates as taken", () => {
    let calls = 0;
    const id = newId(ID_PREFIXES.doc, () => {
      calls += 1;
      return calls <= 3;
    });
    expect(calls).toBe(4);
    expect(id).toMatch(GENERATED_SHAPE);
  });

  it("throws a named error after a bounded number of attempts", () => {
    let calls = 0;
    const call = () =>
      newId(ID_PREFIXES.anchor, () => {
        calls += 1;
        return true;
      });
    expect(call).toThrow(IdGenerationError);
    expect(call).toThrow(/anc_\*/);
    expect(calls).toBe(MAX_ID_ATTEMPTS * 2);
  });

  it("carries the prefix and attempt count on the error", () => {
    try {
      newId(ID_PREFIXES.doc, () => true);
      expect.unreachable("expected IdGenerationError");
    } catch (error) {
      expect(error).toBeInstanceOf(IdGenerationError);
      expect((error as IdGenerationError).name).toBe("IdGenerationError");
      expect((error as IdGenerationError).prefix).toBe("doc");
      expect((error as IdGenerationError).attempts).toBe(MAX_ID_ATTEMPTS);
    }
  });
});

describe("id guards", () => {
  it("delegates to the contract, accepting ids it did not generate", () => {
    // Uppercase and unusual lengths are contract-valid; only *generation* is narrow.
    expect(isDocId("doc_A1B2C3")).toBe(true);
    expect(isDocumentId("th_x")).toBe(true);
  });

  it.each([
    ["doc_a1b2c3", true, false, true, false, false],
    ["th_x9y8", false, true, true, false, false],
    ["anc_k4f7", false, false, false, true, false],
    ["evt_7c1d", false, false, false, false, true],
    ["doc_", false, false, false, false, false],
    ["nope", false, false, false, false, false],
    ["doc_a1b2c3 ", false, false, false, false, false],
  ])("classifies %s", (id, doc, thread, document, anchor, event) => {
    expect(isDocId(id)).toBe(doc);
    expect(isThreadId(id)).toBe(thread);
    expect(isDocumentId(id)).toBe(document);
    expect(isAnchorId(id)).toBe(anchor);
    expect(isEventId(id)).toBe(event);
  });
});

describe("idPrefixForDocType", () => {
  it.each([
    ["thread", "th"],
    ["note", "doc"],
    ["view", "doc"],
    ["skill", "doc"],
    ["todo", "doc"],
  ])("maps type %s to %s_*", (type, prefix) => {
    expect(idPrefixForDocType(type)).toBe(prefix);
  });
});
