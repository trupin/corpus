import { describe, expect, it } from "vitest";
import {
  appendItem,
  dueCount,
  isOverdue,
  itemProblems,
  itemsOrEmpty,
  openItems,
  readItems,
  removeItem,
  resolveSelector,
  serializeItems,
  TodoItemError,
  updateItem,
  type TodoItem,
} from "./items.js";

const TS = "2026-07-20T09:00:00.000Z";

const item = (overrides: Partial<TodoItem> = {}): TodoItem => ({
  text: "Renew passport",
  done: false,
  ts: TS,
  ...overrides,
});

const carrier = (items: unknown): { extra: Record<string, unknown> } => ({ extra: { items } });

describe("readItems", () => {
  it("treats an absent, null or empty `items` key as an empty list", () => {
    // sprint-014 Adjudication 17: template pre-fill is body-only, so no seed
    // can supply `items: []` — absence has to mean empty everywhere instead.
    expect(readItems(undefined)).toEqual({ ok: true, items: [] });
    expect(readItems({ extra: {} })).toEqual({ ok: true, items: [] });
    expect(readItems(carrier(null))).toEqual({ ok: true, items: [] });
    expect(readItems(carrier([]))).toEqual({ ok: true, items: [] });
  });

  it("parses well-formed items, `due` included", () => {
    const read = readItems(carrier([{ text: "a", done: true, ts: TS, due: "2026-08-01" }]));
    expect(read).toEqual({
      ok: true,
      items: [{ text: "a", done: true, ts: TS, due: "2026-08-01" }],
    });
  });

  it("names the offending field when `items` is not a list", () => {
    const read = readItems(carrier("nope"));
    expect(read.ok).toBe(false);
    expect(read.ok ? [] : read.problems).toEqual(["items: must be a list of items; found string"]);
  });

  it.each([
    [{ done: false, ts: TS }, "items[0].text"],
    [{ text: "", done: false, ts: TS }, "items[0].text"],
    [{ text: "a", ts: TS }, "items[0].done"],
    [{ text: "a", done: "yes", ts: TS }, "items[0].done"],
    [{ text: "a", done: false }, "items[0].ts"],
    [{ text: "a", done: false, ts: "not a date" }, "items[0].ts"],
    [{ text: "a", done: false, ts: TS, due: "Friday" }, "items[0].due"],
  ])("rejects %o naming %s", (entry, field) => {
    const read = readItems(carrier([entry]));
    expect(read.ok).toBe(false);
    expect((read.ok ? [] : read.problems).join("; ")).toContain(field);
  });

  it("reports the index of the offending item, not just the first", () => {
    const read = readItems(carrier([item(), { text: "b", done: 1, ts: TS }]));
    expect((read.ok ? [] : read.problems).join("; ")).toContain("items[1].done");
  });
});

describe("itemsOrEmpty and itemProblems", () => {
  it("degrades a malformed document to no items, for list surfaces", () => {
    expect(itemsOrEmpty(carrier("nope"))).toEqual([]);
    expect(itemsOrEmpty(carrier([item()]))).toEqual([item()]);
  });

  it("answers the manifest's `validate` with problems, empty when valid", () => {
    expect(itemProblems(carrier([item()]))).toEqual([]);
    expect(itemProblems(carrier([{ text: "a" }]))).not.toEqual([]);
  });
});

describe("serializeItems", () => {
  it("omits `due` when absent and keeps it when present", () => {
    expect(serializeItems([item(), item({ due: "2026-08-01" })])).toEqual([
      { text: "Renew passport", done: false, ts: TS },
      { text: "Renew passport", done: false, ts: TS, due: "2026-08-01" },
    ]);
  });
});

describe("appendItem", () => {
  it("appends an open item carrying the caller's creation instant", () => {
    const next = appendItem([item()], { text: "Call plumber", ts: "2026-07-21T10:00:00.000Z" });
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      text: "Call plumber",
      done: false,
      ts: "2026-07-21T10:00:00.000Z",
    });
  });

  it("carries an optional due date through", () => {
    const next = appendItem([], { text: "a", ts: TS, due: "2026-08-01" });
    expect(next[0]?.due).toBe("2026-08-01");
  });

  it("refuses empty text and a malformed due date", () => {
    expect(() => appendItem([], { text: "", ts: TS })).toThrow(TodoItemError);
    expect(() => appendItem([], { text: "a", ts: TS, due: "Friday" })).toThrow(/due/);
  });
});

