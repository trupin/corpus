import { describe, expect, it } from "vitest";
import { formatAge } from "./age.js";

/**
 * The ladder two verbs now share (`queue claim-all`'s held block and
 * `corpus agents`). What is asserted is the *boundaries* — a rung that fired one
 * unit early would render a 59-second park as a minute and a 23-hour one as a
 * day, both of which read as a lane being staler than it is.
 */
describe("formatAge", () => {
  it("reports one significant unit at each rung", () => {
    expect(formatAge(0)).toBe("0s");
    expect(formatAge(45_000)).toBe("45s");
    expect(formatAge(12 * 60_000)).toBe("12m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(2 * 86_400_000)).toBe("2d");
  });

  it("changes unit exactly at the boundary, never one tick early", () => {
    expect(formatAge(59_999)).toBe("59s");
    expect(formatAge(60_000)).toBe("1m");
    expect(formatAge(3_599_999)).toBe("59m");
    expect(formatAge(3_600_000)).toBe("1h");
    expect(formatAge(86_399_999)).toBe("23h");
    expect(formatAge(86_400_000)).toBe("1d");
  });

  it("clamps a span that runs backwards, rather than rendering a future", () => {
    // Clock skew between the server's instant and this machine. `0s` is wrong by
    // a bounded amount; "-4s ago" is wrong in a way a reader cannot interpret.
    expect(formatAge(-4_000)).toBe("0s");
  });
});
