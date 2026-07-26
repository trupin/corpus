import { describe, expect, it } from "vitest";
import {
  AcquireLockRequestSchema,
  LockListSchema,
  LockReapResultSchema,
  LockSchema,
  ReleaseLockResultSchema,
} from "./lock.js";

const lock = {
  docId: "doc_a1b2c3",
  holder: "agent",
  acquired: "2026-07-19T10:05:00Z",
  ttl: 300,
};

describe("Lock", () => {
  it("round-trips the `.corpus/locks/<docId>.json` shape", () => {
    expect(LockSchema.parse(lock)).toEqual(lock);
  });

  it("round-trips a lock held by the user's editor session", () => {
    expect(LockSchema.parse({ ...lock, holder: "user" }).holder).toBe("user");
  });

  it("locks a thread document like any other document", () => {
    expect(LockSchema.parse({ ...lock, docId: "th_x9y8" }).docId).toBe("th_x9y8");
  });

  it.each([
    ["a zero TTL, which could never expire meaningfully", { ttl: 0 }],
    ["a fractional TTL", { ttl: 1.5 }],
    ["a holder outside the two parties", { holder: "plugin" }],
  ])("rejects %s", (_label, override) => {
    expect(LockSchema.safeParse({ ...lock, ...override }).success).toBe(false);
  });

  it("carries exactly the four fields SPEC.md §7 names", () => {
    expect(Object.keys(LockSchema.shape)).toEqual(["docId", "holder", "acquired", "ttl"]);
  });
});

describe("AcquireLockRequest", () => {
  it("accepts a bodiless acquire, leaving the lease to the server", () => {
    const parsed = AcquireLockRequestSchema.parse({});
    expect(parsed).toEqual({});
    expect(parsed.ttl).toBeUndefined();
  });

  it("carries an explicit lease through", () => {
    expect(AcquireLockRequestSchema.parse({ ttl: 60 })).toEqual({ ttl: 60 });
  });

  it.each([0, -5, 2.5])("rejects the lease %s", (ttl) => {
    expect(AcquireLockRequestSchema.safeParse({ ttl }).success).toBe(false);
  });
});

describe("LockList", () => {
  it("round-trips the banner-hydration payload", () => {
    expect(LockListSchema.parse({ locks: [lock] })).toEqual({ locks: [lock] });
  });

  it("round-trips a workspace with nothing locked", () => {
    expect(LockListSchema.parse({ locks: [] })).toEqual({ locks: [] });
  });
});

describe("ReleaseLockResult", () => {
  it("round-trips a release, naming who held the lock", () => {
    const result = { docId: "doc_a1b2c3", released: true, holder: "agent" };
    expect(ReleaseLockResultSchema.parse(result)).toEqual(result);
  });

  it("rejects `released: false`, which is not an outcome this response reports", () => {
    const result = { docId: "doc_a1b2c3", released: false, holder: "agent" };
    expect(ReleaseLockResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("LockReapResult", () => {
  it("round-trips the documents whose expired locks were cleared", () => {
    expect(LockReapResultSchema.parse({ reaped: ["doc_a1b2c3", "th_x9y8"] })).toEqual({
      reaped: ["doc_a1b2c3", "th_x9y8"],
    });
  });

  it("round-trips a reap that found nothing expired", () => {
    expect(LockReapResultSchema.parse({ reaped: [] })).toEqual({ reaped: [] });
  });
});
