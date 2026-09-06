import { describe, expect, it } from "vitest";
import {
  PRESENTATION_FRONTMATTER_KEYS,
  SERVER_STAMPED_FRONTMATTER_KEYS,
  isPresentationFrontmatterKey,
  isServerStampedFrontmatterKey,
} from "./frontmatter-keys.js";
import { RESERVED_FRONTMATTER_KEYS } from "./extra.js";
import { UNSETTABLE_EXCLUSIONS, UpdateDocRequestSchema } from "./doc.js";

describe("frontmatter key classes (CONTRACT-098)", () => {
  it("pins both lists, so growing one is a deliberate edit with a reason beside it", () => {
    expect([...SERVER_STAMPED_FRONTMATTER_KEYS]).toEqual(["created", "updated"]);
    expect([...PRESENTATION_FRONTMATTER_KEYS]).toEqual(["width"]);
  });

  it("keeps the two classes disjoint — a key is stamped or presentational, never both", () => {
    const stamped = new Set<string>(SERVER_STAMPED_FRONTMATTER_KEYS);
    expect(PRESENTATION_FRONTMATTER_KEYS.filter((key) => stamped.has(key))).toEqual([]);
  });

  it("answers membership for every declared key, and for nothing else", () => {
    for (const key of SERVER_STAMPED_FRONTMATTER_KEYS) {
      expect(isServerStampedFrontmatterKey(key)).toBe(true);
      expect(isPresentationFrontmatterKey(key)).toBe(false);
    }
    for (const key of PRESENTATION_FRONTMATTER_KEYS) {
      expect(isPresentationFrontmatterKey(key)).toBe(true);
      expect(isServerStampedFrontmatterKey(key)).toBe(false);
    }
    expect(isServerStampedFrontmatterKey("reviewed")).toBe(false);
    expect(isPresentationFrontmatterKey("title")).toBe(false);
  });
});

/**
 * Each membership rule the docblocks state is checkable against the rest of the
 * contract, which is the reason the lists are declared here and not inside a
 * consumer. A key added to either list without satisfying its rule fails below,
 * so the prose and the list cannot drift apart either.
 */
describe("frontmatter key classes — the membership rules hold against the contract", () => {
  it.each([...SERVER_STAMPED_FRONTMATTER_KEYS])(
    "`%s` is a core key, so it can never be smuggled through `extra`",
    (key) => {
      expect(RESERVED_FRONTMATTER_KEYS).toContain(key);
    },
  );

  it.each([...SERVER_STAMPED_FRONTMATTER_KEYS])(
    "`%s` is refused as an update field — the server is its only writer",
    (key) => {
      const result = UpdateDocRequestSchema.safeParse({ [key]: "2026-01-01T00:00:00Z" });
      expect(result.success).toBe(false);
    },
  );

  it("keeps `reviewed` out of the stamped class, because a person sets it", () => {
    expect(isServerStampedFrontmatterKey("reviewed")).toBe(false);
    expect(UpdateDocRequestSchema.safeParse({ reviewed: "2026-01-01T00:00:00Z" }).success).toBe(
      true,
    );
  });

  it.each([...PRESENTATION_FRONTMATTER_KEYS])(
    "`%s` is an extra key: refused as a core field, accepted inside `extra`",
    (key) => {
      expect(RESERVED_FRONTMATTER_KEYS).not.toContain(key);
      expect(UpdateDocRequestSchema.safeParse({ [key]: 686 }).success).toBe(false);
      expect(UpdateDocRequestSchema.safeParse({ extra: { [key]: 686 } }).success).toBe(true);
    },
  );

  it("overlaps the keys `unset` refuses at `created` alone", () => {
    // `created` sits on both lists for one reason — the server owns it — and the
    // lists mean different things, so the overlap is stated rather than asserted
    // away. `updated` is deliberately removable: a migration may drop it, and
    // the next content edit writes it back.
    expect([...UNSETTABLE_EXCLUSIONS].filter(isServerStampedFrontmatterKey)).toEqual(["created"]);
  });
});
