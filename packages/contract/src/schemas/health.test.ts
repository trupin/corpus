import { describe, expect, it } from "vitest";
import { HealthSchema } from "./health.js";

describe("Health", () => {
  it("round-trips a healthy probe", () => {
    const health = {
      status: "ok",
      version: "0.1.0",
      uptimeSeconds: 12.5,
      workspace: "/Users/me/corpus-workspace",
    };
    expect(HealthSchema.parse(health)).toEqual(health);
  });

  it("has no unhealthy variant — an unhealthy server does not answer", () => {
    expect(
      HealthSchema.safeParse({
        status: "degraded",
        version: "0.1.0",
        uptimeSeconds: 1,
        workspace: "/tmp/w",
      }).success,
    ).toBe(false);
  });
});
