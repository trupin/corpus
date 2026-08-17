import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as contract from "@corpus/contract/client";
import { hashKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  canonicalFilter,
  DOCS_KEY,
  docKey,
  docsListKey,
  HEALTH_KEY,
  jobKey,
  JOBS_KEY,
  jobsListKey,
  PLUGIN_KEY_PREFIX,
  pluginKey,
  QUEUE_KEY,
  relatedKey,
  searchKey,
  threadKey,
  TREE_KEY,
} from "./keys.js";

describe("the core vocabulary is the contract's, not the kit's", () => {
  // TEST-6. A kit that spells these itself caches under keys no `invalidate`
  // frame ever names: every unit test passes and every reader goes stale
  // forever. Asserting identity with the contract's own builders makes a rename
  // upstream a failure here instead of a silent cache miss in the browser.
  it("re-exports the same builders the server emits from", () => {
    expect(DOCS_KEY).toBe(contract.DOCS_KEY);
    expect(TREE_KEY).toBe(contract.TREE_KEY);
    expect(QUEUE_KEY).toBe(contract.QUEUE_KEY);
    expect(JOBS_KEY).toBe(contract.JOBS_KEY);
    expect(docKey).toBe(contract.docKey);
    expect(threadKey).toBe(contract.threadKey);
    expect(jobKey).toBe(contract.jobKey);
  });

  it("spells a document key `docs` and a thread key `threads`, plural", () => {
    // The issue file's original Technical Design said `["doc", id]` /
    // `["thread", id]`. It was wrong; this is the shipped spelling.
    expect(docKey("doc_x")).toEqual(["docs", "doc_x"]);
    expect(threadKey("th_x")).toEqual(["threads", "th_x"]);
    expect(docKey("doc_x")).not.toEqual(["doc", "doc_x"]);
    expect(threadKey("th_x")).not.toEqual(["thread", "th_x"]);
  });

  it("keeps the unparameterised shapes exactly as the vocabulary documents them", () => {
    expect(DOCS_KEY).toEqual(["docs"]);
    expect(TREE_KEY).toEqual(["tree"]);
    expect(QUEUE_KEY).toEqual(["queue"]);
    expect(JOBS_KEY).toEqual(["jobs"]);
    expect(jobKey("evt_1")).toEqual(["jobs", "evt_1"]);
  });
});

describe("keys the kit owns because the contract's set is closed", () => {
  // TEST-12: the upstream shapes are closed and pinned by `query-keys.test.ts`.
  // These two are needed here and may not be added there.
  it("names the health probe, which no server mutation emits", () => {
    expect(HEALTH_KEY).toEqual(["health"]);
    expect(contract.QUERY_KEY_NAMES).not.toContain("health");
  });

  it("namespaces plugin keys under `x`", () => {
    expect(pluginKey("todos", "board")).toEqual(["x", "todos", "board"]);
    expect(PLUGIN_KEY_PREFIX).toBe("x");
    expect(pluginKey("todos")).toEqual(["x", "todos"]);
    expect(pluginKey("todos", "board", 3, { done: true })).toEqual([
      "x",
      "todos",
      "board",
      3,
      { done: true },
    ]);
  });

  it("cannot collide with a core shape, whatever the plugin is called", () => {
    expect(pluginKey("docs")[0]).not.toBe(DOCS_KEY[0]);
  });
});

