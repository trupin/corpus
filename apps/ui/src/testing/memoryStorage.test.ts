/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { memoryStorage, throwingStorage } from "./memoryStorage";

describe("memoryStorage", () => {
  it("round-trips values and reports its size", () => {
    const storage = memoryStorage({ a: "1" });
    expect(storage.length).toBe(1);
    expect(storage.getItem("a")).toBe("1");

    storage.setItem("b", "2");
    expect(storage.key(1)).toBe("b");
    expect(storage.length).toBe(2);

    storage.removeItem("a");
    expect(storage.getItem("a")).toBeNull();

    storage.clear();
    expect(storage.length).toBe(0);
    expect(storage.key(0)).toBeNull();
  });
});

describe("throwingStorage", () => {
  const storage = throwingStorage();

  it.each([
    ["getItem", () => storage.getItem("a")],
    ["setItem", () => storage.setItem("a", "1")],
    ["removeItem", () => storage.removeItem("a")],
    ["key", () => storage.key(0)],
    ["clear", () => storage.clear()],
    ["length", () => storage.length],
  ])("throws from %s", (_name, access) => {
    expect(access).toThrow(DOMException);
  });
});
