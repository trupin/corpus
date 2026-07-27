import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@corpus/contract";

// The spy has to wrap the real implementation: TEST-28 asserts the comparison
// *routes through* `crypto.timingSafeEqual`, which a stubbed return value would
// prove nothing about.
const timingSafeEqualSpy = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: timingSafeEqualSpy };
});

const {
  HEALTH_PATH,
  UNAUTHENTICATED_ROUTES,
  createBearerAuth,
  isUnauthenticatedRoute,
  parseBearerHeader,
  timingSafeEqualString,
} = await import("./auth.js");

const TOKEN = "tkn_0123456789abcdef0123456789abcdef";

beforeEach(() => {
  timingSafeEqualSpy.mockClear();
});

describe("parseBearerHeader", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    ["   ", undefined],
    ["Bearer", undefined],
    ["Bearer ", undefined],
    ["Bearer   ", undefined],
    ["Basic abc", undefined],
    ["Token abc", undefined],
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["BEARER abc", "abc"],
    ["  Bearer   abc  ", "abc"],
    ["Bearer abc def", undefined],
  ])("parses %j as %j", (header, expected) => {
    expect(parseBearerHeader(header)).toBe(expected);
  });
});

describe("timingSafeEqualString", () => {
  it("returns true for equal strings, via crypto.timingSafeEqual", () => {
    expect(timingSafeEqualString(TOKEN, TOKEN)).toBe(true);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("short-circuits a length mismatch without throwing or calling into crypto", () => {
    expect(() => timingSafeEqualString("short", TOKEN)).not.toThrow();
    expect(timingSafeEqualString("short", TOKEN)).toBe(false);
    expect(timingSafeEqualSpy).not.toHaveBeenCalled();
  });

  it("returns false for same-length, different strings", () => {
    expect(timingSafeEqualString("aaaa", "bbbb")).toBe(false);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("compares by bytes, not by code units", () => {
    // "é" is two UTF-8 bytes; a code-unit length check would call into crypto
    // with mismatched buffers and throw.
    expect(() => timingSafeEqualString("é", "ab")).not.toThrow();
    expect(timingSafeEqualString("é", "ab")).toBe(false);
  });
});

/** A minimal app with the guard mounted the way `createServer` mounts it. */
function guardedApp(options: { allowQueryToken?: boolean } = {}): Hono {
  const app = new Hono();
  app.use("/api/*", createBearerAuth({ token: TOKEN }));
  app.use("/events", createBearerAuth({ token: TOKEN, ...options }));
  app.get(HEALTH_PATH, (c) => c.json({ status: "ok" }));
  app.all("*", (c) => c.json({ reached: c.req.path }));
  return app;
}

describe("the documented exceptions", () => {
  it("is exactly two routes — the health probe and the job-log ingest", () => {
    // SPEC.md §9.2: "all routes require the workspace bearer token except the
    // documented exceptions (health probe; loopback job-log ingest)". A third
    // entry here is a third hole, and this assertion is where it gets noticed.
    expect(UNAUTHENTICATED_ROUTES.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /api/health",
      "POST /api/jobs/{id}/log",
    ]);
  });

  it.each([
    ["GET", "/api/health", true],
    ["POST", "/api/jobs/evt_7c1d/log", true],
    // Method-exact: the read of the same path stays authenticated.
    ["GET", "/api/jobs/evt_7c1d/log", false],
    ["DELETE", "/api/jobs/evt_7c1d/log", false],
    // Path-exact: neither the prefix nor a longer path is exempt.
    ["POST", "/api/jobs", false],
    ["GET", "/api/jobs", false],
    ["POST", "/api/jobs/evt_7c1d/log/extra", false],
    ["POST", "/api/jobs/evt_7c1d/retry", false],
    ["POST", "/api/health", false],
  ])("%s %s -> exempt: %s", (method, path, expected) => {
    expect(isUnauthenticatedRoute(method, path)).toBe(expected);
  });
});

describe("createBearerAuth", () => {
  it("lets a tokenless POST reach the job-log ingest, and no other job route", async () => {
    const app = guardedApp();

    expect((await app.request("/api/jobs/evt_7c1d/log", { method: "POST" })).status).toBe(200);
    expect((await app.request("/api/jobs/evt_7c1d/log")).status).toBe(401);
    expect((await app.request("/api/jobs")).status).toBe(401);
  });

  it("lets GET /api/health through with no credential at all", async () => {
    const response = await guardedApp().request(HEALTH_PATH);
    expect(response.status).toBe(200);
  });

  it("guards every other method on the health path", async () => {
    const response = await guardedApp().request(HEALTH_PATH, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it.each([
    ["no header", {}],
    ["an empty header", { Authorization: "" }],
    ["a whitespace header", { Authorization: "   " }],
    ["Bearer with no value", { Authorization: "Bearer" }],
    ["a Basic credential", { Authorization: "Basic abc" }],
    ["the wrong token", { Authorization: "Bearer wrong" }],
    [
      "a token of the right length but wrong bytes",
      { Authorization: `Bearer ${"x".repeat(TOKEN.length)}` },
    ],
  ])("rejects %s with a contract ApiError 401", async (_label, headers) => {
    const response = await guardedApp().request("/api/docs", { headers });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("content-type")).toContain("application/json");

    const body: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.code).toBe("unauthorized");
  });

  it("never echoes the presented credential back to the client", async () => {
    const response = await guardedApp().request("/api/docs", {
      headers: { Authorization: "Bearer super-secret-guess" },
    });
    expect(await response.text()).not.toContain("super-secret-guess");
  });

  it("accepts the correct token and hands off to the route", async () => {
    const response = await guardedApp().request("/api/docs", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reached: "/api/docs" });
  });

  it("guards /attachments/* the same way when mounted there", async () => {
    const app = new Hono();
    app.use("/attachments/*", createBearerAuth({ token: TOKEN }));
    app.all("*", (c) => c.json({ ok: true }));

    expect((await app.request("/attachments/a.png")).status).toBe(401);
    expect(
      (await app.request("/attachments/a.png", { headers: { Authorization: `Bearer ${TOKEN}` } }))
        .status,
    ).toBe(200);
  });
});

describe("the ?token= exception", () => {
  it("is rejected on guarded /api paths even with the correct token", async () => {
    const response = await guardedApp({ allowQueryToken: true }).request(
      `/api/docs?token=${TOKEN}`,
    );
    expect(response.status).toBe(401);
  });

  it("is accepted on /events", async () => {
    const response = await guardedApp({ allowQueryToken: true }).request(`/events?token=${TOKEN}`);
    expect(response.status).toBe(200);
  });

  it("still accepts a header credential on /events", async () => {
    const response = await guardedApp({ allowQueryToken: true }).request("/events", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ["no credential", "/events"],
    ["a wrong query token", "/events?token=wrong"],
    ["an empty query token", "/events?token="],
  ])("rejects /events with %s", async (_label, path) => {
    expect((await guardedApp({ allowQueryToken: true }).request(path)).status).toBe(401);
  });

  it("is off by default", async () => {
    const app = new Hono();
    app.use("/events", createBearerAuth({ token: TOKEN }));
    app.all("*", (c) => c.json({ ok: true }));
    expect((await app.request(`/events?token=${TOKEN}`)).status).toBe(401);
  });

  it("prefers the header when both are present", async () => {
    const response = await guardedApp({ allowQueryToken: true }).request("/events?token=wrong", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
  });
});
