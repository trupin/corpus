import { describe, expect, it } from "vitest";
import { IsoDateSchema, IsoDateTimeSchema } from "./time.js";

describe("IsoDateTime", () => {
  it.each(["2026-07-19T10:05:00Z", "2026-07-19T10:05:00.123Z"])("round-trips %s", (value) => {
    expect(IsoDateTimeSchema.parse(value)).toBe(value);
  });

  it.each(["2026-07-19", "19/07/2026", "not a date"])("rejects %s", (value) => {
    expect(IsoDateTimeSchema.safeParse(value).success).toBe(false);
  });
});

describe("IsoDate", () => {
  it("round-trips a calendar date", () => {
    expect(IsoDateSchema.parse("2026-08-01")).toBe("2026-08-01");
  });

  it.each(["2026-08-01T00:00:00Z", "2026-13-01"])("rejects %s", (value) => {
    expect(IsoDateSchema.safeParse(value).success).toBe(false);
  });
});
