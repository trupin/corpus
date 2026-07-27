import { describe, expect, it } from "vitest";
import { INVALIDATE_EVENT, InvalidatePayloadSchema, QueryKeySchema, parseQueryKey } from "./sse.js";

describe("QueryKey", () => {
  it.each([[["docs"]], [["docs", { type: "thread" }]], [["threads", "th_x9y8", 2]]])(
    "round-trips %j",
    (key) => {
      expect(QueryKeySchema.parse(key)).toEqual(key);
    },
  );

  it("rejects a key segment that is not a string, number or filter object", () => {
    expect(QueryKeySchema.safeParse(["docs", true]).success).toBe(false);
  });

  it("parses a wire key into the published, Zod-free QueryKey type", () => {
    expect(parseQueryKey(["docs", "doc_a1b2c3"])).toEqual(["docs", "doc_a1b2c3"]);
  });

  it("throws rather than passing a malformed key on to a cache", () => {
    expect(() => parseQueryKey("docs")).toThrow();
  });
});

describe("InvalidatePayload", () => {
  it("names the SSE event the server emits", () => {
    expect(INVALIDATE_EVENT).toBe("invalidate");
  });

  it("round-trips a multi-key invalidation", () => {
    const payload = { keys: [["docs"], ["threads", "th_x9y8"]] };
    expect(InvalidatePayloadSchema.parse(payload)).toEqual(payload);
  });

  it("rejects an empty invalidation, which would tell the client nothing", () => {
    expect(InvalidatePayloadSchema.safeParse({ keys: [] }).success).toBe(false);
  });
});
