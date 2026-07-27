import { describe, expect, it } from "vitest";
import { editDistance, suggest } from "./suggest.js";

describe("editDistance", () => {
  it.each([
    ["", "", 0],
    ["health", "health", 0],
    ["helth", "health", 1],
    ["widgets", "widget", 1],
    ["shwo", "show", 2],
    ["", "abc", 3],
    ["abc", "", 3],
  ])("measures %j against %j as %i", (a, b, expected) => {
    expect(editDistance(a, b)).toBe(expected);
    expect(editDistance(b, a)).toBe(expected);
  });
});

describe("suggest", () => {
  it("returns the closest candidate within distance 2", () => {
    expect(suggest("helth", ["health", "thread"])).toBe("health");
    expect(suggest("shwo", ["list", "show"])).toBe("show");
  });

  it("returns nothing when everything is too far away", () => {
    expect(suggest("zzzzzzzz", ["health", "doc"])).toBeUndefined();
    expect(suggest("health", [])).toBeUndefined();
  });

  it("prefers the nearest of several near misses", () => {
    expect(suggest("healt", ["health", "heal"])).toBe("health");
  });
});
