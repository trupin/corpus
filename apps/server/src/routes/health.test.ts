import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { HealthSchema, contractRoutes } from "@corpus/contract";
import { buildHealthPayload, createHealthHandler } from "./health.js";

const BASE = { version: "1.2.3", workspaceRoot: "/tmp/ws", startedAt: 1_000 };

describe("buildHealthPayload", () => {
  it("matches the contract's HealthSchema exactly", () => {
    const payload = buildHealthPayload({ ...BASE, now: () => 4_500 });
    expect(HealthSchema.parse(payload)).toEqual({
      status: "ok",
      version: "1.2.3",
      uptimeSeconds: 3.5,
      workspace: "/tmp/ws",
    });
  });

  it("reports uptime in seconds, not milliseconds (Adjudication 1)", () => {
    const payload = buildHealthPayload({ ...BASE, now: () => 61_000 });
    expect(payload.uptimeSeconds).toBe(60);
    expect(payload).not.toHaveProperty("uptimeMs");
  });

  it("never reports negative uptime when the clock moves backwards", () => {
    expect(buildHealthPayload({ ...BASE, now: () => 500 }).uptimeSeconds).toBe(0);
  });

  it("uses a real clock by default", () => {
    const payload = buildHealthPayload({ ...BASE, startedAt: Date.now() });
    expect(payload.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(payload.uptimeSeconds).toBeLessThan(5);
  });
});

describe("createHealthHandler", () => {
  it("registers against the contract route and answers 200 JSON", async () => {
    const app = new OpenAPIHono();
    app.openapi(contractRoutes.getHealth, createHealthHandler({ ...BASE, now: () => 2_000 }));

    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(HealthSchema.safeParse(await response.json()).success).toBe(true);
  });
});
