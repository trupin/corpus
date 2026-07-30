import type { DocRow } from "@corpus/contract";
import { pluginKey } from "@corpus/kit";
import { docRowFixture } from "@corpus/kit/testing";
import { describe, expect, it } from "vitest";
import { docsFingerprint, listsPath, TODO_LISTS_KEY, todoListKey } from "./queries.js";

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

/**
 * TEST-511. The mechanism, checked directly rather than inferred from the
 * symptom: a column keyed on something a core write does not touch passes every
 * rendering test and still goes stale on the app's most ordinary interaction.
 */
describe("the (id, updated) fingerprint", () => {
  const row = (id: string, updated: string | null): DocRow =>
    docRowFixture({ id, type: "todo", title: id, updated });

  it("changes when any document's `updated` changes — which a core body edit stamps", () => {
    const before = docsFingerprint([
      row("doc_a", "2026-07-20T09:00:00.000Z"),
      row("doc_b", "2026-07-20T09:00:00.000Z"),
    ]);
    const after = docsFingerprint([
      row("doc_a", "2026-07-20T09:00:00.000Z"),
      row("doc_b", "2026-07-20T09:00:01.000Z"),
    ]);
    expect(after).not.toBe(before);
  });

  it("changes when a document appears or disappears", () => {
    const one = docsFingerprint([row("doc_a", "2026-07-20T09:00:00.000Z")]);
    const two = docsFingerprint([
      row("doc_a", "2026-07-20T09:00:00.000Z"),
      row("doc_b", "2026-07-20T09:00:00.000Z"),
    ]);
    expect(two).not.toBe(one);
    expect(docsFingerprint([])).not.toBe(one);
  });

  it("is stable for an unchanged result set, so an idle board does not refetch", () => {
    const rows = [row("doc_a", "2026-07-20T09:00:00.000Z"), row("doc_b", null)];
    expect(docsFingerprint(rows)).toBe(docsFingerprint([...rows]));
  });

  it("tolerates a document with no timestamp at all", () => {
    expect(docsFingerprint([row("doc_a", null)])).not.toBe(
      docsFingerprint([row("doc_a", "2026-07-20T09:00:00.000Z")]),
    );
  });

  /**
   * The load-bearing property: the aggregate's key **extends**
   * `["x","todos","lists"]`, and TanStack invalidation matches by prefix — so
   * the plugin's own broadcast still reaches this query. The fingerprint is
   * added beside the shipped invalidation path, never instead of it (TEST-510).
   */
  it("produces a path whose query key still starts with the broadcast key", () => {
    const path = listsPath("abc123");
    expect(path).toBe("lists/at/abc123");
    const key = pluginKey("todos", ...path.split("/"));
    expect(key).toEqual(["x", "todos", "lists", "at", "abc123"]);
    expect(key.slice(0, TODO_LISTS_KEY.length)).toEqual(TODO_LISTS_KEY);
  });

  it("stays short enough to live in a URL, whatever the workspace holds", () => {
    const many = Array.from({ length: 200 }, (_entry, index) =>
      row(`doc_${String(index)}`, "2026-07-20T09:00:00.000Z"),
    );
    expect(docsFingerprint(many).length).toBeLessThanOrEqual(8);
  });
});