describe("updateItem", () => {
  const list = [item({ text: "a" }), item({ text: "b", ts: "2026-07-19T09:00:00.000Z" })];

  it("flips `done` and leaves `ts` byte-identical", () => {
    const toggled = updateItem(list, 1, { done: true });
    expect(toggled[1]).toEqual({ text: "b", done: true, ts: "2026-07-19T09:00:00.000Z" });
    // A toggle is not a creation: two round trips must not move the timestamp.
    expect(updateItem(toggled, 1, { done: false })[1]?.ts).toBe("2026-07-19T09:00:00.000Z");
  });

  it("leaves every other item untouched", () => {
    expect(updateItem(list, 1, { done: true })[0]).toEqual(list[0]);
  });

  it("renames an item without touching `done`", () => {
    expect(updateItem([item({ done: true })], 0, { text: "renamed" })[0]).toEqual({
      text: "renamed",
      done: true,
      ts: TS,
    });
  });

  it("sets, keeps and clears `due`", () => {
    const dated = updateItem(list, 0, { due: "2026-08-01" });
    expect(dated[0]?.due).toBe("2026-08-01");
    expect(updateItem(dated, 0, { done: true })[0]?.due).toBe("2026-08-01");
    expect(updateItem(dated, 0, { due: null })[0]?.due).toBeUndefined();
  });

  it("refuses an out-of-range index with a readable message", () => {
    expect(() => updateItem(list, 5, { done: true })).toThrow(/out of range/);
    expect(() => updateItem(list, -1, { done: true })).toThrow(/out of range/);
    try {
      updateItem(list, 5, { done: true });
    } catch (error) {
      expect((error as TodoItemError).status).toBe(400);
    }
  });

  it("refuses with 409 when the item at that index changed under the caller", () => {
    try {
      updateItem(list, 0, { done: true, expectedText: "something else" });
      expect.unreachable("the guard must throw");
    } catch (error) {
      expect((error as TodoItemError).status).toBe(409);
      expect((error as TodoItemError).message).toContain("changed under you");
    }
  });

  it("passes the guard when the expected text still matches", () => {
    expect(updateItem(list, 0, { done: true, expectedText: "a" })[0]?.done).toBe(true);
  });

  it("refuses a rename to empty text", () => {
    expect(() => updateItem(list, 0, { text: "" })).toThrow(/text/);
  });
});

describe("removeItem", () => {
  const list = [item({ text: "a" }), item({ text: "b" }), item({ text: "c", done: true })];

  it("removes exactly one item and keeps the others verbatim", () => {
    expect(removeItem(list, 1)).toEqual([list[0], list[2]]);
  });

  it("honours the same concurrency guard", () => {
    expect(() => removeItem(list, 1, "a")).toThrow(/changed under you/);
    expect(removeItem(list, 1, "b")).toHaveLength(2);
  });

  it("refuses an out-of-range index", () => {
    expect(() => removeItem(list, 9)).toThrow(/out of range/);
  });
});

describe("resolveSelector", () => {
  const list = [item({ text: "Renew passport" }), item({ text: "Call plumber" })];

  it("accepts a 1-based number and returns a 0-based index", () => {
    expect(resolveSelector(list, "1")).toBe(0);
    expect(resolveSelector(list, " 2 ")).toBe(1);
  });

  it("accepts text, case-insensitively", () => {
    expect(resolveSelector(list, "renew PASSPORT")).toBe(0);
  });

  it("refuses a number outside the list", () => {
    expect(() => resolveSelector(list, "0")).toThrow(/has 2 items/);
    expect(() => resolveSelector(list, "3")).toThrow(/has 2 items/);
    expect(() => resolveSelector([item()], "5")).toThrow(/has 1 item/);
  });

  it("refuses text that matches nothing", () => {
    expect(() => resolveSelector(list, "nothing")).toThrow(/no item matches/);
  });

  it("refuses duplicate text and names the candidate numbers", () => {
    const dupes = [item({ text: "milk" }), item({ text: "bread" }), item({ text: "Milk" })];
    expect(() => resolveSelector(dupes, "milk")).toThrow(/matches 2 items \(1, 3\)/);
  });
});

describe("derivations", () => {
  const list = [
    item({ text: "a" }),
    item({ text: "b", done: true, due: "2026-07-01" }),
    item({ text: "c", due: "2026-07-25" }),
    item({ text: "d", due: "2026-07-10" }),
  ];

  it("counts open items and open items with a deadline", () => {
    expect(openItems(list).map((entry) => entry.text)).toEqual(["a", "c", "d"]);
    expect(dueCount(list)).toBe(2);
    expect(dueCount([])).toBe(0);
  });

  it("calls an open item overdue only once its date has passed", () => {
    const today = new Date("2026-07-20T12:00:00.000Z");
    expect(isOverdue(item({ due: "2026-07-10" }), today)).toBe(true);
    expect(isOverdue(item({ due: "2026-07-20" }), today)).toBe(false);
    expect(isOverdue(item({ due: "2026-07-25" }), today)).toBe(false);
    // A completed item is never overdue, and neither is one with no deadline.
    expect(isOverdue(item({ due: "2026-07-10", done: true }), today)).toBe(false);
    expect(isOverdue(item(), today)).toBe(false);
  });
});
