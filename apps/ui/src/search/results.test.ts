import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import {
  cursorTargets,
  groupResults,
  hasExactTitle,
  MIN_CREATE_QUERY_LENGTH,
  moveCursor,
  resultPath,
  shouldOfferCreate,
} from "./results";

const NOW = new Date("2026-07-27T09:00:00.000Z");

const note = (overrides = {}) => docRowFixture({ type: "note", ...overrides });
const thread = (overrides = {}) =>
  docRowFixture({
    type: "thread",
    path: "data/threads/th_x.md",
    turnCount: 3,
    parent: "doc_mortgage",
    parentTitle: "Mortgage options",
    ...overrides,
  });

describe("groupResults", () => {
  it("partitions one response into the prototype's two groups, documents first", () => {
    const groups = groupResults([
      note({ id: "doc_a" }),
      thread({ id: "th_a" }),
      note({ id: "doc_b" }),
      note({ id: "doc_c" }),
      thread({ id: "th_b" }),
    ]);

    expect(groups.map((group) => group.heading)).toEqual(["Documents · 3", "Threads · 2"]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["doc_a", "doc_b", "doc_c"]);
    expect(groups[1]?.rows.map((row) => row.id)).toEqual(["th_a", "th_b"]);
  });

  it("keeps the server's order inside a group rather than re-sorting it", () => {
    const groups = groupResults([note({ id: "doc_z" }), note({ id: "doc_a" })]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["doc_z", "doc_a"]);
  });

  it("drops an empty partition instead of rendering `Threads · 0`", () => {
    expect(groupResults([note({ id: "doc_a" })]).map((group) => group.key)).toEqual(["documents"]);
    expect(groupResults([]).length).toBe(0);
  });

  it("counts a plugin type as a document rather than inventing a third group", () => {
    const groups = groupResults([docRowFixture({ id: "todo_1", type: "todos/todo" })]);
    expect(groups.map((group) => group.heading)).toEqual(["Documents · 1"]);
  });
});

describe("resultPath", () => {
  it("says where a document lives and how old it is", () => {
    const row = note({
      path: "data/docs/finance/housing/mortgage.md",
      updated: "2026-07-25T09:00:00.000Z",
    });
    expect(resultPath(row, NOW)).toBe("finance/housing/ · updated 2d ago");
  });

  it("does not say 'just now ago' for a document edited minutes ago", () => {
    const fresh = note({ path: "data/docs/inbox/x.md", updated: "2026-07-27T08:59:00.000Z" });
    expect(resultPath(fresh, NOW)).toBe("inbox/ · updated just now");
  });

  it("names the parent a thread hangs off, and its status", () => {
    expect(resultPath(thread({ status: "open" }), NOW)).toBe("on Mortgage options · open");
  });

  it("counts turns for a standalone thread — the conversation is the document", () => {
    expect(resultPath(thread({ parent: null, parentTitle: null, turnCount: 3 }), NOW)).toBe(
      "standalone · 3 turns",
    );
    expect(resultPath(thread({ parent: null, parentTitle: null, turnCount: 1 }), NOW)).toBe(
      "standalone · 1 turn",
    );
  });

  it("renders nothing rather than a raw id when the parent is gone", () => {
    const orphan = thread({ parentTitle: null, status: "open" });
    expect(resultPath(orphan, NOW)).toBe("open");
    expect(resultPath(orphan, NOW)).not.toContain("doc_");
  });

  it("degrades to the folder alone for a document nothing can date", () => {
    const undated = note({ created: null, updated: null, reviewed: null });
    expect(resultPath(undated, NOW)).toBe("inbox/");
  });
});

describe("the create row's visibility", () => {
  const items = [note({ id: "doc_a", title: "Mortgage options" })];

  it("stays hidden below two characters", () => {
    expect(MIN_CREATE_QUERY_LENGTH).toBe(2);
    expect(shouldOfferCreate([], "m")).toBe(false);
    expect(shouldOfferCreate([], "mo")).toBe(true);
  });

  it("stays hidden when a returned row already carries that title, case-insensitively", () => {
    expect(hasExactTitle(items, "mortgage OPTIONS")).toBe(true);
    expect(shouldOfferCreate(items, "  mortgage options  ")).toBe(false);
    expect(shouldOfferCreate(items, "mortgage option")).toBe(true);
  });

  it("is offered when nothing came back at all", () => {
    expect(shouldOfferCreate([], "a brand new thought")).toBe(true);
  });

  it("never matches the empty title of an untitled row", () => {
    expect(hasExactTitle([note({ title: "" })], "")).toBe(false);
  });
});

describe("the keyboard cursor", () => {
  const groups = groupResults([note({ id: "doc_a" }), thread({ id: "th_a" })]);

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
