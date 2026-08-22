import { RESERVED_FRONTMATTER_KEYS } from "@corpus/contract";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./document.js";
import {
  MAX_EXTRA_READ_DEPTH,
  readExtraFrontmatter,
  readOrder,
  readPinned,
  readViewFrontmatter,
  readViewQuery,
} from "./view-frontmatter.js";

/** Reads a real frontmatter block, so every case is a file someone could type. */
const frontmatterOf = (yaml: string): Record<string, unknown> =>
  parseDocument(`---\n${yaml}\n---\n\nBody.\n`).data;

const SEED_ATTENTION = frontmatterOf(
  [
    "id: doc_seedattention",
    "type: view",
    "title: Attention",
    "created: 2026-07-26T00:00:00Z",
    "updated: 2026-07-26T00:00:00Z",
    "tags: []",
    "status: open",
    "anchors: {}",
    "evergreen: true",
    "pinned: true",
    "order: 1",
    "query:",
    "  needs: me",
  ].join("\n"),
);

describe("readPinned", () => {
  it("is true only for a literal `true`", () => {
    expect(readPinned(SEED_ATTENTION)).toBe(true);
    expect(readPinned(frontmatterOf("pinned: false"))).toBe(false);
    expect(readPinned(frontmatterOf("title: T"))).toBe(false);
    // A string is not a boolean; §10's key is two-state and nothing else.
    expect(readPinned(frontmatterOf('pinned: "true"'))).toBe(false);
  });
});

describe("readOrder", () => {
  it("takes any finite number, so a reorder can write a midpoint", () => {
    expect(readOrder(frontmatterOf("order: 2"))).toBe(2);
    expect(readOrder(frontmatterOf("order: 1.5"))).toBe(1.5);
    expect(readOrder(frontmatterOf("order: -3"))).toBe(-3);
    expect(readOrder(frontmatterOf("order: 0"))).toBe(0);
  });

  it("is null for an absent, non-numeric or non-finite key", () => {
    expect(readOrder(frontmatterOf("title: T"))).toBeNull();
    expect(readOrder(frontmatterOf("order: null"))).toBeNull();
    expect(readOrder(frontmatterOf("order: first"))).toBeNull();
    expect(readOrder(frontmatterOf("order: .nan"))).toBeNull();
    expect(readOrder(frontmatterOf("order: .inf"))).toBeNull();
  });
});

describe("readViewQuery", () => {
  it("reads the seed views' stored query", () => {
    expect(readViewQuery(SEED_ATTENTION)).toEqual({ needs: "me" });
    expect(readViewQuery(frontmatterOf("query:\n  type: thread\n  status: open"))).toEqual({
      type: "thread",
      status: "open",
    });
  });

  it("keeps an array value, which is the comma-separated wire form", () => {
    expect(readViewQuery(frontmatterOf("query:\n  type: [note, view]"))).toEqual({
      type: ["note", "view"],
    });
  });

  it("is null for a shape the wire cannot describe", () => {
    expect(readViewQuery(frontmatterOf("title: T"))).toBeNull();
    expect(readViewQuery(frontmatterOf("query: null"))).toBeNull();
    expect(readViewQuery(frontmatterOf("query: needs=me"))).toBeNull();
    expect(readViewQuery(frontmatterOf("query:\n  needs:\n    nested: me"))).toBeNull();
  });
});

/**
 * A view written before SHARED-066 still carries `column: "<plugin>/<type>"` on
 * disk. There is no reader for it any more, and no build will ever put one
 * back, so the thing to pin is where it lands instead: `extra`, verbatim, like
 * every other key the core does not define (SPEC.md §9.1). A user's board must
 * not break on an old view.
 */
