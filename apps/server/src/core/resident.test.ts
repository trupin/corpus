import { describe, expect, it } from "vitest";
import { AGENT_NAME_MAX_LENGTH } from "@corpus/contract";
import { residentOrNull, storedResident } from "./resident.js";

describe("residentOrNull", () => {
  it("reads a well-formed designation", () => {
    expect(residentOrNull({ name: "researcher", docId: "doc_a1b2c3" })).toEqual({
      name: "researcher",
      docId: "doc_a1b2c3",
    });
  });

  it.each([
    ["nothing at all", undefined],
    ["an explicit null", null],
    ["a bare name", "researcher"],
    ["a name with no document", { name: "researcher" }],
    ["a document with no name", { docId: "doc_a1b2c3" }],
    ["a blank name", { name: "   ", docId: "doc_a1b2c3" }],
    ["a name spanning lines", { name: "resea\nrcher", docId: "doc_a1b2c3" }],
    ["a thread id in place of a document", { name: "researcher", docId: "th_a1b2c3" }],
    ["a name past the bound", { name: "a".repeat(AGENT_NAME_MAX_LENGTH + 1), docId: "doc_a1b2c3" }],
  ])("reads %s as no resident", (_label, value) => {
    expect(residentOrNull(value)).toBeNull();
  });

  it("keeps only the two fields the wire carries", () => {
    expect(residentOrNull({ name: "researcher", docId: "doc_a1b2c3", live: true })).toEqual({
      name: "researcher",
      docId: "doc_a1b2c3",
    });
  });
});

describe("storedResident", () => {
  const resident = { name: "researcher", docId: "doc_a1b2c3" };

  it("reads a standalone thread's designation", () => {
    expect(storedResident(resident, null)).toEqual(resident);
  });

  // SPEC.md §7: only a standalone thread may designate — a thread on a document
  // is *about* that document, and a resident owns a conversation rather than a
  // passage. The routes refuse to write one there; this is the other way in.
  it("reads nothing off a thread that has a parent", () => {
    expect(storedResident(resident, "doc_parent1")).toBeNull();
  });
});
