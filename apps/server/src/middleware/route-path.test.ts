import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { contractRoutes } from "@corpus/contract";
import { createContractPathMatcher, methodOnly, toHonoPath } from "./route-path.js";

describe("toHonoPath", () => {
  it("rewrites OpenAPI parameters into Hono's spelling", () => {
    expect(toHonoPath("/api/jobs/{id}/log")).toBe("/api/jobs/:id/log");
    expect(toHonoPath("/api/locks/{docId}")).toBe("/api/locks/:docId");
    expect(toHonoPath("/api/health")).toBe("/api/health");
  });

  it("produces a path Hono actually routes on", async () => {
    const app = new Hono();
    app.post(toHonoPath(contractRoutes.appendJobLog.path), (c) => c.json({ ok: true }));

    expect((await app.request("/api/jobs/evt_7c1d/log", { method: "POST" })).status).toBe(200);
  });
});

describe("createContractPathMatcher", () => {
  const matches = createContractPathMatcher(contractRoutes.appendJobLog.path);

  it("matches the route and only the route", () => {
    expect(matches("/api/jobs/evt_7c1d/log")).toBe(true);
    expect(matches("/api/jobs/anything/log")).toBe(true);
  });

  it.each([
    ["a prefix", "/api/jobs"],
    ["a longer path", "/api/jobs/evt_7c1d/log/extra"],
    ["a missing segment", "/api/jobs//log"],
    ["a parameter spanning segments", "/api/jobs/evt/7c1d/log"],
    ["a different route", "/api/jobs/evt_7c1d/retry"],
    ["a suffix", "x/api/jobs/evt_7c1d/log"],
  ])("does not match %s", (_label, path) => {
    expect(matches(path)).toBe(false);
  });

  it("treats regex-significant characters in a static path literally", () => {
    const health = createContractPathMatcher("/api/health");

    expect(health("/api/health")).toBe(true);
    expect(health("/apixhealth")).toBe(false);
  });
});

describe("methodOnly", () => {
  const app = (): Hono => {
    const probe = new Hono();
    probe.use(
      "/thing",
      methodOnly("POST", (c) => Promise.resolve(c.json({ blocked: true }, 403))),
    );
    probe.all("/thing", (c) => c.json({ reached: true }, 200));
    return probe;
  };

  it("applies the guard to its method and to no other", async () => {
    expect((await app().request("/thing", { method: "POST" })).status).toBe(403);
    expect((await app().request("/thing")).status).toBe(200);
    expect((await app().request("/thing", { method: "DELETE" })).status).toBe(200);
  });
});
