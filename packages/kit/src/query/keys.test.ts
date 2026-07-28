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
  lockKey,
  LOCKS_KEY,
  PLUGIN_KEY_PREFIX,
  pluginKey,
  QUEUE_KEY,
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
    expect(LOCKS_KEY).toBe(contract.LOCKS_KEY);
    expect(docKey).toBe(contract.docKey);
    expect(threadKey).toBe(contract.threadKey);
    expect(jobKey).toBe(contract.jobKey);
    expect(lockKey).toBe(contract.lockKey);
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
    expect(LOCKS_KEY).toEqual(["locks"]);
    expect(jobKey("evt_1")).toEqual(["jobs", "evt_1"]);
    expect(lockKey("doc_1")).toEqual(["locks", "doc_1"]);
  });
});

describe("keys the kit owns because the contract's set is closed", () => {
  // TEST-12: nine shapes upstream, pinned by `query-keys.test.ts`. These two are
  // needed here and may not be added there.
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
