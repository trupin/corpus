import { describe, expect, it } from "vitest";
import { DocFrontmatterSchema } from "./doc.js";
import {
  EXTRA_MAX_BYTES,
  EXTRA_MAX_DEPTH,
  ExtraFrontmatterSchema,
  RESERVED_FRONTMATTER_KEYS,
} from "./extra.js";

/** A hand-written frontmatter convention the core defines nothing about — the shape the surface exists to carry. */
const handWrittenItems = {
  items: [
    { text: "follow up on X", done: false, ts: "2026-07-19T10:00:00Z" },
    { text: "renew the fixed rate", done: true, ts: "2026-07-20T09:00:00Z" },
  ],
};

describe("ExtraFrontmatter", () => {
  it("round-trips the empty object — the every-response baseline", () => {
    expect(ExtraFrontmatterSchema.parse({})).toEqual({});
  });

  it("round-trips a hand-written list of items untouched", () => {
    expect(ExtraFrontmatterSchema.parse(handWrittenItems)).toEqual(handWrittenItems);
  });

  it("round-trips every plain-JSON value kind, null included", () => {
    const extra = {
      flag: true,
      count: 3,
      ratio: 0.5,
      label: "publish",
      cleared: null,
      list: ["a", 1, false, null],
      nested: { deeper: { still: "fine" } },
    };
    expect(ExtraFrontmatterSchema.parse(extra)).toEqual(extra);
  });

  it.each(RESERVED_FRONTMATTER_KEYS)("rejects the core key %s at the top level", (key) => {
    const result = ExtraFrontmatterSchema.safeParse({ [key]: "smuggled" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([key]);
    expect(result.error?.issues[0]?.message).toContain("core frontmatter key");
  });

  /** The reservation is exact and case-sensitive, because YAML keys are. */
  it("does not reserve a differently-cased spelling — `Title` is a real, distinct disk key", () => {
    expect(ExtraFrontmatterSchema.parse({ Title: "x" })).toEqual({ Title: "x" });
  });

  /** Only top-level keys are file frontmatter keys; nested names collide with nothing. */
  it("allows core-key names nested inside a value", () => {
    const extra = { publish: { status: "sent", id: 4, order: [1, 2] } };
    expect(ExtraFrontmatterSchema.parse(extra)).toEqual(extra);
  });

  /** A null-prototype object is still a plain mapping — some parsers produce them. */
  it("accepts a null-prototype object value", () => {
    const bare: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    bare["done"] = true;
    expect(ExtraFrontmatterSchema.safeParse({ item: bare }).success).toBe(true);
  });

  /**
   * `extra` is a wire envelope, not a disk key: a file's literal `extra:` key
   * rides inside the object and collides with nothing, so it is not reserved.
   */
  it("does not reserve `extra` itself", () => {
    expect(ExtraFrontmatterSchema.parse({ extra: 1 })).toEqual({ extra: 1 });
  });

  it("rejects an empty key", () => {
    expect(ExtraFrontmatterSchema.safeParse({ "": 1 }).success).toBe(false);
  });

  it.each([
    ["undefined", { orphan: undefined }],
    ["a non-finite number", { bad: Number.POSITIVE_INFINITY }],
    ["NaN", { bad: Number.NaN }],
    ["a Date instance", { when: new Date("2026-07-19T10:00:00Z") }],
    ["a function", { run: () => 1 }],
    ["a bigint", { big: 1n }],
    ["a class instance", { map: new Map() }],
  ])("rejects %s — values are plain JSON, as YAML can carry it", (_label, extra) => {
    expect(ExtraFrontmatterSchema.safeParse(extra).success).toBe(false);
  });

  it("names the offending path when a nested value is not plain JSON", () => {
    const result = ExtraFrontmatterSchema.safeParse({ items: [{ ts: new Date() }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["items", 0, "ts"]);
  });

  it(`accepts a value exactly ${String(EXTRA_MAX_DEPTH)} containers deep and rejects one deeper`, () => {
    const nest = (depth: number): unknown => (depth === 0 ? "leaf" : [nest(depth - 1)]);
    expect(ExtraFrontmatterSchema.safeParse({ deep: nest(EXTRA_MAX_DEPTH) }).success).toBe(true);
    expect(ExtraFrontmatterSchema.safeParse({ deep: nest(EXTRA_MAX_DEPTH + 1) }).success).toBe(
      false,
    );
  });

  it("bounds the serialized size, so frontmatter stays a record and not a database", () => {
    const nearCap = { blob: "x".repeat(EXTRA_MAX_BYTES - 100) };
    const overCap = { blob: "x".repeat(EXTRA_MAX_BYTES + 1) };
    expect(ExtraFrontmatterSchema.safeParse(nearCap).success).toBe(true);
    const result = ExtraFrontmatterSchema.safeParse(overCap);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(String(EXTRA_MAX_BYTES));
  });

  /** Multi-byte text counts in UTF-8 bytes, not UTF-16 code units. */
  it("measures the size bound in UTF-8 bytes", () => {
    // Each "é" is 1 UTF-16 code unit but 2 UTF-8 bytes, so this blob is under
    // the cap by .length and over it by byte count.
    const extra = { blob: "é".repeat(Math.ceil(EXTRA_MAX_BYTES / 2)) };
    expect(ExtraFrontmatterSchema.safeParse(extra).success).toBe(false);
  });

  it("reports every bad key at once rather than stopping at the first", () => {
    const result = ExtraFrontmatterSchema.safeParse({ id: "x", type: "y", ok: 1 });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(2);
  });
});

/**
 * The reservation list and the actual schemas must not drift: a core key added
 * to a doc shape without a matching entry here would become shadowable, which
 * is the one thing the surface promises is impossible. `extra.ts` cannot
 * import `doc.ts` (doc.ts imports it), so the pin lives here.
 */
describe("RESERVED_FRONTMATTER_KEYS drift pin", () => {
  it("covers every DocFrontmatter key except the `extra` envelope itself", () => {
    const coreKeys = Object.keys(DocFrontmatterSchema.shape).filter((key) => key !== "extra");
    expect(coreKeys.filter((key) => !RESERVED_FRONTMATTER_KEYS.includes(key as never))).toEqual([]);
  });

  it("covers the §6 thread keys, which are frontmatter on thread files", () => {
    for (const key of ["parent", "anchor", "agent"]) {
      expect(RESERVED_FRONTMATTER_KEYS).toContain(key);
    }
  });

  it("covers §10's per-turn model record, which is frontmatter on thread files", () => {
    expect(RESERVED_FRONTMATTER_KEYS).toContain("turnModels");
  });

  it("covers the §10 view keys, now first-class core fields", () => {
    for (const key of ["pinned", "order", "query", "column"]) {
      expect(RESERVED_FRONTMATTER_KEYS).toContain(key);
    }
  });

  it("stays deduplicated", () => {
    expect(new Set(RESERVED_FRONTMATTER_KEYS).size).toBe(RESERVED_FRONTMATTER_KEYS.length);
  });
});
