import { describe, expect, it } from "vitest";
import { LockSchema } from "./lock.js";

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
});