describe("a stale `column:` from a workspace that predates the removal", () => {
  it("becomes extra frontmatter, verbatim", () => {
    expect(readExtraFrontmatter(frontmatterOf("column: todos/todos"))).toEqual({
      column: "todos/todos",
    });
  });

  it("leaves the view keys the core still defines exactly as they were", () => {
    const view = frontmatterOf(
      "id: doc_v1\ntype: view\ntitle: Todos\npinned: true\norder: 2\ncolumn: todos/todos",
    );
    expect(readViewFrontmatter(view)).toEqual({
      pinned: true,
      order: 2,
      query: null,
      extra: { column: "todos/todos" },
    });
  });
});

describe("readExtraFrontmatter", () => {
  it("returns every non-core key, flat, exactly as the file carries it", () => {
    const data = frontmatterOf(
      [
        "id: doc_todo1",
        "type: todo",
        "title: Groceries",
        "items:",
        "  - text: Milk",
        "    done: false",
      ].join("\n"),
    );
    expect(readExtraFrontmatter(data)).toEqual({ items: [{ text: "Milk", done: false }] });
  });

  it("is `{}` for a document with only core keys", () => {
    expect(readExtraFrontmatter(SEED_ATTENTION)).toEqual({});
  });

  it("never leaks a core key, for every reserved key the contract names", () => {
    const data = frontmatterOf(
      RESERVED_FRONTMATTER_KEYS.map((key) => `${key}: reserved`).join("\n"),
    );
    expect(readExtraFrontmatter(data)).toEqual({});
  });

  it("keeps a key whose name only differs by case — YAML keys are case-sensitive", () => {
    expect(readExtraFrontmatter(frontmatterOf("Title: Other"))).toEqual({ Title: "Other" });
  });

  it("carries a hand-edited `key: null` through as null", () => {
    expect(readExtraFrontmatter(frontmatterOf("items: null"))).toEqual({ items: null });
  });

  it("carries a file's literal `extra:` key inside the envelope", () => {
    expect(readExtraFrontmatter(frontmatterOf("extra:\n  a: 1"))).toEqual({ extra: { a: 1 } });
  });

  it("drops a value with no faithful JSON form rather than coercing it", () => {
    // `.nan` is not `null`: a response saying `null` invites an update that
    // echoes it back and deletes the key.
    expect(readExtraFrontmatter(frontmatterOf("score: .nan"))).toEqual({});
    expect(readExtraFrontmatter(frontmatterOf("score: .inf\nkept: 1"))).toEqual({ kept: 1 });
  });

  it("drops a value nested past the read cap instead of recursing forever", () => {
    const nest = (levels: number): unknown => (levels === 0 ? "leaf" : { k: nest(levels - 1) });
    const at = (levels: number): Record<string, unknown> =>
      readExtraFrontmatter(frontmatterOf(`v: ${JSON.stringify(nest(levels))}\nkept: 1`));
    expect(at(MAX_EXTRA_READ_DEPTH)).toEqual({ v: nest(MAX_EXTRA_READ_DEPTH), kept: 1 });
    // One container deeper than a create or an update could ever have written.
    expect(at(MAX_EXTRA_READ_DEPTH + 1)).toEqual({ kept: 1 });
  });

  it("drops a value that aliases its own ancestor, which has no JSON form at all", () => {
    const cyclic = frontmatterOf("root: &a\n  self: *a\nkept: 1");
    expect(readExtraFrontmatter(cyclic)).toEqual({ kept: 1 });
  });
});

describe("readViewFrontmatter", () => {
  it("reads the shipped `attention.md` seed as the wire declares it", () => {
    expect(readViewFrontmatter(SEED_ATTENTION)).toEqual({
      pinned: true,
      order: 1,
      query: { needs: "me" },
      extra: {},
    });
  });

  it("gives a plain note the response defaults, all four present", () => {
    expect(readViewFrontmatter(frontmatterOf("id: doc_a1\ntype: note\ntitle: T"))).toEqual({
      pinned: false,
      order: null,
      query: null,
      extra: {},
    });
  });
});
