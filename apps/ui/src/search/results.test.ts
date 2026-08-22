import { describe, expect, it } from "vitest";
import {
  cursorTargets,
  groupResults,
  hasExactTitle,
  MIN_CREATE_QUERY_LENGTH,
  moveCursor,
  resultKind,
  shouldOfferCreate,
} from "./results";
import { hitFixture } from "./searchTransport";

const doc = (overrides = {}) => hitFixture({ id: "doc_a", ...overrides });
const thread = (overrides = {}) => hitFixture({ id: "th_a", ...overrides });

describe("resultKind", () => {
  it("reads the kind off the id prefix the contract reserves", () => {
    expect(resultKind({ id: "th_x9y8" })).toBe("thread");
    expect(resultKind({ id: "doc_a1b2c3" })).toBe("doc");
  });

  it("counts an unrecognised document type as a document — the prefix is the same", () => {
    expect(resultKind({ id: "doc_todo1" })).toBe("doc");
  });

  it("does not mistake a title or a heading for a kind", () => {
    // Only the id decides; `th` inside any other field is text.
    expect(resultKind({ id: "doc_theme" })).toBe("doc");
  });
});

describe("groupResults", () => {
  it("partitions one ranking into the prototype's two groups, documents first", () => {
    const groups = groupResults([
      doc({ id: "doc_a" }),
      thread({ id: "th_a" }),
      doc({ id: "doc_b" }),
      doc({ id: "doc_c" }),
      thread({ id: "th_b" }),
    ]);

    expect(groups.map((group) => group.heading)).toEqual(["Documents · 3", "Threads · 2"]);
    expect(groups[0]?.rows.map((hit) => hit.id)).toEqual(["doc_a", "doc_b", "doc_c"]);
    expect(groups[1]?.rows.map((hit) => hit.id)).toEqual(["th_a", "th_b"]);
  });

  it("keeps the server's ranking inside a group rather than re-sorting it", () => {
    const groups = groupResults([doc({ id: "doc_z" }), doc({ id: "doc_a" })]);
    expect(groups[0]?.rows.map((hit) => hit.id)).toEqual(["doc_z", "doc_a"]);
  });

  it("drops an empty partition instead of rendering `Threads · 0`", () => {
    expect(groupResults([doc({ id: "doc_a" })]).map((group) => group.key)).toEqual(["documents"]);
    expect(groupResults([]).length).toBe(0);
  });

  it("carries each hit's address and snippet through untouched", () => {
    const groups = groupResults([
      doc({ headingPath: "Mortgage options › Rate assumptions", snippet: "a 30-year fixed" }),
    ]);
    expect(groups[0]?.rows[0]).toMatchObject({
      headingPath: "Mortgage options › Rate assumptions",
      snippet: "a 30-year fixed",
    });
  });
});

describe("the create row's visibility", () => {
  const hits = [doc({ id: "doc_a", title: "Mortgage options" })];

  it("stays hidden below two characters", () => {
    expect(MIN_CREATE_QUERY_LENGTH).toBe(2);
    expect(shouldOfferCreate([], "m")).toBe(false);
    expect(shouldOfferCreate([], "mo")).toBe(true);
  });

  it("stays hidden when a returned hit already carries that title, case-insensitively", () => {
    expect(hasExactTitle(hits, "mortgage OPTIONS")).toBe(true);
    expect(shouldOfferCreate(hits, "  mortgage options  ")).toBe(false);
    expect(shouldOfferCreate(hits, "mortgage option")).toBe(true);
  });

  it("is offered when nothing came back at all", () => {
    expect(shouldOfferCreate([], "a brand new thought")).toBe(true);
  });

  it("never matches the empty title of an untitled hit", () => {
    expect(hasExactTitle([doc({ title: "" })], "")).toBe(false);
  });
});

describe("the keyboard cursor", () => {
  const groups = groupResults([doc({ id: "doc_a" }), thread({ id: "th_a" })]);

  it("walks the create row first, then every result, and no headers", () => {
    expect(cursorTargets(groups, true)).toEqual(["create", "doc_a", "th_a"]);
    expect(cursorTargets(groups, false)).toEqual(["doc_a", "th_a"]);
  });

  it("starts at the top on ↓ and at the bottom on ↑", () => {
    expect(moveCursor(-1, 1, 3)).toBe(0);
    expect(moveCursor(-1, -1, 3)).toBe(2);
  });

  it("clamps at both ends rather than wrapping onto the create row", () => {
    expect(moveCursor(0, -1, 3)).toBe(0);
    expect(moveCursor(2, 1, 3)).toBe(2);
    expect(moveCursor(1, 1, 3)).toBe(2);
  });

  it("has no cursor at all with nothing to point at", () => {
    expect(moveCursor(0, 1, 0)).toBe(-1);
  });
});
