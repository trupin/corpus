import { describe, expect, it } from "vitest";
import { memoryStorage, throwingStorage } from "./testing.js";
import { readShowCompleted, TODOS_STORAGE_KEY, writeShowCompleted } from "./showCompleted.js";

/**
 * The Todos column's "also show completed" preference (PLUGINS-015, SPEC.md §12
 * rider signed 2026-08-12): browser-local, per column, and never the corpus.
 *
 * The store is passed in rather than read off `globalThis`, because the ambient
 * one under the runner is not dependable — see `testing.tsx`.
 */

const stored = (store: Storage): unknown => JSON.parse(store.getItem(TODOS_STORAGE_KEY) ?? "null");

describe("the show-completed preference", () => {
  it("defaults to no column showing completed items, and stores nothing", () => {
    const store = memoryStorage();
    expect(readShowCompleted(store)).toEqual(new Set());
    expect(store.getItem(TODOS_STORAGE_KEY)).toBeNull();
  });

  it("records one column's choice without disturbing another's", () => {
    const store = memoryStorage();
    writeShowCompleted("doc_a", true, store);
    writeShowCompleted("doc_b", true, store);
    expect(readShowCompleted(store)).toEqual(new Set(["doc_a", "doc_b"]));

    writeShowCompleted("doc_a", false, store);
    expect(readShowCompleted(store)).toEqual(new Set(["doc_b"]));
    expect(stored(store)).toEqual({ version: 1, showCompleted: ["doc_b"] });
  });

  it("is idempotent — turning it on twice stores one entry", () => {
    const store = memoryStorage();
    writeShowCompleted("doc_a", true, store);
    writeShowCompleted("doc_a", true, store);
    expect(stored(store)).toEqual({ version: 1, showCompleted: ["doc_a"] });
  });

  /**
   * A blob this version cannot read degrades to the default rather than being
   * repaired: the cost is one lost preference, and the alternative is guessing
   * at a shape.
   */
  it.each([
    ["not json at all", "{{{"],
    ["a json scalar", '"nope"'],
    ["null", "null"],
    ["a future version", JSON.stringify({ version: 2, showCompleted: ["doc_a"] })],
    ["a missing list", JSON.stringify({ version: 1 })],
    ["a list that is not one", JSON.stringify({ version: 1, showCompleted: "doc_a" })],
  ])("degrades to the default for %s", (_label, raw) => {
    const store = memoryStorage({ [TODOS_STORAGE_KEY]: raw });
    expect(readShowCompleted(store)).toEqual(new Set());
  });

  it("keeps the string ids out of a list that mixes in other values", () => {
    const store = memoryStorage({
      [TODOS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        showCompleted: ["doc_a", 7, null, "doc_b"],
      }),
    });
    expect(readShowCompleted(store)).toEqual(new Set(["doc_a", "doc_b"]));
  });

  it("reads the default and writes nothing when there is no store at all", () => {
    expect(readShowCompleted(null)).toEqual(new Set());
    expect(() => {
      writeShowCompleted("doc_a", true, null);
    }).not.toThrow();
  });

  /** Safari private mode: the column still works, the preference is just lost. */
  it("loses the preference rather than throwing when the store refuses", () => {
    const store = throwingStorage();
    expect(readShowCompleted(store)).toEqual(new Set());
    expect(() => {
      writeShowCompleted("doc_a", true, store);
    }).not.toThrow();
  });
});
