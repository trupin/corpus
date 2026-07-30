import { pluginKey } from "@corpus/kit";
import { describe, expect, it } from "vitest";
import { TODO_LISTS_KEY, todoListKey } from "./queries.js";

/**
 * The plugin's query keys, pinned against the kit's own builder.
 *
 * These are the keys `server/routes.ts` announces through
 * `broadcastInvalidate([["lists"], ["lists", docId]])` — the context prefixes
 * `["x", "todos", …]` onto each. Building them here with `pluginKey` rather
 * than writing the literal is what makes a rename a compile error on both
 * sides instead of a query that quietly never refetches.
 */
describe("the todos plugin's query keys", () => {
  it("namespaces the collection under x/todos", () => {
    expect(TODO_LISTS_KEY).toEqual(["x", "todos", "lists"]);
    expect(TODO_LISTS_KEY).toEqual(pluginKey("todos", "lists"));
  });

  it("namespaces one list under its document id", () => {
    expect(todoListKey("doc_a1b2c3")).toEqual(["x", "todos", "lists", "doc_a1b2c3"]);
    expect(todoListKey("doc_a1b2c3")).toEqual(pluginKey("todos", "lists", "doc_a1b2c3"));
  });
});
