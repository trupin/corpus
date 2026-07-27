import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ApiErrorSchema } from "@corpus/contract";
import { getPeerAddress, isLoopbackAddress, localhostOnly, noBrowserOrigin } from "./localhost.js";

describe("isLoopbackAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["::1", true],
    ["[::1]", true],
    ["0:0:0:0:0:0:0:1", true],
    ["::ffff:127.0.0.1", true],
    ["::FFFF:127.0.0.1", true],
    ["10.0.0.5", false],
    ["::ffff:10.0.0.5", false],
    ["192.168.1.1", false],
    ["2001:db8::1", false],
    ["127.0.0.256", false],
    ["", false],
    [undefined, false],
  ])("%s -> %s", (address, expected) => {
    expect(isLoopbackAddress(address)).toBe(expected);
  });
});

describe("getPeerAddress", () => {
  it("reads the node-server binding shape", () => {
    expect(getPeerAddress({ incoming: { socket: { remoteAddress: "127.0.0.1" } } })).toBe(
      "127.0.0.1",
    );
  });

  it.each([
    ["a null env", null],
    ["a non-object env", "nope"],
    ["an env with no incoming", {}],
    ["an incoming with no socket", { incoming: {} }],
    ["a socket with no address", { incoming: { socket: {} } }],
  ])("returns undefined for %s", (_label, env) => {
    expect(getPeerAddress(env)).toBeUndefined();
  });
});

/**
 * Mounts the guard on a throwaway app and drives it with the same `env` bindings
 * `@hono/node-server` supplies — `Hono#request`'s third argument is exactly the
 * hook the adaptor uses, so nothing about the guard is stubbed.
 */
async function requestWithPeer(
  remoteAddress: string | undefined,
  path = "/api/jobs/j1/log",
  init: RequestInit = {},
): Promise<Response> {
  const app = new Hono();
  app.use("*", localhostOnly);
  app.all("*", (c) => c.json({ ok: true }));
  return app.request(path, init, { incoming: { socket: { remoteAddress } } });
}

describe("localhostOnly", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "allows the loopback peer %s",
    async (address) => {
      const response = await requestWithPeer(address, "/api/jobs/j1/log", { method: "POST" });
      expect(response.status).toBe(200);
    },
  );

  it("rejects a routable peer with a 403 carrying a contract error code", async () => {
    const response = await requestWithPeer("10.0.0.5", "/api/jobs/j1/log", { method: "POST" });

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body: unknown = await response.json();
    const parsed = ApiErrorSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.code).toBe("forbidden");
    expect(parsed.success && parsed.data.message).toMatch(/loopback/);
  });

  it("rejects a request with no peer address at all", async () => {
    expect((await requestWithPeer(undefined, "/x")).status).toBe(403);
  });

  it("ignores X-Forwarded-For — the header cannot talk it out of its answer", async () => {
    const response = await requestWithPeer("10.0.0.5", "/x", {
      headers: {
        "X-Forwarded-For": "127.0.0.1",
        "X-Real-IP": "127.0.0.1",
        Forwarded: "for=127.0.0.1",
      },
    });
    expect(response.status).toBe(403);
  });

  it("does not trust X-Forwarded-For to deny a genuine loopback peer either", async () => {
    const response = await requestWithPeer("127.0.0.1", "/x", {
      headers: { "X-Forwarded-For": "10.0.0.5" },
    });
    expect(response.status).toBe(200);
  });
});

async function requestWithOrigin(headers: Record<string, string>): Promise<Response> {
  const app = new Hono();
  app.use("*", noBrowserOrigin);
  app.all("*", (c) => c.json({ ok: true }));
  return app.request("/api/jobs/evt_7c1d/log", { method: "POST", headers });
}

describe("noBrowserOrigin", () => {
  it("lets through a request with no Origin — no legitimate caller sends one", async () => {
    expect((await requestWithOrigin({})).status).toBe(200);
  });

  it.each([
    "http://evil.example",
    // Same-origin-looking is exactly what an attacker sends: the check is on the
    // header's presence, never on its value.
    "http://127.0.0.1:8765",
    "http://localhost:8765",
    "null",
    "",
  ])("refuses a request carrying Origin: %s", async (origin) => {
    const response = await requestWithOrigin({ Origin: origin });

    expect(response.status).toBe(403);
    const parsed = ApiErrorSchema.safeParse(await response.json());
    expect(parsed.success && parsed.data.code).toBe("forbidden");
    expect(parsed.success && parsed.data.message).toMatch(/Origin/);
  });
});