describe("canonicalFilter", () => {
  // TEST-8: a column that re-renders its filters in a different order must not
  // double the request rate against an identical result set.
  it("produces deeply equal output for logically identical filters", () => {
    const a = canonicalFilter({ type: "note", tag: ["b", "a"], folder: "finance" });
    const b = canonicalFilter({ folder: "finance", tag: ["a", "b"], type: "note" });
    expect(a).toEqual(b);
    expect(hashKey([a])).toBe(hashKey([b]));
  });

  it("drops undefined, null and empty-string members", () => {
    expect(canonicalFilter({ q: "", type: undefined, status: null, folder: "x" })).toEqual({
      folder: "x",
    });
  });

  it("drops empty arrays and empty nested objects", () => {
    expect(canonicalFilter({ tag: [], nested: {}, keep: 1 })).toEqual({ keep: 1 });
  });

  it("drops empty members from within an array", () => {
    expect(canonicalFilter({ tag: ["a", "", null, undefined] })).toEqual({ tag: ["a"] });
  });

  // TEST-9: totality.
  it("returns an empty object for an empty filter, and for no filter at all", () => {
    expect(canonicalFilter({})).toEqual({});
    expect(canonicalFilter()).toEqual({});
  });

  it("returns an empty object when every value is empty", () => {
    expect(canonicalFilter({ q: "", tag: [], parent: null })).toEqual({});
  });

  it("sorts nested arrays as well as top-level ones", () => {
    expect(canonicalFilter({ nested: [[2, 1], [3]] })).toEqual({ nested: [[1, 2], [3]] });
  });

  it("canonicalises nested objects", () => {
    expect(canonicalFilter({ where: { b: 1, a: ["y", "x"] } })).toEqual({
      where: { a: ["x", "y"], b: 1 },
    });
  });

  // TEST-9: an unknown filter is PRESERVED. The contract may grow a query
  // parameter without a kit release; allowlisting the grammar would mean a
  // board column silently dropping a filter the server understands.
  it("preserves a filter the kit has never heard of", () => {
    expect(canonicalFilter({ somethingNew: "value", q: "x" })).toEqual({
      q: "x",
      somethingNew: "value",
    });
  });

  it("emits keys in sorted order, so the encoding is stable across calls", () => {
    const first = canonicalFilter({ sort: "title", q: "a", folder: "f" });
    const second = canonicalFilter({ folder: "f", sort: "title", q: "a" });
    expect(Object.keys(first)).toEqual(["folder", "q", "sort"]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps booleans and numbers, which are meaningful filter values", () => {
    expect(canonicalFilter({ unread: false, limit: 0 })).toEqual({ unread: false, limit: 0 });
  });
});

// TEST-11: a plugin author reads the README, not this module. A divergence
// between it and the contract's published vocabulary is the exact failure that
// makes someone build against a key nothing emits.
describe("packages/kit/README.md", () => {
  // A `|` inside a table cell is escaped in markdown; unescape before matching
  // so the assertion is about the shape, not about the table syntax.
  const readme = readFileSync(
    fileURLToPath(new URL("../../README.md", import.meta.url)),
    "utf8",
  ).replaceAll("\\|", "|");

  it.each(contract.QUERY_KEY_NAMES)(
    "documents the `%s` shape exactly as the contract publishes it",
    (name) => {
      const { shape } = contract.QUERY_KEY_VOCABULARY[name];
      expect(readme).toContain(`\`${shape}\``);
    },
  );

  it("documents the two kit-owned shapes and the plugin namespace", () => {
    expect(readme).toContain('`["health"]`');
    expect(readme).toContain('`["x", "<plugin>", …]`');
    expect(readme).toContain("pluginKey");
  });

  it("states the rule that the kit is the only data path", () => {
    expect(readme).toContain("The kit is the only data path");
    expect(readme).toContain("One provider per application");
  });

  /**
   * UI-070. The attachment trio is published *for a reader outside this repo* —
   * the plugin author who cannot see `apps/ui`'s composers and has only this
   * file to learn the shape from. An export the README does not name is an
   * export nobody consumes, which is how the todos composer went a whole
   * release without attachments while the code to give it some already existed.
   */
  it.each([
    "useAttachmentIntake",
    "PendingAttachments",
    "AttachButton",
    "releaseAttachments",
    "@corpus/kit/composer.css",
  ])("documents `%s`, the attachment surface a plugin composer consumes", (symbol) => {
    expect(readme).toContain(symbol);
  });

  /** The restore-on-failure contract, which is the non-obvious half of it. */
  it("states that a refused send puts the attachments back", () => {
    expect(readme).toContain("Every composer takes attachments");
    expect(readme).toMatch(/`take`\s*\/\s*`restore`\s*\/\s*`release`/);
  });
});

describe("collection keys", () => {
  it("always carries a filter segment, so it never collides with a document key", () => {
    // TEST-10. `["docs", {}]` and `["docs", "doc_x"]` share the `["docs"]`
    // prefix and nothing else.
    expect(docsListKey({})).toEqual(["docs", {}]);
    expect(docsListKey()).toEqual(["docs", {}]);
    expect(hashKey(docsListKey({}))).not.toBe(hashKey(docKey("doc_x")));
  });

  it("carries the canonical filter, not the caller's object", () => {
    expect(docsListKey({ tag: ["b", "a"], q: undefined })).toEqual(["docs", { tag: ["a", "b"] }]);
  });

  it("keys the job list the same way", () => {
    expect(jobsListKey({ recent: 20 })).toEqual(["jobs", { recent: 20 }]);
    expect(jobsListKey()).toEqual(["jobs", {}]);
  });
});

/**
 * TEST-1009/TEST-1010 and TEST-1032. Sprint-022 Open Conflict 7: the two
 * retrieval reads cache under the `["docs"]` prefix the server already emits on,
 * so neither adds a name to a vocabulary that is closed and published into
 * `openapi.json`.
 */
describe("retrieval keys", () => {
  it("keys a related set under its own document", () => {
    expect(relatedKey("doc_x")).toEqual(["docs", "doc_x", "related"]);
  });

  it("keys a search under the docs prefix, with its canonical params", () => {
    expect(searchKey({ q: "budget", tag: ["b", "a"] })).toEqual([
      "docs",
      "search",
      { q: "budget", tag: ["a", "b"] },
    ]);
    expect(searchKey()).toEqual(["docs", "search", {}]);
  });

  it("adds no name to the contract's closed vocabulary", () => {
    // A new name would be a contract change plus an artifact regeneration.
    expect(contract.QUERY_KEY_NAMES).not.toContain("related");
    expect(contract.QUERY_KEY_NAMES).not.toContain("search");
    expect(relatedKey("doc_x")[0]).toBe(DOCS_KEY[0]);
    expect(searchKey({ q: "x" })[0]).toBe(DOCS_KEY[0]);
  });

  it("sits under the prefixes the server names, which is what invalidates it", () => {
    // TanStack matching is prefix-based, so both of these are the whole point.
    expect(relatedKey("doc_x").slice(0, 1)).toEqual(DOCS_KEY);
    expect(relatedKey("doc_x").slice(0, 2)).toEqual(docKey("doc_x"));
    expect(searchKey({ q: "x" }).slice(0, 1)).toEqual(DOCS_KEY);
  });

  it("cannot be reached by a document key, and cannot reach one", () => {
    // `"search"` is not a document id (ids are `<prefix>_<suffix>`), and the
    // `"related"` tail keeps a related set out of the reader's own entry.
    expect(hashKey(relatedKey("doc_x"))).not.toBe(hashKey(docKey("doc_x")));
    expect(hashKey(searchKey({ q: "x" }))).not.toBe(hashKey(docsListKey({ q: "x" })));
  });
});
