import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PageMetaSchema,
  PaginationQuerySchema,
} from "./pagination.js";

describe("PaginationQuery", () => {
  it("fills in defaults when the caller passes nothing", () => {
    expect(PaginationQuerySchema.parse({})).toEqual({
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
  });

  it("coerces the strings a query string actually delivers", () => {
    expect(PaginationQuerySchema.parse({ limit: "10", offset: "20" })).toEqual({
      limit: 10,
      offset: 20,
    });
  });

  it.each([
    ["a limit above the cap", { limit: String(MAX_PAGE_LIMIT + 1) }],
    ["a zero limit", { limit: "0" }],
    ["a negative offset", { offset: "-1" }],
    ["a fractional limit", { limit: "1.5" }],
    ["a non-numeric limit", { limit: "many" }],
  ])("rejects %s", (_label, query) => {
    expect(PaginationQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("PageMeta", () => {
  it("round-trips", () => {
    const meta = { total: 120, limit: 50, offset: 50 };
    expect(PageMetaSchema.parse(meta)).toEqual(meta);
  });

  it("rejects a negative total", () => {
    expect(PageMetaSchema.safeParse({ total: -1, limit: 50, offset: 0 }).success).toBe(false);
  });
});
