import { describe, expect, it } from "vitest";
import { docRowFixture } from "../testing/docRow.js";
import {
  folderOf,
  isThreadRow,
  rowContext,
  rowExcerpt,
  threadExcerpt,
  threadKind,
} from "./threadRow.js";

const threadRow = (overrides = {}) =>
  docRowFixture({
    id: "th_1",
    type: "thread",
    path: "data/threads/th_1.md",
    parent: "doc_mortgage",
    turnCount: 2,
    lastAuthor: "agent",
    lastTurn: "Rates moved again — want me to redo the table?",
    unread: true,
    awaitingAgent: false,
    ...overrides,
  });

describe("isThreadRow", () => {
  it.each([
    ["thread", true],
    ["note", false],
    ["todo", false],
  ])("says %s is a thread: %s", (type, expected) => {
    expect(isThreadRow(docRowFixture({ type }))).toBe(expected);
  });
});

describe("threadKind", () => {
  it("is standalone when there is no parent", () => {
    expect(threadKind(threadRow({ parent: null }))).toBe("standalone");
  });

  it("is anchored when the row carries the quote it hangs off", () => {
    expect(threadKind(threadRow({ anchorQuote: "assume a 30-year fixed" }))).toBe("anchored");
  });

  it("is whole-document when there is a parent but no quote", () => {
    expect(threadKind(threadRow())).toBe("whole-document");
  });
});

describe("threadExcerpt", () => {
  it("attributes the last turn", () => {
    expect(threadExcerpt(threadRow())).toBe(
      "agent: Rates moved again — want me to redo the table?",
    );
  });

  it("is null for a thread with no turns, and never prints null or undefined", () => {
    const empty = threadExcerpt(threadRow({ lastAuthor: null, lastTurn: null, turnCount: 0 }));
    expect(empty).toBeNull();
  });

  it("is null when only one half of the pair arrived", () => {
    expect(threadExcerpt(threadRow({ lastTurn: null }))).toBeNull();
    expect(threadExcerpt(threadRow({ lastAuthor: null }))).toBeNull();
  });

  it("treats a whitespace-only turn as no turn", () => {
    expect(threadExcerpt(threadRow({ lastTurn: "   " }))).toBeNull();
  });
});

describe("rowExcerpt", () => {
  it("prefers a thread's last turn over its stored excerpt", () => {
    expect(rowExcerpt(threadRow({ excerpt: "stored" }))).toBe(
      "agent: Rates moved again — want me to redo the table?",
    );
  });

  it("falls back to the stored excerpt when the thread has no turns", () => {
    const row = threadRow({ lastAuthor: null, lastTurn: null, excerpt: "stored" });
    expect(rowExcerpt(row)).toBe("stored");
  });

  it("is the stored excerpt on a document", () => {
    expect(rowExcerpt(docRowFixture({ excerpt: "Policy lapses Oct 1." }))).toBe(
      "Policy lapses Oct 1.",
    );
  });

  it("is null rather than an empty line when there is nothing to show", () => {
    expect(rowExcerpt(docRowFixture({ excerpt: "  " }))).toBeNull();
  });
});

describe("folderOf", () => {
  it.each([
    ["data/docs/finance/2025-taxes.md", "finance/"],
    ["data/docs/finance/tax/2025.md", "finance/tax/"],
    ["data/docs/inbox.md", ""],
    ["data/threads/th_1.md", ""],
  ])("renders %s as %s", (path, expected) => {
    expect(folderOf(path)).toBe(expected);
  });
});

describe("rowContext", () => {
  it("is the folder for a document row", () => {
    expect(rowContext(docRowFixture({ path: "data/docs/finance/x.md" }))).toBe("finance/");
  });

  it('says "standalone" for a standalone thread', () => {
    expect(rowContext(threadRow({ parent: null }))).toBe("standalone");
  });

  it("names the parent the row itself carries, in the prototype's phrasing", () => {
    expect(rowContext(threadRow({ parentTitle: "Mortgage options" }))).toBe("on Mortgage options");
  });

  it("names the parent of an anchored thread too, not just a whole-document one", () => {
    const anchored = threadRow({
      parentTitle: "Mortgage options",
      anchorQuote: "assume a 30-year fixed",
    });
    expect(rowContext(anchored)).toBe("on Mortgage options");
  });

  it("reflects a renamed parent, because the title is resolved per query", () => {
    expect(rowContext(threadRow({ parentTitle: "Mortgage options v2" }))).toBe(
      "on Mortgage options v2",
    );
  });

  it("renders nothing rather than a raw id when the parent no longer resolves", () => {
    // An orphaned thread (deleted parent, SPEC.md §9.2) keeps its `parent` id but
    // loses its title; the row prints neither `doc_mortgage` nor "null".
    expect(rowContext(threadRow({ parentTitle: null }))).toBeNull();
    expect(rowContext(threadRow({ parentTitle: "   " }))).toBeNull();
  });
});
